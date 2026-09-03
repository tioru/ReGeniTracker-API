// scripts/scrape-achievements.ts
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EN_API_URL, FR_API_URL, HTTP_HEADERS, httpsAgent, sleep, withRetry } from './lib/wiki-fetch';

type Lang = 'en' | 'fr';
const SUPPORTED_LANGS: ReadonlySet<Lang> = new Set(['en', 'fr']);

function outputDir(lang: Lang): string {
  return path.resolve(__dirname, `../prisma/data/achievements/${lang}`);
}

// Champs "structurels" (issus du wiki EN, invariants d'une langue à l'autre) : titre
// canonique servant de clé de fichier, tier, statut caché, récompense, version, type.
interface RawAchievement {
  pageTitle: string;
  title: string;
  tier: number;
  category: string;
  description: string;
  requirements: string;
  hidden: boolean;
  type: string;
  primogems: number;
  version: string;
  // Titre de la page équivalente sur le wiki frwiki (lien interlangue [[fr:...]]), s'il existe.
  frTitle: string | null;
}

// Champs traduits récupérés depuis {{Infobox Succès}} sur le wiki FR.
interface FrFields {
  title: string;
  description: string;
  category: string;
  requirements: string;
}

// ── Wikitext helpers ──────────────────────────────────────────────────────────

