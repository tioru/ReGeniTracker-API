// scripts/scrape-weapons.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/weapons/${lang}`);
const CACHE_PATH = path.resolve(__dirname, './cache/weapons-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Contrairement aux autres scrapers (bosses/domains/achievements), les pages
// d'armes EN et FR ne sont PAS de simples miroirs l'une de l'autre : chacune
// est la SEULE source fiable pour une partie des données.
//
// - EN (page rendue, action=parse) : seule source pour la table "Ascension
//   Costs" (matériaux + quantités par palier) ET pour "Shop Availability"
//   (vendeurs). Le wikitext brut EN ne contient QUE les noms de matériaux du
//   1er palier (ascendMat1/bossMat1/commonMat1), pas les quantités (calculées
//   par un module Lua, invisible en wikitext).
//
// - EN (page rendue, sidebar) : ne donne le Base ATK / stat secondaire que
//   sous forme d'un intervalle min-max ("23 - 185"), PAS palier par palier :
//   la table détaillée est un widget JS, absent du HTML statique renvoyé par
//   l'API. C'est très probablement pourquoi le fichier hunters_bow.json fait
//   à la main contenait un baseAtk pour CHAQUE niveau 1-70 (fabriqué/
//   interpolé) plutôt que les seuls paliers réels.
//
// - FR (wikitext brut) : à l'inverse, contient une table "==Statistiques=="
//   manuellement maintenue avec le Base ATK (et la stat secondaire) à chaque
//   palier d'ascension SEULEMENT (1, 20, 20 post-asc, 40, 40 post-asc, ...).
//   C'est la seule source utilisable pour "levels" : on la récupère donc une
//   fois par arme et on réutilise les mêmes valeurs numériques (indépendantes
//   de la langue) pour les fichiers en/ ET fr/.
//
// - Repli (rare) : pour une arme très récente, il arrive que le widget EN
//   "Ascension Costs" ne soit pas encore renseigné (ex: "A Teaspoon of
//   Transcendence" à sa sortie) alors que le wikitext FR utilise déjà
//   {{Élévation arme|arme=...|élite=...|commun=...}} avec les bons noms. Dans
//   ce cas on lit la table FR rendue (noms + quantités par palier) et on
//   traduit chaque nom FR vers l'EN via les langlinks de la page du matériau
//   (nécessaire car WeaponAscensionMaterialItem.material est résolu par nom
//   EN unique en base, cf. weaponHelperImpl.ts).
//
// - Les vendeurs (sellers) ne sont documentés QUE sur le wiki EN (aucune
//   section équivalente trouvée sur le wiki FR, même pour Hunter's Bow qui a
//   pourtant un vendeur). On réutilise donc tel quel le nom du PNJ et la
//   devise ("Mora") pour le fichier FR, comme le fait déjà fr/hunters_bow.json.
//
// - Le schéma Prisma (WeaponData: name/type/rarity/releaseDate/description/
//   history/sellers/ascensionMaterials/levels) n'a PAS de champ pour la stat
//   secondaire, les "effects" ou le raffinement d'arme (weaponRefinementLevel)
//   présents dans les fichiers de référence hunters_bow.json /
//   a_teaspoon_of_transcendence.json : ce scraper ne les gère donc pas.
// ─────────────────────────────────────────────────────────────────────────────

type WeaponType = 'SWORD' | 'CLAYMORE' | 'POLEARM' | 'BOW' | 'CATALYST';
type RestockType = 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'THREE_DAYS';

const ASCENSION_LEVELS = [20, 40, 50, 60, 70, 80];

interface WeaponSellerData {
  name: string;
  currency: string;
  cost: number;
  stock: number;
  restock: RestockType;
}

interface WeaponAscensionMaterialItemData {
  name: string;
  quantity: number;
}

interface WeaponAscensionMaterialData {
  level: number;
  materials: WeaponAscensionMaterialItemData[];
}

interface WeaponLevelData {
  baseAtk: number;
}

interface WeaponData {
  name: string;
  type: WeaponType;
  rarity: number;
  releaseDate: string;
  description: string;
  history: string;
  sellers: WeaponSellerData[];
  ascensionMaterials: WeaponAscensionMaterialData[];
  levels: Record<string, WeaponLevelData>;
}

interface CachedWeapon {
  pageTitle: string;
  releaseVersion: string;
  en: WeaponData;
  fr: WeaponData | null;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(apiUrl: string, pageTitle: string): Promise<string> {
  try {
    const response = await axios.get(apiUrl, {
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
  } catch (err) {
    console.warn(`⚠️  Échec du fetch HTML pour "${pageTitle}": ${err}`);
    return '';
  }
}

async function fetchWikitext(
  apiUrl: string,
  pageTitle: string,
): Promise<string | null> {
  try {
    const response = await axios.get(apiUrl, {
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
  } catch (err) {
    console.warn(`⚠️  Échec du fetch wikitext pour "${pageTitle}": ${err}`);
    return null;
  }
}

// ── Wikitext helpers (repris des autres scripts scrape-*) ───────────────────

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

// Extrait le texte d'une section "==Titre==" jusqu'au prochain "==" de même
// niveau (ou fin de contenu). Simple recherche de marqueurs, suffisant ici
// car les pages d'armes n'ont pas de sous-section "===...===" imbriquée dans
// "Description"/"Histoire". Les commentaires HTML sont retirés avant la
// recherche du prochain titre : certaines pages (ex: armes très récentes)
// contiennent des titres de section commentés ("<!--\n==Lore==\n-->") en
// attendant d'être renseignés, qui feraient sinon couper la section en
// plein milieu d'un commentaire non refermé.
function extractSection(content: string, heading: string): string | null {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  const marker = `==${heading}==`;
  const start = withoutComments.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const rest = withoutComments.slice(from);
  const nextMatch = rest.match(/\n==[^=]/);
  const end = nextMatch
    ? from + (nextMatch.index ?? rest.length)
    : withoutComments.length;
  return withoutComments.slice(from, end).trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── HTML helpers (repris/adaptés de scrape-enemies.ts) ────────────────────────

function extractSectionHtml(html: string, id: string): string | null {
  const marker = `id="${id}"`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const lastH2Before = html.lastIndexOf('<h2', idx);
  const lastH3Before = html.lastIndexOf('<h3', idx);
  const isH2 = lastH2Before > lastH3Before;

  const searchFrom = idx + marker.length;
  const nextH2 = html.indexOf('<h2', searchFrom);
  const nextH3 = html.indexOf('<h3', searchFrom);
  const candidates = isH2 ? [nextH2] : [nextH2, nextH3];
  const validCandidates = candidates.filter((n) => n !== -1);
  const end = validCandidates.length ? Math.min(...validCandidates) : html.length;
  return html.slice(idx, end);
}

function parseNumber(raw: string): number {
  const n = parseInt(raw.replace(/[,\s ]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

// ── EN: infobox + description/history ────────────────────────────────────────

interface RawWeaponEn {
  pageTitle: string;
  title: string;
  type: WeaponType;
  rarity: number;
  releaseDate: string;
  description: string;
  history: string;
  releaseVersion: string;
  frTitle: string | null;
}

function mapWeaponType(raw: string): WeaponType | null {
  const t = raw.trim().toUpperCase();
  return (['SWORD', 'CLAYMORE', 'POLEARM', 'BOW', 'CATALYST'] as const).includes(
    t as WeaponType,
  )
    ? (t as WeaponType)
    : null;
}

function extractDescriptionTemplate(content: string): string {
  const block = extractBracedBlock(content, '{{Description');
  if (!block) return '';
  return cleanWikitext(block.replace(/^\{\{Description\|/, '').replace(/\}\}$/, ''));
}

function parseWeaponPageEn(
  pageTitle: string,
  content: string,
  frTitle: string | null,
): RawWeaponEn | null {
  const infoboxMatch = /\{\{Weapon Infobox/i.exec(content);
  if (!infoboxMatch) return null;

  const block = extractBracedBlock(content, infoboxMatch[0]);
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const type = mapWeaponType(fields['type'] ?? '');
  const rarity = parseInt(fields['quality'] ?? '', 10);
  if (!type || Number.isNaN(rarity)) return null;

  const versionMatch = /\{\{Change History\|([^}|]+)/.exec(content);

  return {
    pageTitle,
    title: cleanWikitext(fields['title'] ?? pageTitle) || pageTitle,
    type,
    rarity,
    releaseDate: (fields['releaseDate'] ?? '').trim(),
    description: extractDescriptionTemplate(content),
    history: cleanWikitext(extractSection(content, 'Description') ?? ''),
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
    frTitle,
  };
}

// ── EN: Ascension Costs (HTML rendu) ─────────────────────────────────────────

interface AscensionTier {
  level: number;
  materials: WeaponAscensionMaterialItemData[];
}

function parseEnAscensionHtml(html: string): AscensionTier[] {
  const section = extractSectionHtml(html, 'Ascensions_and_Stats');
  if (!section) return [];

  const $ = cheerio.load(section);
  const rows = $('tr.ascension').toArray();
  const tiers: AscensionTier[] = [];

  rows.forEach((row, idx) => {
    const cards = $(row).find('.card-container.mini-card').toArray();
    if (cards.length === 0) return;

    // La 1ère carte est toujours Mora (cf. structure de {{Weapon Ascensions
    // and Stats}} observée sur Hunter's Bow), les suivantes les matériaux.
    const [moraCard, ...matCards] = cards;
    const moraQty = parseNumber($(moraCard).find('.card-text').first().text());

    const materials: WeaponAscensionMaterialItemData[] = matCards
      .map((card) => ({
        name: $(card).find('a[title]').first().attr('title')?.trim() ?? '',
        quantity: parseNumber($(card).find('.card-text').first().text()),
      }))
      .filter((m) => m.name);

    materials.push({ name: 'Mora', quantity: moraQty });
    tiers.push({ level: ASCENSION_LEVELS[idx] ?? (idx + 1) * 10, materials });
  });

  return tiers;
}

// ── EN: Shop Availability (HTML rendu) ───────────────────────────────────────

function mapRestock(note: string): RestockType {
  const n = note.trim().toLowerCase();
  if (n.includes('daily')) return 'DAILY';
  if (n.includes('weekly')) return 'WEEKLY';
  if (n.includes('monthly')) return 'MONTHLY';
  if (n.includes('three') || n.includes('3 day')) return 'THREE_DAYS';
  if (n.length === 0) return 'NEVER';
  console.warn(`⚠️  Fréquence de restock inconnue: "${note}" → NEVER par défaut.`);
  return 'NEVER';
}

function parseShopAvailabilityHtml(html: string): WeaponSellerData[] {
  const section = extractSectionHtml(html, 'Shop_Availability');
  if (!section) return [];

  const $ = cheerio.load(section);
  const table = $('table.article-table').first();
  if (!table.length) return [];

  const rows = table.find('tr').toArray();
  if (rows.length < 2) return [];

  const headers = $(rows[0])
    .find('th')
    .toArray()
    .map((th) => $(th).text().trim());
  const npcIdx = headers.findIndex((h) => /npc/i.test(h));
  const costIdx = headers.findIndex((h) => /cost$/i.test(h));
  const stockIdx = headers.findIndex((h) => /stock/i.test(h));
  const notesIdx = headers.findIndex((h) => /notes?/i.test(h));
  const currency =
    costIdx !== -1 ? headers[costIdx].replace(/\s*cost$/i, '').trim() : 'Mora';

  const sellers: WeaponSellerData[] = [];
  for (const row of rows.slice(1)) {
    const cells = $(row).find('td').toArray();
    if (!cells.length) continue;

    const name = npcIdx !== -1 ? $(cells[npcIdx]).text().trim() : '';
    if (!name) continue;

    sellers.push({
      name,
      currency,
      cost: costIdx !== -1 ? parseNumber($(cells[costIdx]).text()) : 0,
      stock: stockIdx !== -1 ? parseNumber($(cells[stockIdx]).text()) : 0,
      restock: mapRestock(notesIdx !== -1 ? $(cells[notesIdx]).text() : ''),
    });
  }
  return sellers;
}

// ── FR: infobox + description/history + Statistiques (wikitext brut) ────────

interface FrWeaponFields {
  description: string;
  history: string;
}

function parseFrWeaponPage(content: string): FrWeaponFields {
  const block = extractBracedBlock(content, '{{Infobox arme');
  const fields = block ? parseInfoboxFields(block) : {};
  return {
    description: cleanWikitext(fields['description'] ?? ''),
    history: cleanWikitext(extractSection(content, 'Histoire') ?? ''),
  };
}

// Table "==Statistiques==" du wiki FR : seule source directement exploitable
// pour le Base ATK par PALIER d'ascension (le wiki EN ne donne qu'un
// intervalle min-max non détaillé). Un même niveau apparaît deux fois de
// suite au changement de palier (fin de palier N / début de palier N+1) :
// la 2e occurrence devient la clé "<niveau>_ASC", comme dans les fichiers de
// référence (ex: "20" puis "20_ASC").
function parseFrStatsLevels(content: string): Record<string, WeaponLevelData> {
  const section = extractSection(content, 'Statistiques');
  const levels: Record<string, WeaponLevelData> = {};
  if (!section) return levels;

  const rowChunks = section.split(/\n\|-/).slice(1);
  for (const chunk of rowChunks) {
    const cellLines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('!') || l.startsWith('|'));
    if (!cellLines.length) continue;

    const startedWithAscensionCell = cellLines[0].startsWith('!');
    const cells = cellLines.map((line) => {
      const m = line.match(/^[!|]\s*(?:rowspan="\d+"\s*\|\s*)?(.*)$/);
      return (m ? m[1] : line.replace(/^[!|]/, '')).trim();
    });
    const dataCells = startedWithAscensionCell ? cells.slice(1) : cells;
    if (dataCells.length < 2) continue;

    const levelRaw = dataCells[0];
    const baseAtk = parseInt(dataCells[1].replace(/[\s ]/g, ''), 10);
    if (!/^\d+$/.test(levelRaw) || Number.isNaN(baseAtk)) continue;

    const key = levels[levelRaw] ? `${levelRaw}_ASC` : levelRaw;
    levels[key] = { baseAtk };
  }
  return levels;
}

// ── FR: Élévation (HTML rendu) — utilisé pour les noms FR ET en repli EN ────

function parseFrElevationHtml(html: string): AscensionTier[] {
  const section = extractSectionHtml(html, 'Élévation');
  if (!section) return [];

  const $ = cheerio.load(section);
  const rows = $('table.article-table tr').toArray();
  const tiers: AscensionTier[] = [];
  let currentLevel: number | null = null;

  for (const row of rows) {
    const boldText = $(row).find('b').first().text();
    const levelMatch = boldText.match(/Niveau\s+(\d+)/);

    if (levelMatch) {
      currentLevel = parseInt(levelMatch[1], 10);
      continue;
    }

    if (currentLevel === null) continue;

    const materials: WeaponAscensionMaterialItemData[] = [];
    $(row)
      .find('div[style*="width:33%"]')
      .each((_, div) => {
        const name = $(div).find('a[title]').last().attr('title')?.trim();
        const qtyMatch = $(div).text().match(/x\s*(\d+)\s*$/);
        if (name && qtyMatch) {
          materials.push({ name, quantity: parseInt(qtyMatch[1], 10) });
        }
      });

    if (materials.length > 0) {
      tiers.push({ level: currentLevel, materials });
    }
    currentLevel = null;
  }

  // La quantité de Mora par palier vit dans la ligne "coût" (celle contenant
  // "Niveau X"), pas dans la ligne matériaux : on la récupère séparément et
  // on l'ajoute à chaque palier, dans le même ordre que parseEnAscensionHtml
  // (matériaux puis Mora en dernier).
  const moraByLevel = new Map<number, number>();
  for (const row of rows) {
    const boldText = $(row).find('b').first().text();
    const levelMatch = boldText.match(/Niveau\s+(\d+)/);
    if (!levelMatch) continue;
    const moraMatch = $(row).text().match(/([\d\s ]+)\s*$/);
    if (moraMatch) moraByLevel.set(parseInt(levelMatch[1], 10), parseNumber(moraMatch[1]));
  }

  return tiers.map((tier) => ({
    ...tier,
    materials: [...tier.materials, { name: 'Mora', quantity: moraByLevel.get(tier.level) ?? 0 }],
  }));
}

// Traduit une liste de noms de matériaux FR vers l'EN via les langlinks de
// leur page respective sur le wiki FR. Nécessaire car
// WeaponAscensionMaterialItem.material est résolu par nom EN unique en base
// (cf. weaponHelperImpl.ts), donc en repli FR on ne peut pas se contenter des
// noms FR trouvés dans la table "Élévation".
async function resolveFrMaterialNamesToEnglish(
  frNames: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(frNames)].filter((n) => n !== 'Mora');
  const result = new Map<string, string>([['Mora', 'Mora']]);
  const chunkSize = 50;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const response = await axios.get(FR_API_URL, {
        params: {
          action: 'query',
          titles: chunk.join('|'),
          prop: 'langlinks',
          lllang: 'en',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const pages = response.data?.query?.pages ?? [];
      for (const page of pages) {
        const enTitle = page.langlinks?.[0]?.title;
        if (enTitle) result.set(page.title, enTitle);
        else console.warn(`⚠️  Pas de traduction EN trouvée pour le matériau "${page.title}".`);
      }
    } catch (err) {
      console.warn(`⚠️  Échec de la résolution des noms de matériaux FR→EN: ${err}`);
    }
    await sleep(500);
  }
  return result;
}

// ── Pipeline: liste des armes (EN) ───────────────────────────────────────────

async function fetchRawWeaponPages(continueParams?: Record<string, string>): Promise<{
  pages: any[];
  nextContinueParams?: Record<string, string>;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Weapons',
    gcmtype: 'page',
    gcmlimit: '50',
    prop: 'revisions|langlinks',
    rvprop: 'content',
    rvslots: 'main',
    lllang: 'fr',
    format: 'json',
    formatversion: '2',
    ...continueParams,
  };

  const response = await axios.get(EN_API_URL, { params, headers: HTTP_HEADERS, httpsAgent });
  return {
    pages: response.data?.query?.pages ?? [],
    nextContinueParams: response.data?.continue,
  };
}

async function fetchAllWeaponPages(): Promise<RawWeaponEn[]> {
  const byPageTitle = new Map<string, RawWeaponEn>();
  let continueParams: Record<string, string> | undefined;
  let round = 1;

  do {
    console.log(`Fetching weapon list batch ${round}...`);
    const { pages, nextContinueParams } = await fetchRawWeaponPages(continueParams);

    for (const page of pages) {
      const frTitle: string | null = page.langlinks?.[0]?.title ?? null;
      const existing = byPageTitle.get(page.title);
      if (existing) {
        // MediaWiki peut renvoyer la même page plusieurs fois tant que tous
        // les langlinks d'un lot ne sont pas résolus (cf. note dans
        // scrape-achievements.ts) : le contenu est déjà capturé, seul le
        // frTitle peut arriver dans un round ultérieur.
        if (frTitle) existing.frTitle = frTitle;
        continue;
      }
      const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
      const parsed = parseWeaponPageEn(page.title, content, frTitle);
      if (parsed) byPageTitle.set(page.title, parsed);
    }

    continueParams = nextContinueParams;
    round++;
    await sleep(500);
  } while (continueParams);

  return Array.from(byPageTitle.values());
}

// ── Pipeline: enrichissement par arme (EN + FR) ──────────────────────────────

async function enrichWeapon(raw: RawWeaponEn): Promise<CachedWeapon> {
  const enHtml = await fetchHtml(EN_API_URL, raw.pageTitle);
  const enAscension = parseEnAscensionHtml(enHtml);
  const sellers = parseShopAvailabilityHtml(enHtml);

  let frFields: FrWeaponFields | null = null;
  let levels: Record<string, WeaponLevelData> = {};
  let frAscension: AscensionTier[] = [];

  if (raw.frTitle) {
    const frContent = await fetchWikitext(FR_API_URL, raw.frTitle);
    if (frContent) {
      frFields = parseFrWeaponPage(frContent);
      levels = parseFrStatsLevels(frContent);

      await sleep(300);
      const frHtml = await fetchHtml(FR_API_URL, raw.frTitle);
      frAscension = parseFrElevationHtml(frHtml);
    }
  }

  if (Object.keys(levels).length === 0) {
    console.warn(
      `⚠️  "${raw.pageTitle}": aucun palier Base ATK trouvé (page FR absente ou table "Statistiques" introuvable) → levels vide.`,
    );
  }

  let enAscensionMaterials: WeaponAscensionMaterialData[];
  if (enAscension.length > 0) {
    enAscensionMaterials = enAscension;
  } else if (frAscension.length > 0) {
    console.warn(
      `⚠️  "${raw.pageTitle}": table "Ascension Costs" EN vide, repli sur le wiki FR + traduction des noms.`,
    );
    const allFrNames = frAscension.flatMap((t) => t.materials.map((m) => m.name));
    const nameMap = await resolveFrMaterialNamesToEnglish(allFrNames);
    enAscensionMaterials = frAscension.map((tier) => ({
      level: tier.level,
      materials: tier.materials.map((m) => ({
        name: nameMap.get(m.name) ?? m.name,
        quantity: m.quantity,
      })),
    }));
  } else {
    console.warn(`⚠️  "${raw.pageTitle}": aucun matériau d'ascension trouvé (EN et FR).`);
    enAscensionMaterials = [];
  }

  const enData: WeaponData = {
    name: raw.title,
    type: raw.type,
    rarity: raw.rarity,
    releaseDate: raw.releaseDate,
    description: raw.description,
    history: raw.history,
    sellers,
    ascensionMaterials: enAscensionMaterials,
    levels,
  };

  let frData: WeaponData | null = null;
  if (frFields && raw.frTitle) {
    frData = {
      name: raw.frTitle,
      type: raw.type,
      rarity: raw.rarity,
      releaseDate: raw.releaseDate,
      description: frFields.description,
      history: frFields.history,
      // Aucune section "Shop Availability" équivalente sur le wiki FR : on
      // réutilise les vendeurs EN tels quels (noms de PNJ et "Mora" ne se
      // traduisent pas), comme le fait déjà fr/hunters_bow.json.
      sellers,
      ascensionMaterials:
        frAscension.length > 0
          ? frAscension
          : enAscensionMaterials, // repli si la table FR "Élévation" est absente
      levels,
    };
  }

  return { pageTitle: raw.pageTitle, releaseVersion: raw.releaseVersion, en: enData, fr: frData };
}

async function fetchAll(): Promise<CachedWeapon[]> {
  const rawWeapons = await fetchAllWeaponPages();
  const enriched: CachedWeapon[] = [];

  for (let i = 0; i < rawWeapons.length; i++) {
    const raw = rawWeapons[i];
    console.log(`Enriching "${raw.pageTitle}" (${i + 1}/${rawWeapons.length})...`);
    enriched.push(await enrichWeapon(raw));
    await sleep(500);
  }

  return enriched;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): CachedWeapon[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: CachedWeapon[]) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${data.length} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeWeaponFiles(weapons: CachedWeapon[], versionFilter?: string[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  const filtered = versionFilter?.length
    ? weapons.filter((w) => versionFilter.includes(w.releaseVersion))
    : weapons;

  let written = 0;
  let skippedFr = 0;
  for (const weapon of filtered) {
    const filename = `${slugify(weapon.en.name)}.json`;

    fs.writeFileSync(
      path.join(enDir, filename),
      JSON.stringify(weapon.en, null, 2),
      'utf-8',
    );

    if (weapon.fr) {
      fs.writeFileSync(
        path.join(frDir, filename),
        JSON.stringify(weapon.fr, null, 2),
        'utf-8',
      );
    } else {
      skippedFr++;
    }

    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} arme(s) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  console.log(`✅ Wrote ${written} weapon files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Fetch + générer tout    : npx ts-node ... scrape-weapons.ts --fetch');
    console.error('  Cache + générer tout     : npx ts-node ... scrape-weapons.ts --cache');
    console.error('  Filtrer par version(s)   : ... --cache 5.8 5.9');
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versionFilter = args.slice(1);

  let weapons: CachedWeapon[];

  if (useCache) {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    weapons = cached;
    console.log(`Loaded ${weapons.length} weapons from cache.`);
  } else {
    console.log('Fetching all weapons from wiki (this will take a while)...');
    weapons = await fetchAll();
    saveCache(weapons);
  }

  writeWeaponFiles(weapons, versionFilter.length ? versionFilter : undefined);
}

main();
