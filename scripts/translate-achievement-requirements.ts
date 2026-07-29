// Comble le champ `requirements` des succès FR quand l'EN documente une
// condition d'obtention ("Complete X." / "Earned during X.") mais que le
// wiki FR laisse le champ `prérequis` vide (cf. audit : 758/1725 succès
// concernés, vérifié manuellement sur plusieurs pages FR — ce n'est pas un
// bug de scrape-achievements.ts, le champ est bien vide à la source).
//
// Plutôt que de traduire "à l'aveugle" (risque de mal traduire un nom de
// quête), on résout le nom FR officiel de la quête/événement via le même
// mécanisme que scrape-domains.ts pour les sous-lieux : le template
// {{Other Languages}} de la page EN correspondante, qui documente le nom
// officiel dans chaque langue indépendamment des liens interwiki (souvent
// absents/peu fiables pour les pages de quêtes, cf. audit). Deux formats
// coexistent sur ce wiki : certaines pages embarquent {{Other Languages|fr=...}}
// en clair dans le wikitext, d'autres n'affichent la traduction que dans la
// page RENDUE (module Lua central) — d'où le repli wikitext -> HTML rendu.
//
// Ne couvre que les formulations régulières ("Complete X." / "Earned during
// X.") repérées par regex, soit 539 des 758 cas (422 + 117) ; les 219 autres
// (phrases libres) ne sont pas traitées ici. Les entrées comblées sont
// marquées `requirementsSource: "translated"` pour rester distinguables
// d'une vraie traduction wiki FR et remplaçables si le wiki se complète.

import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import * as cheerio from 'cheerio';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const EN_DIR = path.resolve(__dirname, '../prisma/data/achievements/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/achievements/fr');
const CACHE_PATH = path.resolve(__dirname, './cache/achievement-requirements-fr-name-cache.json');

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DRY_RUN = process.argv.includes('--dry-run');

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

function loadCache(): Record<string, string | null> {
  if (!fs.existsSync(CACHE_PATH)) return {};
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

function saveCache(cache: Record<string, string | null>) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// Repris de scrape-domains.ts : extrait |fr=... du bloc {{Other Languages}}.
function parseFrFromWikitext(wikitext: string): string | null {
  const idx = wikitext.indexOf('{{Other Languages');
  if (idx === -1) return null;
  const block = wikitext.slice(idx, idx + 2000);
  const m = /\|fr\s*=\s*([^\n|]*)/.exec(block);
  const value = m ? m[1].trim() : '';
  return value || null;
}

// Repli quand la traduction n'est pas en clair dans le wikitext (module Lua
// central) : on la lit dans la page rendue, section "Other Languages",
// ligne dont la première cellule est "French".
function parseFrFromHtml(html: string): string | null {
  const marker = 'id="Other_Languages"';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const tableStart = html.indexOf('<table', idx);
  if (tableStart === -1) return null;
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return null;

  const $ = cheerio.load(html.slice(tableStart, tableEnd + '</table>'.length));
  let frenchName: string | null = null;
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    if (/^French$/i.test($(cells[0]).text().trim())) {
      frenchName = $(cells[1]).text().trim();
    }
  });
  return frenchName;
}

async function fetchEnWikitext(pageTitle: string): Promise<string | null> {
  return withRetry(`fetch wikitext "${pageTitle}"`, async () => {
    const response = await axios.get(EN_API_URL, {
      params: {
        action: 'parse',
        page: pageTitle,
        prop: 'wikitext',
        format: 'json',
        formatversion: '2',
      },
      headers: HTTP_HEADERS,
      httpsAgent,
      validateStatus: () => true,
    });
    return response.data?.parse?.wikitext ?? null;
  });
}

async function fetchEnHtml(pageTitle: string): Promise<string | null> {
  return withRetry(`fetch html "${pageTitle}"`, async () => {
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
      validateStatus: () => true,
    });
    return response.data?.parse?.text ?? null;
  });
}

async function resolveFrName(
  pageTitle: string,
  cache: Record<string, string | null>,
): Promise<string | null> {
  if (Object.prototype.hasOwnProperty.call(cache, pageTitle)) return cache[pageTitle];

  const wikitext = await fetchEnWikitext(pageTitle);
  let frName = wikitext ? parseFrFromWikitext(wikitext) : null;

  if (!frName) {
    const html = await fetchEnHtml(pageTitle);
    frName = html ? parseFrFromHtml(html) : null;
  }

  cache[pageTitle] = frName;
  saveCache(cache);
  await sleep(300);
  return frName;
}

// ── Extraction du nom de quête/événement depuis le texte EN ────────────────

const COMPLETE_ALL_RE = /^Complete all (.+?)\.?$/;
const COMPLETE_RE = /^Complete (.+?)\.?$/;
const EARNED_RE = /^Earned during (.+?)\.?$/;

type Extracted = { name: string; template: 'complete' | 'complete_all' | 'earned' };

