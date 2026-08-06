// scripts/scrape-creatures.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';
const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/creatures/${lang}`);
const CACHE_PATH = path.resolve(__dirname, './cache/creatures-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Category:Wildlife liste directement ~200 pages individuelles (pas de
// sous-catégories à parcourir séparément, contrairement à Category:Enemies) :
// une seule requête paginée suffit (fetchCategoryMembers, comme
// scrape-books.ts/scrape-domains.ts). Deux sous-catégories techniques
// apparaissent aussi dans les résultats (Category:Wildlife Families,
// Category:Wildlife Groups, ns=14) : elles sont naturellement filtrées par
// fetchCategoryMembers (ns !== 0).
//
// Chaque fiche créature utilise {{Wildlife Infobox|image|type|family|group|
// location|description}}. Le champ "type" vaut "Wildlife" pour une créature
// individuelle, vide sur certaines pages plus anciennes (ex: Rishboland
// Tiger, Spinocrocodile — traité comme "Wildlife" par défaut), ou "Wildlife
// Groups" pour les pages de présentation d'un groupe élémentaire/de variantes
// (ex: "Crystalfly", "Butterfly", "Shirakodai", "Weasel Thief" : pas de
// {{Card}} de butin, juste un renvoi vers les variantes qui, elles, sont déjà
// des pages individuelles distinctes dans la catégorie). Ces pages de groupe
// sont donc exclues (isGroupPage).
//
// Le butin ({{Card|Nom|Quantité}}) est documenté dans la section ==Drops==
// du wikitext brut, comme la plupart des autres champs : contrairement à
// scrape-enemies.ts, aucune donnée utile n'est calculée uniquement côté HTML
// rendu pour les créatures (pas de stats de combat détaillées par niveau), ce
// script suit donc le pattern "léger" de scrape-books.ts (wikitext seul,
// pas de cheerio).
//
// ── Poissons / "Maintenance Mek" ────────────────────────────────────────────
//
// Une quarantaine de pages listées dans Category:Wildlife (tous les poissons
// pêchables, ex: "Abiding Angelfish", "Medaka", "Snowstrider", et les robots
// "Maintenance Mek: ...") n'utilisent PAS {{Wildlife Infobox}} mais
// {{Item Infobox|type=Fish|lbFamily=...|lbGroup=...|lbType=Wildlife|bait=...}}
// : sur ce wiki, ces créatures sont cataloguées côté "Materials" (pêche),
// avec malgré tout trois champs "lb*" (living beings) qui les rattachent à
// Wildlife. On les traite donc comme des créatures à part entière
// (parseEnFishInfobox), filtrées sur lbType=Wildlife pour exclure les autres
// items ordinaires. Elles n'ont pas de section ==Drops== (elles sont pêchées,
// pas tuées) : drops est toujours [] pour ces pages, et bait (l'appât
// nécessaire) est renseigné à la place.
//
// ── FR ────────────────────────────────────────────────────────────────────
//
// La page FR ({{Infobox Faune|type=faune|famille=...|groupe=...|image=...|
// emplacement=...}}) ne contient PAS la description dans l'infobox
// elle-même (contrairement à l'EN) : selon les pages, elle est soit dans un
// bloc {{Quote|...|Description Archive}} juste après l'infobox (ex: Renard
// écarlate), soit dans une section ==Description== dédiée (ex: Écureuil). On
// essaie les deux, dans cet ordre.
//
// Le butin FR ({{Objet|Nom|s=taille}} xN ou {{Objet|Nom}} xN) est documenté
// dans la section ==Butin==, avec la quantité en dehors du template
// (contrairement à l'EN où {{Card|Nom|Quantité}} porte la quantité en 2e
// paramètre positionnel).
//
// Les poissons FR utilisent {{Infobox objet|description=...|appât=...}} (le
// même template générique que les matériaux, cf. scrape-materials.ts) : pas
// de famille/groupe/localisation exploitables côté FR pour ces pages, ces
// trois champs restent donc repris tels quels de l'EN (comme le reste du
// contenu non traduisible pour les créatures sans page FR, cf. ci-dessous).
//
// Comme pour scrape-enemies.ts/scrape-domains.ts : si aucune page FR dédiée
// n'existe (pas de langlink), on retombe sur le nom documenté par
// {{Other Languages|fr=...}} sur la page EN, sinon sur le nom EN tel quel ;
// le reste du contenu (family/group/location/description/drops) reste alors
// en anglais faute de source FR.
// ─────────────────────────────────────────────────────────────────────────────

interface Drop {
  name: string;
  quantity: number;
}

interface CreatureOutput {
  name: string;
  family: string;
  group: string;
  location: string;
  description: string;
  image: string | null;
  drops: Drop[];
  releaseVersion: string;
  // Poissons uniquement (cf. NOTE en tête de fichier) : appât nécessaire
  // pour les pêcher. Absent pour les créatures "terrestres/aériennes"
  // classiques ({{Wildlife Infobox}}).
  bait?: string;
}

interface RawCreature {
  pageTitle: string;
  en: CreatureOutput;
  frTitle: string | null;
  otherLanguagesFrName: string | null;
}

interface CachedCreature {
  pageTitle: string;
  en: CreatureOutput;
  fr: CreatureOutput;
}

// ── Wikitext helpers (repris tels quels de scrape-enemies.ts/scrape-books.ts) ──

function extractBracedBlock(content: string, startMarker: string): string | null {
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

function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const markers = [...block.matchAll(/\|\s*([\w' -]+?)\s*=\s*/g)];
  for (let i = 0; i < markers.length; i++) {
    const key = markers[i][1].trim();
    const valueStart = markers[i].index! + markers[i][0].length;
    const valueEnd = i + 1 < markers.length ? markers[i + 1].index! : block.length;
    fields[key] = block.slice(valueStart, valueEnd).replace(/\}\}\s*$/, '').trim();
  }
  return fields;
}

// Variante accentuée pour l'infobox FR ({{Infobox Faune}}, champs "famille",
// "emplacement", ...), non couverts par \w en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const markers = [...block.matchAll(/\|\s*([^=|]+?)\s*=\s*/g)];
  for (let i = 0; i < markers.length; i++) {
    const key = markers[i][1].trim();
    const valueStart = markers[i].index! + markers[i][0].length;
    const valueEnd = i + 1 < markers.length ? markers[i + 1].index! : block.length;
    fields[key] = block.slice(valueStart, valueEnd).replace(/\}\}\s*$/, '').trim();
  }
  return fields;
}

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp(`[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`, 'g'),
      '',
    )
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Isole le contenu d'une section "==Titre==" jusqu'au prochain heading de
// même niveau ou supérieur (repris de scrape-books.ts).
function extractSection(content: string, heading: string): string | null {
  const marker = `==${heading}==`;
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  const nextHeading = content.slice(start).search(/\n==[^=]/);
  return nextHeading === -1 ? content.slice(start) : content.slice(start, start + nextHeading);
}

// {{Card|Raw Meat|2}} — un {{Card}} par ligne de butin (rarement plusieurs
// items différents sur une même page, ex: variantes de récompense).
function parseEnDrops(section: string | null): Drop[] {
  if (!section) return [];
  const drops: Drop[] = [];
  for (const match of section.matchAll(/\{\{Card\|([^|}]+)\|(\d+)\}\}/g)) {
    drops.push({ name: cleanWikitext(match[1]), quantity: parseInt(match[2], 10) });
  }
  return drops;
}

// "* {{Objet|Viande crue|s=50}} x2" ou "*{{Objet|Viande crue}} x1" : la
// quantité est toujours en dehors du template côté FR, contrairement à l'EN.
function parseFrDrops(section: string | null): Drop[] {
  if (!section) return [];
  const drops: Drop[] = [];
  for (const match of section.matchAll(/\{\{Objet\|([^|}]+)(?:\|[^}]*)?\}\}\s*x(\d+)/g)) {
    drops.push({ name: cleanWikitext(match[1]), quantity: parseInt(match[2], 10) });
  }
  return drops;
}

// Pages de présentation d'un groupe élémentaire/de variantes (Crystalfly,
// Butterfly, Shirakodai, Weasel Thief, ...) : pas de créature individuelle,
// cf. NOTE en tête de fichier.
function isGroupPage(rawType: string): boolean {
  return /^wildlife groups$/i.test(rawType.trim());
}

// Le champ "image" est presque toujours un simple nom de fichier
// ("Fichier.png" ou "Fichier.png|légende"), mais certaines pages de
// présentation de groupe (ex: "Butterfly", dont le type reste "Wildlife" au
// lieu de "Wildlife Groups" comme les autres pages de groupe — incohérence
// du wiki lui-même) y placent directement une balise <gallery> multi-lignes
// listant toutes les variantes : on prend alors la première entrée listée.
function extractImageFilename(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^<gallery/i.test(trimmed)) {
    const firstLine = trimmed
      .replace(/^<gallery[^>]*>/i, '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    if (!firstLine) return null;
    return firstLine.split('|')[0].trim() || null;
  }
  return trimmed.split('|')[0].trim() || null;
}

function parseOtherLanguagesField(content: string, lang: string): string | null {
  const block = extractBracedBlock(content, '{{Other Languages');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  const value = fields[lang];
  return value ? cleanWikitext(value) : null;
}

function parseEnCreatureName(fields: Record<string, string>, pageTitle: string): string {
  return fields['name']
    ? cleanWikitext(fields['name'])
    : pageTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function parseEnWildlifeInfobox(pageTitle: string, content: string): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Wildlife Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  if (isGroupPage(fields['type'] ?? '')) return null;

  const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);

  return {
    name: parseEnCreatureName(fields, pageTitle),
    family: cleanWikitext(fields['family'] ?? ''),
    group: cleanWikitext(fields['group'] ?? ''),
    location: cleanWikitext(fields['location'] ?? ''),
    description: cleanWikitext(fields['description'] ?? ''),
    image: fields['image'] ? extractImageFilename(fields['image']) : null,
    drops: parseEnDrops(extractSection(content, 'Drops')),
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
  };
}

// Poissons pêchables / "Maintenance Mek" (cf. NOTE en tête de fichier) :
// {{Item Infobox}} au lieu de {{Wildlife Infobox}}, filtré sur
// lbType=Wildlife pour exclure les items ordinaires (qui utilisent le même
// template sans ces 3 champs "lb*").
function parseEnFishInfobox(pageTitle: string, content: string): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Item Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  if (!/^wildlife$/i.test((fields['lbType'] ?? '').trim())) return null;

  const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);

  return {
    name: parseEnCreatureName(fields, pageTitle),
    family: cleanWikitext(fields['lbFamily'] ?? ''),
    group: cleanWikitext(fields['lbGroup'] ?? ''),
    location: cleanWikitext(fields['location'] ?? ''),
    description: cleanWikitext(fields['description'] ?? ''),
    image: fields['image'] ? extractImageFilename(fields['image']) : null,
    drops: [], // pêché, pas tué : pas de {{Card}} de butin pour ces pages
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
    bait: fields['bait'] ? cleanWikitext(fields['bait']) : undefined,
  };
}

function parseEnCreaturePage(pageTitle: string, content: string): CreatureOutput | null {
  return parseEnWildlifeInfobox(pageTitle, content) ?? parseEnFishInfobox(pageTitle, content);
}

function extractFrDescription(content: string): string {
  const quoteBlock = extractBracedBlock(content, '{{Quote');
  if (quoteBlock) {
    // {{Quote|texte...|Description Archive}} : le texte est le 1er paramètre
    // positionnel, la source ("Description Archive") le dernier — on ne
    // garde que ce qui précède le dernier "|".
    const inner = quoteBlock.slice(2, -2).replace(/^Quote\s*\|/, '');
    const lastPipe = inner.lastIndexOf('|');
    return cleanWikitext(lastPipe === -1 ? inner : inner.slice(0, lastPipe));
  }
  const section = extractSection(content, 'Description');
  if (!section) return '';
  // Certaines pages laissent en toutes lettres un résidu de template
  // orphelin en fin de section (ex: "...jours.|Description Archives}}" sur
  // "Ibis violet", sans "{{Quote" correspondant en amont — coquille propre
  // au wiki, pas un vrai {{Quote}} imbriqué) : on le retire s'il traîne.
  return cleanWikitext(section).replace(/\s*\|[^|{}]{0,60}\}\}\s*$/, '');
}

function parseFrWildlifeInfobox(frTitle: string, content: string): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Infobox Faune');
  if (!block) return null;
  const fields = parseInfoboxFieldsAccented(block);

  const versionMatch = content.match(/\{\{Historique\|([^}|]+)/);

  return {
    name: frTitle,
    family: cleanWikitext(fields['famille'] ?? ''),
    group: cleanWikitext(fields['groupe'] ?? ''),
    location: cleanWikitext(fields['emplacement'] ?? ''),
    description: extractFrDescription(content),
    image: fields['image'] ? extractImageFilename(fields['image']) : null,
    drops: parseFrDrops(extractSection(content, 'Butin')),
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
  };
}

// Poissons FR : {{Infobox objet}} (même template générique que les
// matériaux, cf. NOTE en tête de fichier) — pas de champ famille/groupe/
// localisation exploitable, on reprend ceux de l'EN (enFallback).
function parseFrFishInfobox(
  frTitle: string,
  content: string,
  enFallback: CreatureOutput,
): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Infobox objet');
  if (!block) return null;
  const fields = parseInfoboxFieldsAccented(block);

  const versionMatch = content.match(/\{\{Historique\|([^}|]+)/);

  return {
    name: frTitle,
    family: enFallback.family,
    group: enFallback.group,
    location: enFallback.location,
    description: fields['description'] ? cleanWikitext(fields['description']) : enFallback.description,
    image: fields['icon'] ? extractImageFilename(fields['icon']) : enFallback.image,
    drops: [],
    releaseVersion: versionMatch ? versionMatch[1].trim() : enFallback.releaseVersion,
    bait: fields['appât'] ? cleanWikitext(fields['appât']) : enFallback.bait,
  };
}

function parseFrCreaturePage(
  frTitle: string,
  content: string,
  enFallback: CreatureOutput,
): CreatureOutput | null {
  return (
    parseFrWildlifeInfobox(frTitle, content) ?? parseFrFishInfobox(frTitle, content, enFallback)
  );
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.warn(`⚠️  ${label} a échoué (tentative ${i + 1}/${attempts}), nouvel essai...`);
        await sleep(800 * (i + 1));
      }
    }
  }
  throw lastErr;
}

async function fetchCategoryMembers(category: string): Promise<string[]> {
  const titles: string[] = [];
  let continueParams: Record<string, string> | undefined;
  do {
    const response = await withRetry(`fetch category "${category}"`, () =>
      axios.get(EN_API_URL, {
        params: {
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${category}`,
          cmlimit: '500',
          format: 'json',
          formatversion: '2',
          ...continueParams,
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      }),
    );
    for (const member of response.data?.query?.categorymembers ?? []) {
      if (member.ns === 0) titles.push(member.title);
    }
    continueParams = response.data?.continue;
    await sleep(300);
  } while (continueParams);
  return titles;
}

