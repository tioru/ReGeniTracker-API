// scripts/check-staleness.ts
//
// Ne re-scrape rien : compare la date de dernière modification wiki de chaque
// page déjà en cache à la date à laquelle son cache a été committé (le
// meilleur proxy dont on dispose pour "quand on l'a scrapé", les caches
// n'enregistrant pas de revid MediaWiki). Toute page éditée depuis est
// signalée comme potentiellement périmée — à revérifier/re-scraper.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/check-staleness.ts
//   npx ts-node -r tsconfig-paths/register scripts/check-staleness.ts enemies weapons
//   npx ts-node -r tsconfig-paths/register scripts/check-staleness.ts --out report.json
//
// Le JSON produit (staleness-report.json par défaut) est fait pour être
// déposé dans l'onglet "Comparaison" de l'artifact de suivi.

import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const CACHE_DIR = path.resolve(__dirname, './cache');
const REPO_ROOT = path.resolve(__dirname, '..');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Repris tel quel de scrape-banners.ts ─────────────────────────────────────
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
]);

function isRetryableError(err: any): boolean {
  if (RETRYABLE_CODES.has(err?.code)) return true;
  const status = err?.response?.status;
  return status === 429 || status === 503;
}

async function axiosGetWithRetry(
  url: string,
  config: Record<string, unknown>,
  maxRetries = 4,
): Promise<any> {
  let attempt = 0;
  for (;;) {
    try {
      return await axios.get(url, config);
    } catch (err: any) {
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      const delay = 1000 * 2 ** attempt;
      console.error(
        `  ⚠️  ${err.code ?? err.response?.status} — retry dans ${delay}ms (tentative ${attempt + 1}/${maxRetries})`,
      );
      await sleep(delay);
      attempt++;
    }
  }
}

// ── Config par catégorie ─────────────────────────────────────────────────────

interface CategoryConfig {
  cacheFile: string;
  extractTitles: (data: any) => string[];
}

const CATEGORIES: Record<string, CategoryConfig> = {
  enemies: {
    cacheFile: 'enemies-raw-cache.json',
    extractTitles: (data) => data.map((e: any) => e.pageTitle),
  },
  domains: {
    cacheFile: 'domains-raw-cache.json',
    extractTitles: (data) => data.map((e: any) => e.pageTitle),
  },
  artifacts: {
    cacheFile: 'artifacts-raw-cache.json',
    extractTitles: (data) => data.map((e: any) => e.pageTitle),
  },
  weapons: {
    cacheFile: 'weapons-raw-cache.json',
    extractTitles: (data) => data.map((e: any) => e.pageTitle),
  },
  materials: {
    cacheFile: 'materials-raw-cache.json',
    extractTitles: (data) => data.map((e: any) => e.pageTitle),
  },
  achievements: {
    cacheFile: 'achievements-raw-cache.json',
    extractTitles: (data) => data.map((e: any) => e.pageTitle),
  },
};

// ── Date de dernier commit touchant le fichier de cache ──────────────────────

// Le fichier de cache peut ne pas encore être committé (ex: matériaux, encore
// en cours de constitution) : on retombe alors sur sa date de modification
// disque, moins fiable (perdue au clone/checkout) mais mieux que rien.
function lastCommitDate(absPath: string): { date: string | null; source: 'git' | 'mtime' | null } {
  const rel = path.relative(REPO_ROOT, absPath).replaceAll('\\', '/');
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--', rel],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    ).trim();
    if (out) return { date: out, source: 'git' };
  } catch {
    // ignore, on tente le fallback ci-dessous
  }
  try {
    return { date: fs.statSync(absPath).mtime.toISOString(), source: 'mtime' };
  } catch {
    return { date: null, source: null };
  }
}

// ── Revisions MediaWiki (batch de 50 titres, limite anonyme) ────────────────

interface RevisionInfo {
  title: string;
  lastEditedAt: string | null;
  missing: boolean;
}

const BATCH_SIZE = 50;

