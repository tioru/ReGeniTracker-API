// scripts/scrape-achievements.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const VERSIONS_DIR = path.resolve(__dirname, '../prisma/data/versions/en');

interface AchievementCategory {
  category: string;
  achievements: string[];
}

interface AchievementEntry {
  name: string;
  category: string;
  version: string;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchBatch(cmcontinue?: string): Promise<{
  achievements: AchievementEntry[];
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

  if (cmcontinue) params.gcmcontinue = cmcontinue;

  const response = await axios.get(API_URL, {
    params,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  });

  const pages = response.data?.query?.pages ?? [];
  const nextContinue = response.data?.continue?.gcmcontinue;

  const achievements: AchievementEntry[] = [];

  for (const page of pages) {
    const content = page?.revisions?.[0]?.slots?.main?.content ?? '';
    if (!content.includes('Achievement Infobox')) continue;

    // Extrait le nom de la page (titre de l'achievement)
    const name = page.title
      .replace(/\s*\(Achievement\)\s*$/i, '') // retire "(Achievement)"
      .trim();

    // Extrait la catégorie depuis |category = ...
    const categoryMatch = content.match(/\|category\s*=\s*([^\n|]+)/);
    const category = categoryMatch ? categoryMatch[1].trim() : '';

    // Extrait la version depuis {{Change History|X.X}}
    const versionMatch = content.match(/{{Change History\|([^}|]+)/);
    const version = versionMatch ? versionMatch[1].trim() : '';

    if (name && category && version) {
      achievements.push({ name, category, version });
    }
  }

  return { achievements, nextContinue };
}

async function fetchAllAchievements(): Promise<AchievementEntry[]> {
  const all: AchievementEntry[] = [];
  let continueToken: string | undefined;
  let page = 1;

  do {
    console.log(`Fetching batch ${page}...`);
    const { achievements, nextContinue } = await fetchBatch(continueToken);
    all.push(...achievements);
    continueToken = nextContinue;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  } while (continueToken);

  return all;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function groupByCategory(
  achievements: AchievementEntry[],
  version: string,
): AchievementCategory[] {
  // Filtre par version exacte
  const filtered = achievements.filter((a) => a.version === version);

  // Grouper par catégorie
  const map = new Map<string, string[]>();
  for (const a of filtered) {
    if (!map.has(a.category)) map.set(a.category, []);
    map.get(a.category)!.push(a.name);
  }

  return Array.from(map.entries()).map(([category, achievements]) => ({
    category,
    achievements,
  }));
}

// ── Cache local ───────────────────────────────────────────────────────────────

const CACHE_PATH = path.resolve(__dirname, './cache/achievements-cache.json');

function loadCache(): AchievementEntry[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(achievements: AchievementEntry[]) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(achievements, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${achievements.length} achievements)`);
}

// ── Update version files ──────────────────────────────────────────────────────

function updateVersionFile(
  versionNumber: string,
  categories: AchievementCategory[],
) {
  const filePath = path.join(VERSIONS_DIR, `${versionNumber}.json`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  data.newAchievements = categories;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(
    `✅ Updated ${versionNumber}.json (${categories.reduce((acc, c) => acc + c.achievements.length, 0)} achievements)`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error(
      '  Fetch all + update versions : npx ts-node ... scrape-achievements.ts --fetch 1.0 1.1 3.5',
    );
    console.error(
      '  Use cache + update versions : npx ts-node ... scrape-achievements.ts --cache 1.0 1.1 3.5',
    );
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versions = args.slice(1);

  let allAchievements: AchievementEntry[];

  if (useCache) {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    allAchievements = cached;
    console.log(`Loaded ${allAchievements.length} achievements from cache.`);
  } else {
    // --fetch : récupère tout depuis le wiki
    console.log(
      'Fetching all achievements from wiki (this will take a few minutes)...',
    );
    allAchievements = await fetchAllAchievements();
    saveCache(allAchievements);
  }

  for (const version of versions) {
    const categories = groupByCategory(allAchievements, version);
    if (categories.length === 0) {
      console.warn(`⚠️  No achievements found for version ${version}`);
    }
    updateVersionFile(version, categories);
  }
}

main();
