// scripts/sync-version-formulas.ts
//
// Les objets "Formula" (recettes d'alchimie, essentiellement les appâts de
// pêche) ne sont PAS documentés de façon stable sur les pages Version/X.Y :
// selon l'époque, ils apparaissent sous ";New Formula" (4.1, 5.0), nichés
// dans ";New Gameplay" → "Bait" (2.1), en bullet isolé hors de toute
// sous-section dédiée (4.0), ou pas du tout listés dans "New Content"
// (3.0, alors que la page de l'objet documente bien sa sortie en 3.0). Le
// scraping par page de version (scrape-version.ts, champ "newFormulas") ne
// peut donc structurellement pas être complet.
//
// Source fiable à la place : chaque objet Formula porte lui-même un
// {{Change History|X.X}} sur sa propre page — même principe que
// sync-version-achievements.ts pour les succès. On liste tous les membres
// de Category:Formula (une poignée d'objets, ~10), on résout les pages de
// redirection ("Formula: Fake Fly Bait" → "Fake Fly Bait"), on lit leur
// version de sortie, puis on écrase newFormulas dans les fichiers
// *_generated.json (en + fr) déjà produits par scrape-version.ts.
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const EN_DIR = path.resolve(__dirname, '../prisma/data/versions/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/versions/fr');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
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

interface FormulaEntry {
  name: string;
  version: string;
}

