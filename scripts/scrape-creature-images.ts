// scripts/scrape-creature-images.ts
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EN_API_URL, HTTP_HEADERS, httpsAgent, sleep, withRetry, fetchWikitext } from './lib/wiki-fetch';

const CREATURES_DATA_DIR = path.resolve(__dirname, '../prisma/data/creatures/en');
const OUTPUT_DIR = path.resolve(__dirname, '../assets/creatures');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Même pattern que scrape-material-images.ts : prisma/data/creatures/en/*.json
// ne stocke plus le nom de fichier wiki brut dans son champ `image` (juste un
// slug indépendant de la langue, cf. NOTE de writeCreatureFiles dans
// scrape-creatures.ts), donc on re-dérive ce nom de fichier depuis le
// wikitext de la page ({{Wildlife Infobox|image=...}} ou, pour les poissons/
// "Maintenance Mek", {{Item Infobox|image=...}} — cf. NOTE en tête de
// scrape-creatures.ts pour le détail de ces deux templates), puis on résout
// ce nom de fichier en URL réelle via `action=query&prop=imageinfo` (le nom
// de fichier seul ne pointe vers rien : le CDN Fandom exige le chemin de
// hash + cache-buster renvoyé par cette requête).
//
// pageTitle vient du champ `pageTitle` de prisma/data/creatures/en/*.json
// (ajouté par writeCreatureFiles dans scrape-creatures.ts) : le champ `name`
// de ces fichiers peut diverger du pageTitle réel (ex: suffixe parenthétique
// de désambiguïsation retiré, cf. parseEnCreatureName), donc pas fiable pour
// re-requêter le wiki.
// ─────────────────────────────────────────────────────────────────────────────

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

// Ex: ".../images/8/8a/Alpaca_Icon.png/revision/latest?cb=..." -> "png".
// Le "?cb=..." de fin (cache-buster) rend une simple lecture de
// path.extname() sur l'URL brute inutilisable.
function extensionFromUrl(url: string): string {
  const match = url.match(/\.([a-zA-Z0-9]+)\/revision\//);
  return match ? match[1].toLowerCase() : 'png';
}

// ── Wikitext helpers (repris tels quels de scrape-creatures.ts) ────────────

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

// Le champ "image" est presque toujours un simple nom de fichier
// ("Fichier.png" ou "Fichier.png|légende"), mais certaines pages de
// présentation de groupe (ex: "Butterfly") y placent directement une balise
// <gallery> multi-lignes listant toutes les variantes : on prend alors la
// première entrée listée (cf. NOTE de scrape-creatures.ts).
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

function parseImageFileName(content: string): string | null {
  const wildlifeBlock = extractBracedBlock(content, '{{Wildlife Infobox');
  const block = wildlifeBlock ?? extractBracedBlock(content, '{{Item Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  return fields['image'] ? extractImageFilename(fields['image']) : null;
}

async function scrapeCreatureImage(pageTitle: string): Promise<{ downloaded: number; skipped: number }> {
  const content = await fetchWikitext(pageTitle);
  if (!content) {
    console.warn(`⚠️  "${pageTitle}": page introuvable ou vide, ignorée.`);
    return { downloaded: 0, skipped: 0 };
  }

  const fileName = parseImageFileName(content);
  if (!fileName) {
    console.warn(`⚠️  "${pageTitle}": aucun champ "image" trouvé dans l'infobox.`);
    return { downloaded: 0, skipped: 0 };
  }

  const url = await fetchImageUrl(fileName);
  if (!url) {
    console.warn(`⚠️  "${pageTitle}": fichier "${fileName}" introuvable via imageinfo.`);
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

// Toutes les créatures déjà scrapées par scrape-creatures.ts, via le champ
// `pageTitle` de chaque fichier de sortie (cf. NOTE en tête de fichier).
function readPageTitlesFromOutput(): string[] {
  if (!fs.existsSync(CREATURES_DATA_DIR)) {
    console.error(`❌ Dossier introuvable: ${CREATURES_DATA_DIR}. Lancer scrape-creatures.ts --fetch-category d'abord.`);
    process.exit(1);
  }
  const pageTitles: string[] = [];
  for (const filename of fs.readdirSync(CREATURES_DATA_DIR)) {
    if (!filename.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(CREATURES_DATA_DIR, filename), 'utf-8')) as { pageTitle: string };
    pageTitles.push(data.pageTitle);
  }
  return pageTitles;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--fetch-all'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Toutes les créatures déjà scrapées : npx ts-node -r tsconfig-paths/register scripts/scrape-creature-images.ts --fetch-all');
    console.error('  Fetch une liste de pages             : npx ts-node -r tsconfig-paths/register scripts/scrape-creature-images.ts --fetch "Alpaca" "Crimson Fox"');
    process.exit(1);
  }

  const pageTitles = args[0] === '--fetch-all' ? readPageTitlesFromOutput() : args.slice(1);
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
      const { downloaded, skipped } = await scrapeCreatureImage(pageTitles[i]);
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
