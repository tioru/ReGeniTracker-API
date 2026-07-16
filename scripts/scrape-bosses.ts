// scripts/scrape-bosses.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/bosses/en');
const CACHE_PATH = path.resolve(__dirname, './cache/bosses-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Contrairement à Category:Domains / Category:Achievements, Category:Bosses
// ne contient aucune page directement : seulement deux sous-catégories,
// Category:Normal Bosses et Category:Weekly Bosses. On les interroge donc
// séparément puis on fusionne les résultats (dédoublonnage par pageTitle par
// précaution, même si les deux catégories sont normalement disjointes).
//
// Chaque page utilise {{Enemy Infobox}} (name/title/type/family/group/
// région/zone/dégâts/faiblesse/capacités/variantes/drops), complétée par
// {{World Boss Rewards}} (gemmes d'ascension, matériaux exclusifs, sets
// d'artéfacts) — confirmé sur Andrius (Weekly), Maguu Kenki et Golden
// Wolflord (Normal). Les stats de combat détaillées ({{Enemy Stats}},
// {{Energy Drops}}) ne sont volontairement pas exploitées ici : trop
// dépendantes du niveau/de la version pour être fiables sans vérification
// approfondie (même logique que les Trounce Domains laissés vides dans
// scrape-domains.ts).
//
// Certaines pages de la catégorie ne sont pas des boss mais des pages guides
// ("Normal Boss", "Weekly Boss") : elles n'ont pas de {{Enemy Infobox}} et
// sont donc naturellement filtrées, comme pour les achievements/domains.
// ─────────────────────────────────────────────────────────────────────────────

const BOSS_CATEGORIES = ['Category:Normal Bosses', 'Category:Weekly Bosses'];

interface RawBoss {
  pageTitle: string;
  name: string;
  title: string;
  type: string; // valeur brute de l'infobox : "Normal Bosses" | "Weekly Bosses"
  family: string;
  group: string;
  region: string;
  area: string;
  subArea: string;
  damageTypes: string[];
  hasWeakPoint: boolean;
  abilities: string[];
  variants: string[];
  drops: string[];
  artifactSets: string[];
  ascensionGems: string[];
  releaseVersion: string;
}

// ── Wikitext helpers (repris tels quels des scripts achievements/domains) ───

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

function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w -]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Sépare une liste séparée par des virgules ou "•"/retours à la ligne
// (ex: drops = "Tail of Boreas,Ring of Boreas,Spirit Locket of Boreas").
function splitList(value: string): string[] {
  return cleanWikitext(value)
    .split(/[,•\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Les variantes (ex: "Maguu Kenki: Lone Gale;Maguu Kenki: Galloping Frost")
// sont séparées par ";", pas par ",".
function splitSemicolon(value: string): string[] {
  return cleanWikitext(value)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// dmgtype (sans suffixe) puis dmgtype2, dmgtype3, ... selon le nombre
// d'éléments infligés par le boss.
function parseDamageTypes(fields: Record<string, string>): string[] {
  const types: string[] = [];
  if (fields['dmgtype']) types.push(cleanWikitext(fields['dmgtype']));
  for (let i = 2; ; i++) {
    const value = fields[`dmgtype${i}`];
    if (!value) break;
    types.push(cleanWikitext(value));
  }
  return types;
}

// ability1, ability2, ... jusqu'à la première absente.
function parseAbilities(fields: Record<string, string>): string[] {
  const abilities: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`ability${i}`];
    if (!value) break;
    abilities.push(cleanWikitext(value));
  }
  return abilities;
}

// Pas de |name= exploitable sur la plupart des pages (seul Andrius en a un) :
// on dérive du titre de page, en retirant les suffixes de désambiguïsation
// du type "Azhdaha (Weekly Boss)".
function extractBossName(
  fields: Record<string, string>,
  pageTitle: string,
): string {
  if (fields['name']) return cleanWikitext(fields['name']);
  return pageTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchBatch(
  category: string,
  gcmcontinue?: string,
): Promise<{
  results: RawBoss[];
  nextContinue?: string;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: category,
    gcmlimit: '50',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  };
  if (gcmcontinue) params.gcmcontinue = gcmcontinue;

  const response = await axios.get(API_URL, {
    params,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  });

  const pages = response.data?.query?.pages ?? [];
  const nextContinue = response.data?.continue?.gcmcontinue;
  const results: RawBoss[] = [];

  for (const page of pages) {
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    // Exclut les pages guides ("Normal Boss", "Weekly Boss") sans infobox.
    if (!content.includes('{{Enemy Infobox')) continue;

    const block = extractBracedBlock(content, '{{Enemy Infobox');
    if (!block) continue;
    const fields = parseInfoboxFields(block);

    const rewardsBlock = extractBracedBlock(content, '{{World Boss Rewards');
    const rewardsFields = rewardsBlock ? parseInfoboxFields(rewardsBlock) : {};

    const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);
    const version = versionMatch ? versionMatch[1].trim() : '';

    results.push({
      pageTitle: page.title,
      name: extractBossName(fields, page.title),
      title: cleanWikitext(fields['title'] ?? ''),
      type: cleanWikitext(fields['type'] ?? ''),
      family: cleanWikitext(fields['family'] ?? ''),
      group: cleanWikitext(fields['group'] ?? ''),
      region: cleanWikitext(fields['region'] ?? ''),
      area: cleanWikitext(fields['area'] ?? ''),
      subArea: cleanWikitext(fields['subarea'] ?? ''),
      damageTypes: parseDamageTypes(fields),
      hasWeakPoint: (fields['weakpoint'] ?? '').trim().toLowerCase() === 'yes',
      abilities: parseAbilities(fields),
      variants: splitSemicolon(fields['variants'] ?? ''),
      drops: splitList(fields['drops'] ?? ''),
      artifactSets: splitList(rewardsFields['sets'] ?? ''),
      ascensionGems: splitList(rewardsFields['gem'] ?? ''),
      releaseVersion: version,
    });
  }

  return { results, nextContinue };
}

async function fetchAllForCategory(category: string): Promise<RawBoss[]> {
  const all: RawBoss[] = [];
  let cont: string | undefined;
  let page = 1;
  do {
    console.log(`Fetching ${category} batch ${page}...`);
    const { results, nextContinue } = await fetchBatch(category, cont);
    all.push(...results);
    cont = nextContinue;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  } while (cont);
  return all;
}

async function fetchAll(): Promise<RawBoss[]> {
  const byPageTitle = new Map<string, RawBoss>();
  for (const category of BOSS_CATEGORIES) {
    const results = await fetchAllForCategory(category);
    for (const boss of results) byPageTitle.set(boss.pageTitle, boss);
  }
  return [...byPageTitle.values()];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): RawBoss[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: RawBoss[]) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${data.length} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────

// Le champ "type" de l'infobox donne directement "Normal Bosses" / "Weekly
// Bosses". On le transforme en libellé singulier lisible.
function bossTypeLabel(rawType: string): string {
  if (/^weekly bosses$/i.test(rawType)) return 'Weekly Boss';
  if (/^normal bosses$/i.test(rawType)) return 'Normal Boss';
  return rawType;
}

function writeBossFiles(bosses: RawBoss[], versionFilter?: string[]) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const filtered = versionFilter?.length
    ? bosses.filter((b) => versionFilter.includes(b.releaseVersion))
    : bosses;

  let written = 0;
  for (const boss of filtered) {
    const filename = `${slugify(boss.name)}.json`;

    const output = {
      name: boss.name,
      title: boss.title,
      type: bossTypeLabel(boss.type),
      family: boss.family,
      group: boss.group,
      location: {
        region: boss.region,
        area: boss.area,
        subArea: boss.subArea,
      },
      damageTypes: boss.damageTypes,
      hasWeakPoint: boss.hasWeakPoint,
      abilities: boss.abilities,
      variants: boss.variants,
      drops: boss.drops,
      artifactSets: boss.artifactSets,
      ascensionGems: boss.ascensionGems,
      releaseVersion: boss.releaseVersion,
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, filename),
      JSON.stringify(output, null, 2),
      'utf-8',
    );
    written++;
  }

  console.log(`✅ Wrote ${written} boss files to ${OUTPUT_DIR}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout    : npx ts-node ... scrape-bosses.ts --fetch',
    );
    console.error(
      '  Cache + générer tout     : npx ts-node ... scrape-bosses.ts --cache',
    );
    console.error('  Filtrer par version(s)   : ... --cache 2.3 3.0');
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versionFilter = args.slice(1);

  let bosses: RawBoss[];

  if (useCache) {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    bosses = cached;
    console.log(`Loaded ${bosses.length} bosses from cache.`);
  } else {
    console.log(
      'Fetching all bosses from wiki (this will take a few minutes)...',
    );
    bosses = await fetchAll();
    saveCache(bosses);
  }

  writeBossFiles(bosses, versionFilter.length ? versionFilter : undefined);
}

main();