async function fetchWikitextWithLanglink(
  pageTitle: string,
): Promise<{ content: string | null; frTitle: string | null }> {
  const response = await axios.get(EN_API_URL, {
    params: {
      action: 'query',
      titles: pageTitle,
      prop: 'revisions|langlinks',
      rvprop: 'content',
      rvslots: 'main',
      lllang: 'fr',
      format: 'json',
      formatversion: '2',
    },
    headers: HTTP_HEADERS,
    httpsAgent,
  });
  const page = response.data?.query?.pages?.[0];
  if (!page || page.missing) return { content: null, frTitle: null };
  return {
    content: page.revisions?.[0]?.slots?.main?.content ?? null,
    frTitle: page.langlinks?.[0]?.title ?? null,
  };
}

async function fetchFrWikitext(frTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext FR "${frTitle}"`, async () => {
      const response = await axios.get(FR_API_URL, {
        params: {
          action: 'query',
          titles: frTitle,
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return null;
      return page.revisions?.[0]?.slots?.main?.content ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch wikitext FR pour "${frTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

async function scrapeCreature(pageTitle: string): Promise<RawCreature | null> {
  const { content, frTitle } = await withRetry(`fetch wikitext "${pageTitle}"`, () =>
    fetchWikitextWithLanglink(pageTitle),
  );
  if (!content) return null;

  const en = parseEnCreaturePage(pageTitle, content);
  if (!en) return null; // pas de {{Wildlife Infobox}} exploitable, ou page de groupe

  return {
    pageTitle,
    en,
    frTitle,
    otherLanguagesFrName: parseOtherLanguagesField(content, 'fr'),
  };
}

async function scrapeAll(pageTitles: string[]): Promise<RawCreature[]> {
  const results: RawCreature[] = [];
  for (let i = 0; i < pageTitles.length; i++) {
    console.log(`Scraping "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    try {
      const creature = await scrapeCreature(pageTitles[i]);
      if (creature) results.push(creature);
    } catch (err) {
      console.warn(`⚠️  Échec du scraping de "${pageTitles[i]}": ${err}`);
    }
    await sleep(300);
  }
  return results;
}

