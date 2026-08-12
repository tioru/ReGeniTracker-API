// scripts/scrape-book-images.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const BOOKS_DATA_DIR = path.resolve(__dirname, '../prisma/data/books/en');
const OUTPUT_DIR = path.resolve(__dirname, '../assets/books');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// {{Book Infobox}} ET {{Book Collection Infobox}} ont TOUS DEUX un champ
// `image` direct en wikitext brut (ex: "Item A Nameless Adventurer's
// Notes.png" / "Book Thick Notebook.png") — même mécanisme que {{Item
// Infobox}} des matériaux (cf. NOTE de scrape-material-images.ts), pas de
// dérivation depuis PAGENAME comme pour {{Food Infobox}}. On résout ce nom de
// fichier en URL réelle via `action=query&prop=imageinfo`, avec le même repli
// HTML (rendu de l'infobox) que scrape-material-images.ts si jamais un livre
// s'avérait sans champ `image`.
//
// pageTitle vient du champ `name` de prisma/data/books/en/*.json (=
// pageTitle, cf. parseBookInfoboxEn dans scrape-books.ts), pas du cache
// scripts/cache/books-raw-cache.json qui, comme pour les matériaux, n'est pas
// garanti de contenir la liste cumulée de tous les livres déjà scrapés selon
// l'historique des runs (--fetch-category "Books" vs "Book Collections").
// ─────────────────────────────────────────────────────────────────────────────

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

async function fetchWikitext(pageTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pageTitle,
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
    console.warn(`⚠️  Échec du fetch wikitext pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

async function fetchHtml(pageTitle: string): Promise<string> {
  try {
    return await withRetry(`fetch HTML "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'parse',
          page: pageTitle,
          prop: 'text',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      return response.data?.parse?.text ?? '';
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch HTML pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return '';
  }
}

// Repli quand ni {{Book Infobox}} ni {{Book Collection Infobox}} n'ont de
// champ `image` en wikitext brut (cf. NOTE en tête de fichier) : on extrait
// l'URL déjà résolue depuis le HTML rendu (action=parse) plutôt que de
// reconstruire "Item {pageTitle}.png" (risque de divergence sur les noms
// avec apostrophes/guillemets).
function parseImageUrlFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  return $('figure.pi-image[data-source="image"] img').first().attr('src')?.trim() || null;
}

async function fetchImageUrl(fileName: string): Promise<string | null> {
  try {
    return await withRetry(`fetch imageinfo "${fileName}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: `File:${fileName}`,
          prop: 'imageinfo',
          iiprop: 'url',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      return page?.imageinfo?.[0]?.url ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch imageinfo pour "${fileName}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

async function downloadImageBuffer(url: string, label: string): Promise<Buffer | null> {
  try {
    return await withRetry(`download image "${label}"`, async () => {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      return Buffer.from(response.data);
    });
  } catch (err) {
    console.warn(`⚠️  Échec du téléchargement de l'image "${label}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`, 'g'), '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Ex: ".../images/8/8a/Item_A_Nameless_Adventurer's_Notes.png/revision/latest?cb=..."
// -> "png". Le "?cb=..." de fin (cache-buster) rend une simple lecture de
// path.extname() sur l'URL brute inutilisable.
function extensionFromUrl(url: string): string {
  const match = url.match(/\.([a-zA-Z0-9]+)\/revision\//);
  return match ? match[1].toLowerCase() : 'png';
}

function parseImageFileName(content: string): string | null {
  const block =
    content.match(/\{\{Book Collection Infobox[\s\S]*?\n\}\}/) ?? content.match(/\{\{Book Infobox[\s\S]*?\n\}\}/);
  if (!block) return null;
  const m = block[0].match(/^\|\s*image\s*=\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

async function scrapeBookImage(pageTitle: string): Promise<{ downloaded: number; skipped: number }> {
  const content = await fetchWikitext(pageTitle);
  if (!content) {
    console.warn(`⚠️  "${pageTitle}": page introuvable ou vide, ignorée.`);
    return { downloaded: 0, skipped: 0 };
  }

  const fileName = parseImageFileName(content);
  let url: string | null = null;

  if (fileName) {
    url = await fetchImageUrl(fileName);
    if (!url) {
      console.warn(`⚠️  "${pageTitle}": fichier "${fileName}" introuvable via imageinfo.`);
    }
  }

  if (!url) {
    const html = await fetchHtml(pageTitle);
    url = html ? parseImageUrlFromHtml(html) : null;
  }

  if (!url) {
    console.warn(`⚠️  "${pageTitle}": aucune image trouvée (ni champ "image", ni infobox rendue).`);
    return { downloaded: 0, skipped: 0 };
  }

  const ext = extensionFromUrl(url);
  const dest = path.join(OUTPUT_DIR, `${slugify(pageTitle)}.${ext}`);
  if (fs.existsSync(dest)) {
    return { downloaded: 0, skipped: 1 };
  }

  const buffer = await downloadImageBuffer(url, pageTitle);
  if (!buffer) return { downloaded: 0, skipped: 0 };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(dest, buffer);
  return { downloaded: 1, skipped: 0 };
}

// Tous les livres déjà scrapés par scrape-books.ts (une entrée par fichier
// en/*.json, champ `name` = pageTitle, cf. NOTE en tête de fichier).
function readPageTitlesFromData(): string[] {
  if (!fs.existsSync(BOOKS_DATA_DIR)) {
    console.error(`❌ Dossier introuvable: ${BOOKS_DATA_DIR}. Lancer scrape-books.ts --fetch-category d'abord.`);
    process.exit(1);
  }
  const files = fs.readdirSync(BOOKS_DATA_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => {
    const data = JSON.parse(fs.readFileSync(path.join(BOOKS_DATA_DIR, file), 'utf-8'));
    return data.name as string;
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--fetch-all'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Tous les livres déjà scrapés : npx ts-node -r tsconfig-paths/register scripts/scrape-book-images.ts --fetch-all');
    console.error('  Fetch une liste de pages      : npx ts-node -r tsconfig-paths/register scripts/scrape-book-images.ts --fetch "A Nameless Adventurer\'s Notes" "Diary of Roald the Adventurer"');
    process.exit(1);
  }

  const pageTitles = args[0] === '--fetch-all' ? readPageTitlesFromData() : args.slice(1);
  if (pageTitles.length === 0) {
    console.error('❌ Aucune page à scraper (liste vide).');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalDownloaded = 0;
  let totalSkipped = 0;
  for (let i = 0; i < pageTitles.length; i++) {
    console.log(`Scraping image "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    try {
      const { downloaded, skipped } = await scrapeBookImage(pageTitles[i]);
      totalDownloaded += downloaded;
      totalSkipped += skipped;
    } catch (err) {
      console.warn(`⚠️  Échec du scraping de l'image de "${pageTitles[i]}": ${err}`);
    }
    await sleep(300);
  }

  console.log(`✅ ${totalDownloaded} image(s) téléchargée(s), ${totalSkipped} déjà présente(s), vers ${OUTPUT_DIR}`);
}

main();