// Extrait un bloc {{...}} en comptant la profondeur des accolades,
// pour gérer les templates imbriqués (ex: description contenant {{LL|...}}).
function extractBracedBlock(
  content: string,
  startMarker: string,
): string | null {
  const start = content.indexOf(startMarker);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < content.length - 1; i++) {
    if (content[i] === '{' && content[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (content[i] === '}' && content[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return content.slice(start, i + 1);
      continue;
    }
  }
  return null;
}

// Parse les champs |clé = valeur d'un bloc infobox (une ligne par champ).
// Les clés peuvent contenir des accents (ex: "catégorie", "prérequis" côté wiki FR).
function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|([^=\n]+)=(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Nettoie le wikitext : liens [[...]], gras/italique '' ''', templates simples résiduels,
// commentaires HTML (instructions laissées par les contributeurs sur les champs vides).
function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/&shy;/gi, '')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTitleAndTier(pageTitle: string): { title: string; tier: number } {
  const tierMatch = pageTitle.match(/\(Tier\s+(\d+)\)\s*$/i);
  const tier = tierMatch ? parseInt(tierMatch[1], 10) : 1;
  const title = pageTitle
    .replace(/\s*\(Achievement\)\s*$/i, '')
    .replace(/\s*\(Tier\s+\d+\)\s*$/i, '')
    .trim();
  return { title, tier };
}

function toRoman(num: number): string {
  const map: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = num;
  let result = '';
  for (const [value, symbol] of map) {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  }
  return result || String(num);
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── API EN ────────────────────────────────────────────────────────────────────

function parseAchievementPage(
  pageTitle: string,
  content: string,
  frTitle: string | null,
): RawAchievement | null {
  // Exclut les pages "set" (Achievement Set Infobox) et autres pages sans infobox standard.
  // MediaWiki traite espace et underscore comme équivalents dans les noms de template
  // (ex: {{Achievement_Infobox}} existe sur certaines pages) donc on tolère les deux.
  const infoboxMatch = /\{\{Achievement[ _]Infobox/i.exec(content);
  if (!infoboxMatch) return null;

  const block = extractBracedBlock(content, infoboxMatch[0]);
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const { title, tier } = parseTitleAndTier(pageTitle);
  const versionMatch = /\{\{Change History\|([^}|]+)/.exec(content);
  const version = versionMatch ? versionMatch[1].trim() : '';

  return {
    pageTitle,
    title,
    tier,
    category: cleanWikitext(fields['category'] ?? ''),
    description: cleanWikitext(fields['description'] ?? ''),
    requirements: cleanWikitext(fields['requirements'] ?? ''),
    hidden: cleanWikitext(fields['hidden'] ?? '') === '1',
    type: cleanWikitext(fields['type'] ?? ''),
    primogems: Number.parseInt(fields['primogems'] ?? '0', 10) || 0,
    version,
    frTitle,
  };
}

// MediaWiki ne peut pas toujours résoudre generator + prop=langlinks en un seul aller :
// tant que les langlinks d'un lot de pages ne sont pas tous résolus, l'API renvoie les
// mêmes pages en boucle via `llcontinue` (sans le contenu, déjà obtenu au premier passage)
// avant de fournir `gcmcontinue` pour avancer au lot suivant. On doit donc suivre l'objet
// `continue` tel quel (pas seulement gcmcontinue) et fusionner les pages déjà vues par titre.
async function fetchRawPage(continueParams?: Record<string, string>): Promise<{
  pages: any[];
  nextContinueParams?: Record<string, string>;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Achievements',
    gcmlimit: '50',
    prop: 'revisions|langlinks',
    rvprop: 'content',
    rvslots: 'main',
    lllang: 'fr',
    format: 'json',
    formatversion: '2',
    ...continueParams,
  };

  const response = await axios.get(EN_API_URL, {
    params,
    headers: HTTP_HEADERS,
    httpsAgent,
  });

  return {
    pages: response.data?.query?.pages ?? [],
    nextContinueParams: response.data?.continue,
  };
}

async function fetchAll(): Promise<RawAchievement[]> {
  const byPageTitle = new Map<string, RawAchievement>();
  let continueParams: Record<string, string> | undefined;
  let round = 1;

  do {
    console.log(`Fetching batch ${round}...`);
    const { pages, nextContinueParams } = await fetchRawPage(continueParams);

    for (const page of pages) {
      const frTitle: string | null = page.langlinks?.[0]?.title ?? null;
      const existing = byPageTitle.get(page.title);
      if (existing) {
        if (frTitle) existing.frTitle = frTitle;
        continue;
      }
      const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
      const parsed = parseAchievementPage(page.title, content, frTitle);
      if (parsed) byPageTitle.set(page.title, parsed);
    }

    continueParams = nextContinueParams;
    round++;
    await new Promise((r) => setTimeout(r, 500));
  } while (continueParams);

  return Array.from(byPageTitle.values());
}

// ── API FR ────────────────────────────────────────────────────────────────────

// Sur le wiki FR, le champ |nom= de l'infobox est souvent laissé vide (le titre affiché
// vient alors du titre de la page elle-même, éventuellement suivi de "(succès)"/"(rang N)").
function stripFrPageTitleSuffixes(pageTitle: string): string {
  return pageTitle
    .replace(/\s*\(succès\)\s*$/i, '')
    .replace(/\s*\(rang\s+\d+\)\s*$/i, '')
    .trim();
}

function parseFrFields(pageTitle: string, content: string): FrFields | null {
  const infoboxMatch = /\{\{Infobox[ _]Succès/i.exec(content);
  if (!infoboxMatch) return null;

  const block = extractBracedBlock(content, infoboxMatch[0]);
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  return {
    title:
      cleanWikitext(fields['nom'] ?? '') || stripFrPageTitleSuffixes(pageTitle),
    description: cleanWikitext(fields['description'] ?? ''),
    category: cleanWikitext(fields['catégorie'] ?? ''),
    requirements: cleanWikitext(fields['prérequis'] ?? ''),
  };
}

async function fetchFrFieldsBatch(
  titles: string[],
): Promise<Map<string, FrFields>> {
  const result = new Map<string, FrFields>();
  const params: Record<string, string> = {
    action: 'query',
    titles: titles.join('|'),
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  };

  const response = await axios.get(FR_API_URL, {
    params,
    headers: HTTP_HEADERS,
    httpsAgent,
  });

  const pages = response.data?.query?.pages ?? [];
  for (const page of pages) {
    if (page.missing) continue;
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    const fields = parseFrFields(page.title, content);
    if (fields) result.set(page.title, fields);
  }
  return result;
}

// Version unitaire de fetchFrFieldsBatch, utilisée par les repli ci-dessous
// (titre deviné/trouvé un par un, pas de bénéfice à grouper).
async function fetchFrFieldsSingle(title: string): Promise<FrFields | null> {
  try {
    const batch = await withRetry(`fetch page FR "${title}"`, () =>
      fetchFrFieldsBatch([title]),
    );
    return batch.get(title) ?? null;
  } catch (err) {
    console.warn(`⚠️  Échec du fetch FR pour "${title}": ${err}`);
    return null;
  }
}

// Repli 1 : le langlink [[fr:...]] groupé (fetchRawPage) peut manquer côté
// cache/continuation même quand il existe réellement sur le wiki (cf. NOTE
// dans fetchRawPage) — une requête dédiée par page le retrouve parfois.
async function fetchFrTitleDirect(pageTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch langlink FR "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'langlinks',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      return page?.langlinks?.[0]?.title ?? null;
    });
  } catch (err) {
    console.warn(
      `⚠️  Échec du fetch langlink FR pour "${pageTitle}" après plusieurs tentatives: ${err}`,
    );
    return null;
  }
}

// Repli 2 : quand aucun langlink n'existe (page EN pas encore cross-linkée
// vers le wiki FR récemment créé, cf. cas "6EQUJ5"), la page FR partage
// souvent exactement le même titre que la page EN, éventuellement suffixé de
// "(succès)"/"(rang N)" en cas d'ambiguïté (cf. stripFrPageTitleSuffixes).
async function guessFrFieldsByTitle(
  entryTitle: string,
): Promise<FrFields | null> {
  for (const candidate of [entryTitle, `${entryTitle} (succès)`]) {
    const fields = await fetchFrFieldsSingle(candidate);
    if (fields) return fields;
  }
  return null;
}

// Repli 3 : la page FR existe sous un titre différent (ex: décoration avec
// guillemets français « ... »). On cherche par titre sur le wiki FR puis on
// vérifie chaque candidat via son propre langlink [[en:...]] pour confirmer
// qu'il pointe bien vers NOTRE page EN, avant d'accepter la traduction (évite
// de faire correspondre un succès à un autre par similarité de titre).
async function searchFrPageTitles(query: string): Promise<string[]> {
  try {
    return await withRetry(`search FR "${query}"`, async () => {
      const response = await axios.get(FR_API_URL, {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          srnamespace: '0',
          srlimit: '5',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const results = response.data?.query?.search ?? [];
      return results.map((r: { title: string }) => r.title);
    });
  } catch (err) {
    console.warn(`⚠️  Échec de la recherche FR pour "${query}": ${err}`);
    return [];
  }
}

async function fetchEnLanglinkOfFrPage(
  frPageTitle: string,
): Promise<string | null> {
  try {
    return await withRetry(`fetch langlink EN de "${frPageTitle}"`, async () => {
      const response = await axios.get(FR_API_URL, {
        params: {
          action: 'query',
          titles: frPageTitle,
          prop: 'langlinks',
          lllang: 'en',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      return page?.langlinks?.[0]?.title ?? null;
    });
  } catch (err) {
    console.warn(
      `⚠️  Échec du fetch langlink EN pour "${frPageTitle}": ${err}`,
    );
    return null;
  }
}

async function searchFrFieldsByTitle(
  entry: RawAchievement,
): Promise<FrFields | null> {
  const candidates = await searchFrPageTitles(entry.title);
  for (const candidateTitle of candidates) {
    const enBack = await fetchEnLanglinkOfFrPage(candidateTitle);
    if (enBack === entry.pageTitle) {
      const fields = await fetchFrFieldsSingle(candidateTitle);
      if (fields) return fields;
    }
  }
  return null;
}

// Chaîne de repli complète pour un succès sans traduction FR résolue via le
// langlink groupé initial (fetchAll) : retry direct -> titre deviné -> recherche
// + vérification par langlink retour. Chaque étape ne coûte des requêtes que
// pour les entrées effectivement en échec (39 sur ~1758 en pratique).
async function resolveFrFieldsFallback(
  entry: RawAchievement,
): Promise<FrFields | null> {
  const directTitle = await fetchFrTitleDirect(entry.pageTitle);
  if (directTitle) {
    const fields = await fetchFrFieldsSingle(directTitle);
    if (fields) return fields;
  }

  const guessed = await guessFrFieldsByTitle(entry.title);
  if (guessed) return guessed;

  return searchFrFieldsByTitle(entry);
}

// L'API MediaWiki accepte jusqu'à 50 titres par requête (utilisateurs non-bot).
// Résultat indexé par pageTitle EN (et non plus par frTitle) : cela permet de
// couvrir aussi bien le chemin rapide (langlink groupé) que les repli
// ci-dessus, qui ne connaissent pas nécessairement de frTitle a priori.
async function fetchAllFrFields(
  achievements: RawAchievement[],
): Promise<Map<string, FrFields>> {
  const result = new Map<string, FrFields>();

  const withTitle = achievements.filter(
    (a): a is RawAchievement & { frTitle: string } => a.frTitle !== null,
  );
  const pageTitleByFrTitle = new Map(
    withTitle.map((a) => [a.frTitle, a.pageTitle]),
  );
  const frTitles = withTitle.map((a) => a.frTitle);
  const chunkSize = 50;
  const totalChunks = Math.ceil(frTitles.length / chunkSize);

  for (let i = 0; i < frTitles.length; i += chunkSize) {
    const chunk = frTitles.slice(i, i + chunkSize);
    console.log(`Fetching FR batch ${i / chunkSize + 1}/${totalChunks}...`);
    const batch = await fetchFrFieldsBatch(chunk);
    for (const [frTitle, fields] of batch) {
      const pageTitle = pageTitleByFrTitle.get(frTitle);
      if (pageTitle) result.set(pageTitle, fields);
    }
    await sleep(500);
  }

  const unresolved = achievements.filter((a) => !result.has(a.pageTitle));
  if (unresolved.length > 0) {
    console.log(
      `Attempting FR fallback resolution for ${unresolved.length} achievement(s) without a usable langlink...`,
    );
    for (const entry of unresolved) {
      const fields = await resolveFrFieldsFallback(entry);
      if (fields) {
        result.set(entry.pageTitle, fields);
        console.log(`  ✅ Resolved FR via fallback for "${entry.pageTitle}"`);
      }
      await sleep(300);
    }
  }

  return result;
}

// ── Output ────────────────────────────────────────────────────────────────────

// Deux titres distincts peuvent se réduire au même slug une fois la ponctuation
// retirée (ex: "The Finishing Touch" vs "The Finishing Touch?") : on désambiguïse
// pour éviter d'écraser un fichier déjà écrit.
function nextAvailableFilename(
  baseSlug: string,
  tier: number,
  multiTier: boolean,
  usedFilenames: Set<string>,
): string {
  const build = (suffix?: number) => {
    const slug = suffix ? `${baseSlug}-${suffix}` : baseSlug;
    return multiTier ? `${slug}_${toRoman(tier)}.json` : `${slug}.json`;
  };

  let filename = build();
  let suffix = 2;
  while (usedFilenames.has(filename)) {
    filename = build(suffix);
    suffix++;
  }
  return filename;
}

interface LocalizedText {
  title: string;
  description: string;
  category: string;
  requirements: string;
}

// Pour l'anglais, les champs traduits sont déjà portés par l'entrée EN elle-même.
// Pour les autres langues, la traduction a été résolue en amont par
// fetchAllFrFields (langlink groupé, ou l'un des repli en cas d'échec) et
// indexée par pageTitle EN ; si rien n'a pu être résolu, on saute.
function resolveLocalizedText(
  lang: Lang,
  entry: RawAchievement,
  frFieldsByPageTitle: Map<string, FrFields>,
): LocalizedText | null {
  if (lang === 'en') return entry;
  return frFieldsByPageTitle.get(entry.pageTitle) || null;
}

function writeAchievementFile(
  dir: string,
  filename: string,
  entry: RawAchievement,
  text: LocalizedText,
) {
  const output = {
    title: text.title,
    description: text.description,
    category: text.category,
    hidden: entry.hidden,
    releaseVersion: entry.version,
    reward: { item: 'Primogem', quantity: entry.primogems },
    type: entry.type,
    requirements: text.requirements,
    tier: entry.tier,
  };

  fs.writeFileSync(
    path.join(dir, filename),
    JSON.stringify(output, null, 2),
    'utf-8',
  );
}

function writeAchievementFiles(
  lang: Lang,
  achievements: RawAchievement[],
  frFieldsByPageTitle: Map<string, FrFields>,
  versionFilter?: string[],
) {
  const dir = outputDir(lang);
  fs.mkdirSync(dir, { recursive: true });

  const filtered = versionFilter?.length
    ? achievements.filter((a) => versionFilter.includes(a.version))
    : achievements;

  // Le regroupement/slug de fichier se base toujours sur le titre EN canonique,
  // pour garder les mêmes noms de fichiers entre les dossiers en/ et fr/.
  const byTitle = new Map<string, RawAchievement[]>();
  for (const a of filtered) {
    if (!byTitle.has(a.title)) byTitle.set(a.title, []);
    byTitle.get(a.title)!.push(a);
  }

  const usedFilenames = new Set<string>();
  let written = 0;
  let skipped = 0;
  for (const [title, entries] of byTitle) {
    entries.sort((a, b) => a.tier - b.tier);
    const multiTier = entries.length > 1;
    const baseSlug = slugify(title);

    for (const entry of entries) {
      const text = resolveLocalizedText(lang, entry, frFieldsByPageTitle);
      if (!text) {
        console.warn(
          `⚠️  No ${lang} translation found for "${entry.pageTitle}", skipping.`,
        );
        skipped++;
        continue;
      }

      const filename = nextAvailableFilename(
        baseSlug,
        entry.tier,
        multiTier,
        usedFilenames,
      );
      usedFilenames.add(filename);
      writeAchievementFile(dir, filename, entry, text);
      written++;
    }
  }

  if (skipped > 0) {
    console.warn(
      `⚠️  Skipped ${skipped} achievement(s) with no ${lang} page on the wiki.`,
    );
  }
  console.log(`✅ Wrote ${written} achievement files to ${dir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== '--fetch') {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout (en)  : npx ts-node ... scrape-achievements.ts --fetch',
    );
    console.error('  Filtrer par version(s)     : ... --fetch 1.0 2.1');
    console.error(
      '  Générer dans une langue    : ... --fetch fr',
    );
    console.error('  Version(s) + langue        : ... --fetch 1.0 2.1 fr');
    process.exit(1);
  }

  const rest = args.slice(1);

  let lang: Lang = 'en';
  const lastArg = rest.at(-1);
  if (SUPPORTED_LANGS.has(lastArg as Lang)) {
    lang = lastArg as Lang;
    rest.pop();
  }
  const versionFilter = rest;

  console.log(
    'Fetching all achievements from wiki (this will take a few minutes)...',
  );
  const achievements = await fetchAll();

  // Indexé par pageTitle EN (cf. fetchAllFrFields) : couvre à la fois le
  // chemin rapide (langlink groupé) et les repli pour les pages sans langlink
  // utilisable.
  let frFieldsByPageTitle = new Map<string, FrFields>();
  if (lang === 'fr') {
    console.log(
      `Fetching FR translations for ${achievements.length} achievements from wiki (this will take a while)...`,
    );
    frFieldsByPageTitle = await fetchAllFrFields(achievements);
  }

  writeAchievementFiles(
    lang,
    achievements,
    frFieldsByPageTitle,
    versionFilter.length ? versionFilter : undefined,
  );
}

main();
