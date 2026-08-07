// scripts/scrape-food-images.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FOOD_DATA_DIR = path.resolve(__dirname, '../prisma/data/food/en');
const OUTPUT_DIR = path.resolve(__dirname, '../assets/foods');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// {{Food Infobox}} n'a AUCUN champ image dans le wikitext (vérifié sur Almond
// Tofu, Apple, ...) : l'image de chaque palier est dérivée par le template lui-
// même depuis PAGENAME ("Item {name}.png" / "Item Delicious {name}.png" /
// "Item Suspicious {name}.png"). Plutôt que de reconstruire ce nom de fichier
// (risque de divergence sur les noms avec apostrophes/guillemets, ex: "Pile 'Em
// Up"), on extrait directement l'URL déjà résolue depuis le HTML rendu
// (action=parse) : chaque palier existant produit un onglet contenant
// `<figure class="pi-item pi-image" data-source="image|image_delicious|
// image_suspicious"><img src="...">`. Un plat sans palier de qualité (potion,
// ingrédient brut, ex: Apple) n'a qu'un seul `data-source="image"`, sans
// onglets ni les deux autres data-source.
//
// Un même wagon d'images (icônes d'étoiles, navbox, galerie vidéo, ...) est
// transclus sur toute page de la catégorie : on ne peut donc PAS utiliser
// `list=allimages` ou `generator=images` (retourne des centaines d'images sans
// rapport). Le scope `figure.pi-image[data-source=...]` de l'infobox suffit à
// isoler précisément les 3 images qui nous intéressent.
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

// Ex: ".../images/5/5c/Item_Delicious_Almond_Tofu.png/revision/latest?cb=..."
// -> "png". Le "?cb=..." de fin (cache-buster) rend une simple lecture de
// path.extname() sur l'URL brute inutilisable.
function extensionFromUrl(url: string): string {
  const match = url.match(/\.([a-zA-Z0-9]+)\/revision\//);
  return match ? match[1].toLowerCase() : 'png';
}

interface FoodTierImages {
  normal: string | null;
  delicious: string | null;
  suspicious: string | null;
}

function parseFoodImages(html: string): FoodTierImages {
  const $ = cheerio.load(html);
  const get = (source: string) => $(`figure.pi-image[data-source="${source}"] img`).first().attr('src')?.trim() || null;
  return {
    normal: get('image'),
    delicious: get('image_delicious'),
    suspicious: get('image_suspicious'),
  };
}

async function scrapeFoodImages(pageTitle: string): Promise<{ downloaded: number; skipped: number }> {
  const html = await fetchHtml(pageTitle);
  if (!html) {
    console.warn(`⚠️  "${pageTitle}": page introuvable ou vide, ignorée.`);
    return { downloaded: 0, skipped: 0 };
  }

  const images = parseFoodImages(html);
  const entries: Array<[string, string | null]> = [
    ['normal', images.normal],
    ['delicious', images.delicious],
    ['suspicious', images.suspicious],
  ];

  const dir = path.join(OUTPUT_DIR, slugify(pageTitle));
  let downloaded = 0;
  let skipped = 0;

  for (const [tier, url] of entries) {
    if (!url) continue;

    const ext = extensionFromUrl(url);
    const dest = path.join(dir, `${tier}.${ext}`);
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    const buffer = await downloadImageBuffer(url, `${pageTitle} (${tier})`);
    if (!buffer) continue;

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, buffer);
    downloaded++;
  }

  if (downloaded === 0 && skipped === 0) {
    console.warn(`⚠️  "${pageTitle}": aucune image trouvée dans l'infobox.`);
  }

  return { downloaded, skipped };
}

// Toutes les pages déjà scrapées par scrape-food.ts (une entrée par fichier
// en/*.json, clé = pageTitle, cf. NOTE de scrape-food.ts sur les collisions de
// nom affiché entre plat "de base" et variantes de quête/évènement).
function readPageTitlesFromData(): string[] {
  const files = fs.readdirSync(FOOD_DATA_DIR).filter((f) => f.endsWith('.json'));
  const titles = new Set<string>();
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(FOOD_DATA_DIR, file), 'utf-8'));
    if (data.pageTitle) titles.add(data.pageTitle);
  }
  return [...titles];
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--fetch-all'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Toutes les nourritures déjà scrapées : npx ts-node -r tsconfig-paths/register scripts/scrape-food-images.ts --fetch-all');
    console.error('  Fetch une liste de pages              : npx ts-node -r tsconfig-paths/register scripts/scrape-food-images.ts --fetch "Almond Tofu" "\\"Sweet Dream\\""');
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
    console.log(`Scraping images "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    try {
      const { downloaded, skipped } = await scrapeFoodImages(pageTitles[i]);
      totalDownloaded += downloaded;
      totalSkipped += skipped;
    } catch (err) {
      console.warn(`⚠️  Échec du scraping des images de "${pageTitles[i]}": ${err}`);
    }
    await sleep(300);
  }

  console.log(`✅ ${totalDownloaded} image(s) téléchargée(s), ${totalSkipped} déjà présente(s), vers ${OUTPUT_DIR}`);
}

main();
