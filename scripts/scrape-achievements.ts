// scripts/scrape-achievements.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Lang = 'en' | 'fr';
const SUPPORTED_LANGS: ReadonlySet<Lang> = new Set(['en', 'fr']);

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';

const CACHE_PATH = path.resolve(
  __dirname,
  './cache/achievements-raw-cache.json',
);
const FR_CACHE_PATH = path.resolve(
  __dirname,
  './cache/achievements-fr-cache.json',
);

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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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

// L'API MediaWiki accepte jusqu'à 50 titres par requête (utilisateurs non-bot).
async function fetchAllFrFields(
  frTitles: string[],
): Promise<Map<string, FrFields>> {
  const merged = new Map<string, FrFields>();
  const chunkSize = 50;
  const totalChunks = Math.ceil(frTitles.length / chunkSize);

  for (let i = 0; i < frTitles.length; i += chunkSize) {
    const chunk = frTitles.slice(i, i + chunkSize);
    console.log(`Fetching FR batch ${i / chunkSize + 1}/${totalChunks}...`);
    const batch = await fetchFrFieldsBatch(chunk);
    for (const [k, v] of batch) merged.set(k, v);
    await new Promise((r) => setTimeout(r, 500));
  }
  return merged;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadJsonCache<T>(cachePath: string): T | null {
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveJsonCache(cachePath: string, data: unknown, label: string) {
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  const count = Array.isArray(data)
    ? data.length
    : Object.keys(data as object).length;
  console.log(`✅ ${label} cache saved (${count} entries)`);
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
// Pour les autres langues, on va chercher la traduction via le lien interlangue
// [[fr:...]] capturé sur la page EN ; si la page n'existe pas sur ce wiki, on saute.
function resolveLocalizedText(
  lang: Lang,
  entry: RawAchievement,
  frFieldsByFrTitle: Map<string, FrFields>,
): LocalizedText | null {
  if (lang === 'en') return entry;
  return (entry.frTitle && frFieldsByFrTitle.get(entry.frTitle)) || null;
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
  frFieldsByFrTitle: Map<string, FrFields>,
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
      const text = resolveLocalizedText(lang, entry, frFieldsByFrTitle);
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

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout (en)  : npx ts-node ... scrape-achievements.ts --fetch',
    );
    console.error(
      '  Cache + générer tout (en)  : npx ts-node ... scrape-achievements.ts --cache',
    );
    console.error('  Filtrer par version(s)     : ... --cache 1.0 2.1');
    console.error(
      '  Générer dans une langue    : ... --cache fr           (ou --fetch fr)',
    );
    console.error('  Version(s) + langue        : ... --cache 1.0 2.1 fr');
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const rest = args.slice(1);

  let lang: Lang = 'en';
  const lastArg = rest.at(-1);
  if (SUPPORTED_LANGS.has(lastArg as Lang)) {
    lang = lastArg as Lang;
    rest.pop();
  }
  const versionFilter = rest;

  let achievements: RawAchievement[];

  if (useCache) {
    const cached = loadJsonCache<RawAchievement[]>(CACHE_PATH);
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    achievements = cached;
    console.log(`Loaded ${achievements.length} achievements from cache.`);
  } else {
    console.log(
      'Fetching all achievements from wiki (this will take a few minutes)...',
    );
    achievements = await fetchAll();
    saveJsonCache(CACHE_PATH, achievements, 'EN');
  }

  let frFieldsByFrTitle = new Map<string, FrFields>();
  if (lang === 'fr') {
    if (useCache) {
      const cached = loadJsonCache<Record<string, FrFields>>(FR_CACHE_PATH);
      if (!cached) {
        console.error('❌ No FR cache found. Run with --fetch fr first.');
        process.exit(1);
      }
      frFieldsByFrTitle = new Map(Object.entries(cached));
      console.log(
        `Loaded ${frFieldsByFrTitle.size} FR translations from cache.`,
      );
    } else {
      const frTitles = achievements
        .map((a) => a.frTitle)
        .filter((t): t is string => t !== null);
      console.log(
        `Fetching ${frTitles.length} FR translations from wiki (this will take a while)...`,
      );
      frFieldsByFrTitle = await fetchAllFrFields(frTitles);
      saveJsonCache(FR_CACHE_PATH, Object.fromEntries(frFieldsByFrTitle), 'FR');
    }
  }

  writeAchievementFiles(
    lang,
    achievements,
    frFieldsByFrTitle,
    versionFilter.length ? versionFilter : undefined,
  );
}

main();