async function fetchRevisionTimestamps(
  titles: string[],
): Promise<Map<string, RevisionInfo>> {
  const result = new Map<string, RevisionInfo>();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const response = await axiosGetWithRetry(EN_API_URL, {
      httpsAgent,
      params: {
        action: 'query',
        prop: 'revisions',
        rvprop: 'timestamp',
        titles: batch.join('|'),
        format: 'json',
        redirects: 1,
      },
    });

    const pages = response.data?.query?.pages ?? {};
    const normalized: Record<string, string> = {};
    for (const n of response.data?.query?.normalized ?? []) {
      normalized[n.to] = n.from;
    }
    const redirected: Record<string, string> = {};
    for (const r of response.data?.query?.redirects ?? []) {
      redirected[r.to] = r.from;
    }

    for (const page of Object.values(pages) as any[]) {
      let originalTitle = page.title;
      if (redirected[originalTitle]) originalTitle = redirected[originalTitle];
      if (normalized[originalTitle]) originalTitle = normalized[originalTitle];

      result.set(originalTitle, {
        title: originalTitle,
        lastEditedAt: page.missing !== undefined
          ? null
          : (page.revisions?.[0]?.timestamp ?? null),
        missing: page.missing !== undefined,
      });
    }

    process.stdout.write(
      `\r  ${Math.min(i + BATCH_SIZE, titles.length)}/${titles.length} titres vérifiés`,
    );
    if (i + BATCH_SIZE < titles.length) await sleep(300);
  }
  console.log();

  return result;
}

// ── Rapport ───────────────────────────────────────────────────────────────

interface CategoryReport {
  category: string;
  cacheFile: string;
  lastScrapedAt: string | null;
  lastScrapedAtSource: 'git' | 'mtime' | null;
  totalPages: number;
  checkedPages: number;
  changedSinceScrape: { pageTitle: string; lastEditedAt: string }[];
  missingOnWiki: string[];
  errors: string[];
}

async function checkCategory(name: string): Promise<CategoryReport> {
  const config = CATEGORIES[name];
  const cachePath = path.join(CACHE_DIR, config.cacheFile);
  const report: CategoryReport = {
    category: name,
    cacheFile: config.cacheFile,
    lastScrapedAt: null,
    lastScrapedAtSource: null,
    totalPages: 0,
    checkedPages: 0,
    changedSinceScrape: [],
    missingOnWiki: [],
    errors: [],
  };

  if (!fs.existsSync(cachePath)) {
    report.errors.push(`Cache introuvable : ${cachePath}`);
    return report;
  }

  const { date, source } = lastCommitDate(cachePath);
  report.lastScrapedAt = date;
  report.lastScrapedAtSource = source;
  if (!report.lastScrapedAt) {
    report.errors.push('Impossible de déterminer la date de dernier scrape');
    return report;
  }
  if (source === 'mtime') {
    report.errors.push(
      "Cache non commité : date de dernier scrape approximée par la date de modification disque (moins fiable qu'un historique git)",
    );
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch (e: any) {
    report.errors.push(`Cache illisible : ${e.message}`);
    return report;
  }

  const titles = config.extractTitles(data);
  report.totalPages = titles.length;

  console.log(`\n📂 ${name} (${titles.length} pages, scrapé le ${report.lastScrapedAt.slice(0, 10)})`);

  try {
    const revisions = await fetchRevisionTimestamps(titles);
    const scrapedAt = new Date(report.lastScrapedAt).getTime();

    for (const title of titles) {
      const info = revisions.get(title);
      if (!info) continue;
      report.checkedPages++;
      if (info.missing) {
        report.missingOnWiki.push(title);
        continue;
      }
      if (info.lastEditedAt && new Date(info.lastEditedAt).getTime() > scrapedAt) {
        report.changedSinceScrape.push({
          pageTitle: title,
          lastEditedAt: info.lastEditedAt,
        });
      }
    }
  } catch (e: any) {
    report.errors.push(`Échec requête MediaWiki : ${e.message}`);
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : 'staleness-report.json';
  const categoryArgs = args.filter((a, i) => a !== '--out' && i !== outIdx + 1);

  const categories = categoryArgs.length ? categoryArgs : Object.keys(CATEGORIES);
  const unknown = categories.filter((c) => !CATEGORIES[c]);
  if (unknown.length) {
    console.error(`Catégorie(s) inconnue(s) : ${unknown.join(', ')}`);
    console.error(`Disponibles : ${Object.keys(CATEGORIES).join(', ')}`);
    process.exit(1);
  }

  const reports: CategoryReport[] = [];
  for (const category of categories) {
    reports.push(await checkCategory(category));
  }

  const totalChanged = reports.reduce((n, r) => n + r.changedSinceScrape.length, 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    categories: reports,
  };

  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log(`\n${'─'.repeat(60)}`);
  for (const r of reports) {
    const flag = r.changedSinceScrape.length > 0 ? '⚠️ ' : '✅';
    console.log(
      `${flag} ${r.category}: ${r.changedSinceScrape.length} page(s) modifiée(s) depuis le scrape` +
        (r.missingOnWiki.length ? `, ${r.missingOnWiki.length} disparue(s) du wiki` : '') +
        (r.errors.length ? `, erreurs: ${r.errors.join('; ')}` : ''),
    );
  }
  console.log(`\n${totalChanged} page(s) au total à revérifier. Rapport écrit dans ${outPath}`);
}

main();
