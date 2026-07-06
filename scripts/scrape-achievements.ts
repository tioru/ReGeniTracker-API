// scripts/scrape-achievements.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/achievements/en');
const CACHE_PATH = path.resolve(
  __dirname,
  '../prisma/data/achievements-raw-cache.json',
);

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
function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w ]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Nettoie le wikitext : liens [[...]], gras/italique '' ''', templates simples résiduels.
function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchBatch(gcmcontinue?: string): Promise<{
  results: RawAchievement[];
  nextContinue?: string;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Achievements',
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
  const results: RawAchievement[] = [];

  for (const page of pages) {
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    // Exclut les pages "set" (Achievement Set Infobox) et autres pages sans infobox standard.
    if (!content.includes('{{Achievement Infobox')) continue;

    const block = extractBracedBlock(content, '{{Achievement Infobox');
    if (!block) continue;
    const fields = parseInfoboxFields(block);

    const { title, tier } = parseTitleAndTier(page.title);
    const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);
    const version = versionMatch ? versionMatch[1].trim() : '';

    results.push({
      pageTitle: page.title,
      title,
      tier,
      category: cleanWikitext(fields['category'] ?? ''),
      description: cleanWikitext(fields['description'] ?? ''),
      requirements: cleanWikitext(fields['requirements'] ?? ''),
      hidden: (fields['hidden'] ?? '').trim() === '1',
      type: cleanWikitext(fields['type'] ?? ''),
      primogems: parseInt(fields['primogems'] ?? '0', 10) || 0,
      version,
    });
  }

  return { results, nextContinue };
}

async function fetchAll(): Promise<RawAchievement[]> {
  const all: RawAchievement[] = [];
  let cont: string | undefined;
  let page = 1;
  do {
    console.log(`Fetching batch ${page}...`);
    const { results, nextContinue } = await fetchBatch(cont);
    all.push(...results);
    cont = nextContinue;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  } while (cont);
  return all;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): RawAchievement[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: RawAchievement[]) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${data.length} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeAchievementFiles(
  achievements: RawAchievement[],
  versionFilter?: string[],
) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const filtered = versionFilter?.length
    ? achievements.filter((a) => versionFilter.includes(a.version))
    : achievements;

  const byTitle = new Map<string, RawAchievement[]>();
  for (const a of filtered) {
    if (!byTitle.has(a.title)) byTitle.set(a.title, []);
    byTitle.get(a.title)!.push(a);
  }

  let written = 0;
  for (const [title, entries] of byTitle) {
    entries.sort((a, b) => a.tier - b.tier);
    const multiTier = entries.length > 1;
    const baseSlug = slugify(title);

    for (const entry of entries) {
      const filename = multiTier
        ? `${baseSlug}_${toRoman(entry.tier)}.json`
        : `${baseSlug}.json`;

      const output = {
        title: entry.title,
        description: entry.description,
        category: entry.category,
        hidden: entry.hidden,
        releaseVersion: entry.version,
        reward: { item: 'Primogem', quantity: entry.primogems },
        type: entry.type,
        requirements: entry.requirements,
        tier: entry.tier,
      };

      fs.writeFileSync(
        path.join(OUTPUT_DIR, filename),
        JSON.stringify(output, null, 2),
        'utf-8',
      );
      written++;
    }
  }

  console.log(`✅ Wrote ${written} achievement files to ${OUTPUT_DIR}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout    : npx ts-node ... scrape-achievements.ts --fetch',
    );
    console.error(
      '  Cache + générer tout     : npx ts-node ... scrape-achievements.ts --cache',
    );
    console.error('  Filtrer par version(s)   : ... --cache 1.0 2.1');
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versionFilter = args.slice(1);

  let achievements: RawAchievement[];

  if (useCache) {
    const cached = loadCache();
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
    saveCache(achievements);
  }

  writeAchievementFiles(
    achievements,
    versionFilter.length ? versionFilter : undefined,
  );
}

main();