async function enrichWithFrench(raw: RawCreature): Promise<CachedCreature> {
  const fallbackName = raw.otherLanguagesFrName || raw.en.name;
  const fallbackFr = (): CreatureOutput => ({ ...raw.en, name: fallbackName });

  let fr: CreatureOutput;
  if (raw.frTitle) {
    const frContent = await fetchFrWikitext(raw.frTitle);
    const frPage = frContent ? parseFrCreaturePage(raw.frTitle, frContent, raw.en) : null;
    if (frPage) {
      fr = frPage;
    } else {
      console.warn(
        `⚠️  "${raw.pageTitle}": page FR "${raw.frTitle}" introuvable ou sans {{Infobox Faune}}/{{Infobox objet}} exploitable, fichier fr/ écrit avec le nom "${fallbackName}".`,
      );
      fr = fallbackFr();
    }
  } else {
    console.warn(`⚠️  "${raw.pageTitle}": aucune page FR trouvée, fichier fr/ écrit avec le nom "${fallbackName}".`);
    fr = fallbackFr();
  }

  return { pageTitle: raw.pageTitle, en: raw.en, fr };
}

async function scrapeAndEnrichAll(pageTitles: string[]): Promise<CachedCreature[]> {
  const raws = await scrapeAll(pageTitles);
  const enriched: CachedCreature[] = [];
  for (let i = 0; i < raws.length; i++) {
    console.log(`Fetching FR page for "${raws[i].pageTitle}" (${i + 1}/${raws.length})...`);
    enriched.push(await enrichWithFrench(raws[i]));
    await sleep(300);
  }
  return enriched;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): CachedCreature[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(newData: CachedCreature[]) {
  const existing = loadCache() ?? [];
  const merged = new Map(existing.map((c) => [c.pageTitle, c]));
  for (const creature of newData) merged.set(creature.pageTitle, creature);
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify([...merged.values()], null, 2), 'utf-8');
  console.log(`✅ Cache saved (${merged.size} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeCreatureFiles(creatures: CachedCreature[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  for (const creature of creatures) {
    const filename = `${slugify(creature.en.name)}.json`;
    fs.writeFileSync(path.join(enDir, filename), JSON.stringify(creature.en, null, 2), 'utf-8');
    fs.writeFileSync(path.join(frDir, filename), JSON.stringify(creature.fr, null, 2), 'utf-8');
  }

  console.log(`✅ Wrote ${creatures.length} creature files (en/ + fr/) to ${enDir} / ${frDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache', '--fetch-category'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Fetch une liste de pages    : npx ts-node -r tsconfig-paths/register scripts/scrape-creatures.ts --fetch "Squirrel" "Crimson Fox"');
    console.error('  Fetch toute la catégorie     : npx ts-node -r tsconfig-paths/register scripts/scrape-creatures.ts --fetch-category');
    console.error('  Régénérer depuis le cache    : npx ts-node -r tsconfig-paths/register scripts/scrape-creatures.ts --cache');
    process.exit(1);
  }

  let creatures: CachedCreature[];

  if (args[0] === '--cache') {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch or --fetch-category first.');
      process.exit(1);
    }
    creatures = cached;
    console.log(`Loaded ${creatures.length} creatures from cache.`);
  } else {
    let pageTitles: string[];
    if (args[0] === '--fetch-category') {
      console.log('Fetching "Category:Wildlife" members...');
      pageTitles = await fetchCategoryMembers('Wildlife');
      console.log(`Found ${pageTitles.length} pages in category.`);
    } else {
      pageTitles = args.slice(1);
    }

    creatures = await scrapeAndEnrichAll(pageTitles);
    saveCache(creatures);
  }

  writeCreatureFiles(creatures);
}

main();