function extract(req: string): Extracted | null {
  let m = COMPLETE_ALL_RE.exec(req);
  if (m) return { name: m[1], template: 'complete_all' };
  m = COMPLETE_RE.exec(req);
  if (m) return { name: m[1], template: 'complete' };
  m = EARNED_RE.exec(req);
  if (m) return { name: m[1], template: 'earned' };
  return null;
}

// Le nom extrait ci-dessus est parfois habillé (guillemets autour du titre
// réel, qualificatif du type "the second part of X") qui empêche de trouver
// la page EN correspondante alors que la quête elle-même est bien traduite.
// On génère plusieurs candidats et on essaie chacun dans l'ordre plutôt que
// de deviner lequel s'applique — un candidat qui ne correspond à aucune
// page échoue simplement (coût : une requête HTTP de plus, mise en cache).
// NOTE : ne couvre que les qualificatifs qui désignent une seule quête ;
// volontairement aucune tentative sur les énumérations ("X and Y", "X, Y ou
// Z") où il n'y a pas de nom unique à isoler sans risquer un contresens.
const QUALIFIER_PREFIXES = [
  /^the (?:first|second|third|fourth|fifth|final) part of (.+)$/i,
  /^the follow-up (?:version|part) of (.+)$/i,
  /^the final optional objective of (.+)$/i,
  /^the (?:hidden exploration objective|heo) (.+)$/i,
  /^part \d+ of (.+)$/i,
  /^the side (?:task|quest) during (.+)$/i,
];

function candidateNames(rawName: string): string[] {
  const candidates = new Set<string>();
  candidates.add(rawName);

  // Titre entre guillemets droits, avec point final éventuel à l'intérieur
  // des guillemets (ex: `"Portended Fate."` -> `Portended Fate`) — la
  // capture lazy s'arrête au premier guillemet fermant, qui peut être
  // précédé d'un point appartenant à la ponctuation de la phrase EN plutôt
  // qu'au titre lui-même.
  const quoted = /^"(.+?)"\.?$/.exec(rawName);
  if (quoted) candidates.add(quoted[1].replace(/\.$/, ''));

  for (const re of QUALIFIER_PREFIXES) {
    const m = re.exec(rawName);
    if (m) candidates.add(m[1].replace(/\.$/, ''));
  }

  return Array.from(candidates);
}

// Le wikitext EN utilise parfois des entités HTML dans les noms de quête
// (ex: "&nbsp;:") et certains titres se terminent déjà par une ponctuation
// forte (! ? ...) — éviter d'accumuler un point final en double.
function cleanFrName(frName: string): string {
  return frName
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSentence(template: Extracted['template'], frNameRaw: string): string {
  const frName = cleanFrName(frNameRaw);
  const needsPeriod = !/[.!?…]$/.test(frName);
  const period = needsPeriod ? '.' : '';
  switch (template) {
    case 'complete':
      return `Compléter la quête ${frName}${period}`;
    case 'complete_all':
      return `Compléter toutes les quêtes ${frName}${period}`;
    case 'earned':
      return `Obtenu durant la quête ${frName}${period}`;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const cache = loadCache();
  const files = fs.readdirSync(EN_DIR);

  let filled = 0;
  let skippedNoFr = 0;
  let skippedNoMatch = 0;
  const unresolved: string[] = [];

  for (const file of files) {
    const frPath = path.join(FR_DIR, file);
    if (!fs.existsSync(frPath)) continue;

    const en = JSON.parse(fs.readFileSync(path.join(EN_DIR, file), 'utf8'));
    const fr = JSON.parse(fs.readFileSync(frPath, 'utf8'));

    if (!en.requirements?.trim() || fr.requirements?.trim()) continue;

    const extracted = extract(en.requirements.trim());
    if (!extracted) {
      skippedNoMatch++;
      continue;
    }

    let frName: string | null = null;
    for (const candidate of candidateNames(extracted.name)) {
      frName = await resolveFrName(candidate, cache);
      if (frName) break;
    }
    if (!frName) {
      unresolved.push(`${file} :: ${extracted.name}`);
      skippedNoFr++;
      continue;
    }

    fr.requirements = buildSentence(extracted.template, frName);
    fr.requirementsSource = 'translated';
    filled++;

    if (!DRY_RUN) {
      fs.writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n');
    }

    console.log(`✅ ${file}: "${fr.requirements}"`);
  }

  console.log('\n── Résumé ──────────────────────────────');
  console.log(`Complétés          : ${filled}`);
  console.log(`Nom FR introuvable : ${skippedNoFr}`);
  console.log(`Pattern non géré   : ${skippedNoMatch}`);
  if (DRY_RUN) console.log('(dry-run : aucun fichier écrit)');

  if (unresolved.length) {
    const reportPath = path.resolve(__dirname, './cache/achievement-requirements-unresolved.txt');
    fs.writeFileSync(reportPath, unresolved.join('\n') + '\n');
    console.log(`Liste des noms non résolus : ${reportPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