async function fetchCategoryMembers(category: string): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined;

  do {
    const response = await withRetry(`categorymembers ${category}`, () =>
      axios.get(EN_API_URL, {
        params: {
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${category}`,
          cmlimit: '100',
          format: 'json',
          formatversion: '2',
          ...(cmcontinue ? { cmcontinue } : {}),
        },
        headers: { ...HTTP_HEADERS, Accept: 'application/json' },
        httpsAgent,
      }),
    );
    titles.push(...response.data.query.categorymembers.map((m: { title: string }) => m.title));
    cmcontinue = response.data.continue?.cmcontinue;
    await sleep(300);
  } while (cmcontinue);

  return titles;
}

// Résout les pages de redirection ("Formula: X" / "Recipe: X") vers la page
// réelle de l'objet en un seul appel batché grâce au paramètre "redirects=1"
// de l'API MediaWiki, qui renvoie directement le contenu de la page cible.
async function resolveAndFetch(titles: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>(); // titre résolu → wikitext
  const chunkSize = 50;

  for (let i = 0; i < titles.length; i += chunkSize) {
    const chunk = titles.slice(i, i + chunkSize);
    const response = await withRetry(`resolve+fetch (${chunk.length} titres)`, () =>
      axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: chunk.join('|'),
          redirects: '1',
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          formatversion: '2',
        },
        headers: { ...HTTP_HEADERS, Accept: 'application/json' },
        httpsAgent,
      }),
    );
    const pages = response.data.query?.pages ?? [];
    for (const page of pages) {
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (content) result.set(page.title, content);
    }
    await sleep(300);
  }

  return result;
}

// La plupart des membres de Category:Formula sont des redirections
// "Formula: X" → page réelle de l'objet obtenu (ex: "Formula: Fake Fly
// Bait" → "Fake Fly Bait"), déjà résolues par resolveAndFetch. Mais
// certains sont directement la page du plan lui-même, dont le TITRE inclut
// littéralement le préfixe "Formula: "/"Recipe: " (ex: 'Formula: "Pure
// Water"', "Recipe: Strength Tonic") alors que l'objet obtenu au final a sa
// propre page séparée sans ce préfixe ('"Pure Water"', "Strength Tonic") —
// on retire donc systématiquement ce préfixe pour obtenir le nom affichable
// et traduisible via langlinks.
function stripFormulaPrefix(name: string): string {
  return name.replace(/^(?:Formula|Recipe):\s*/, '').trim();
}

async function fetchAllFormulas(): Promise<FormulaEntry[]> {
  const members = await fetchCategoryMembers('Formula');
  const resolved = await resolveAndFetch(members);

  const entries: FormulaEntry[] = [];
  for (const [name, content] of resolved) {
    const match = content.match(/\{\{Change History\|([^}|]+)/);
    if (!match) {
      console.warn(`⚠️  Pas de {{Change History}} trouvé pour "${name}", ignoré.`);
      continue;
    }
    entries.push({ name: stripFormulaPrefix(name), version: match[1].trim() });
  }
  return entries;
}

// ── Traduction FR via langlinks (même mécanisme que scrape-version.ts) ──────

async function fetchLangLinksFr(names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(names)].filter(Boolean);
  const chunkSize = 50;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    let continueParams: Record<string, string> | undefined;
    do {
      try {
        const response = await withRetry(`langlinks FR (${chunk.length})`, () =>
          axios.get(EN_API_URL, {
            params: {
              action: 'query',
              titles: chunk.join('|'),
              prop: 'langlinks',
              lllang: 'fr',
              lllimit: 'max',
              format: 'json',
              formatversion: '2',
              ...continueParams,
            },
            headers: { ...HTTP_HEADERS, Accept: 'application/json' },
            httpsAgent,
          }),
        );
        const pages = response.data?.query?.pages ?? [];
        for (const page of pages) {
          const frTitle = page.langlinks?.[0]?.title;
          if (frTitle) map.set(page.title, frTitle);
        }
        continueParams = response.data?.continue;
      } catch (err) {
        console.warn(`⚠️  Échec de la résolution des noms FR pour un lot: ${err}`);
        continueParams = undefined;
      }
      await sleep(300);
    } while (continueParams);
  }
  return map;
}

// ── Fichiers de version déjà générés ────────────────────────────────────────

// Indexe les fichiers *_generated.json par leur champ "number" (le vrai
// numéro de patch, ex. "2.1"), plus fiable que de reconstruire un nom de
// fichier à partir du numéro de version trouvé dans {{Change History}}.
function buildVersionFileIndex(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(dir)) return index;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('_generated.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
    if (data.number) index.set(data.number, file);
  }
  return index;
}

async function main() {
  console.log('Fetching Category:Formula members from the wiki...');
  const formulas = await fetchAllFormulas();
  console.log(`Found ${formulas.length} formula items:`);
  for (const f of formulas) console.log(`  "${f.name}" → version ${f.version}`);

  const byVersion = new Map<string, string[]>();
  for (const f of formulas) {
    if (!byVersion.has(f.version)) byVersion.set(f.version, []);
    byVersion.get(f.version)!.push(f.name);
  }

  const enIndex = buildVersionFileIndex(EN_DIR);
  const frIndex = buildVersionFileIndex(FR_DIR);

  console.log('Translating formula names to French...');
  const frMap = await fetchLangLinksFr(formulas.map((f) => f.name));

  for (const [version, names] of byVersion) {
    const enFile = enIndex.get(version);
    if (!enFile) {
      console.warn(
        `⚠️  Aucun fichier de version généré pour "${version}" (formules concernées: ${names.join(', ')}) — lancez d'abord scrape-version.ts pour cette version.`,
      );
      continue;
    }

    const enPath = path.join(EN_DIR, enFile);
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
    enData.newFormulas = names;
    fs.writeFileSync(enPath, JSON.stringify(enData, null, 2), 'utf-8');
    console.log(`✅ ${enFile}: newFormulas = [${names.join(', ')}]`);

    const frFile = frIndex.get(version);
    if (!frFile) continue;
    const frPath = path.join(FR_DIR, frFile);
    const frData = JSON.parse(fs.readFileSync(frPath, 'utf-8'));
    frData.newFormulas = names.map((n) => {
      const translated = frMap.get(n);
      if (!translated) {
        console.warn(`⚠️  Pas de traduction FR trouvée pour "${n}", conservé en anglais.`);
      }
      return translated ?? n;
    });
    fs.writeFileSync(frPath, JSON.stringify(frData, null, 2), 'utf-8');
    console.log(`✅ ${frFile}: newFormulas (fr) = [${frData.newFormulas.join(', ')}]`);
  }
}

main();
