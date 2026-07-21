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
// - secondaryAttribute / effects / weaponRefinementLevel : absents du schéma
//   Prisma actuel (WeaponData n'a que name/type/rarity/releaseDate/
//   description/history/sellers/ascensionMaterials/levels, cf.
//   src/model/data/weapon/weapon.ts et weaponHelperImpl.ts) — ils sont donc
//   ignorés par le seeder pour l'instant, mais générés dans le JSON à la
//   demande. Calculés depuis le wikitext brut de l'infobox (EN:
//   {{Weapon Infobox}} avec eff_rankN_varM / eff_attN ; FR: {{Infobox arme}}
//   avec effet_varM sous forme de liste "a;b;c;d;e"), qui contient déjà les
//   valeurs de substitution "(var1)/(var2)/..." par rang de raffinement —
//   pas besoin de HTML rendu pour le texte. Seul le coût de montée en rang
//   ("1 → 2 Cost", ...) nécessite le HTML rendu EN (portable infobox, sans
//   id="..." exploitable), réutilisé tel quel pour la sortie FR (quantités
//   de Mora, indépendantes de la langue). La stat secondaire par palier
//   provient de la même table "==Statistiques==" FR que "levels".
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

interface WeaponSecondaryAttributeData {
  type: string;
  levels: Record<string, Record<string, string>>;
}

interface WeaponRefinementRankData {
  title: string;
  descriptions: string[];
  upgradeCost: WeaponAscensionMaterialItemData[];
}

// Champs additionnels absents du schéma Prisma actuel (WeaponData n'a que
// name/type/rarity/releaseDate/description/history/sellers/
// ascensionMaterials/levels, cf. src/model/data/weapon/weapon.ts et
// weaponHelperImpl.ts) : ignorés par le seeder pour l'instant, mais demandés
// tels quels dans le JSON de sortie.
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
  secondaryAttribute?: WeaponSecondaryAttributeData;
  effects?: string[];
  weaponRefinementLevel?: Record<string, WeaponRefinementRankData>;
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
  fields: Record<string, string>;
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
    fields,
  };
}

// ── EN/FR: effects + secondaryAttribute + weaponRefinementLevel ─────────────
//
// Absents du schéma Prisma (cf. commentaire sur WeaponData plus haut), ces 3
// champs sont calculés à partir du wikitext brut de l'infobox : le template
// {{Weapon Infobox}} (EN) / {{Infobox arme}} (FR) contient directement, pour
// les armes avec un passif, un texte "(var1)/(var2)/..." et les valeurs de
// substitution PAR RANG (eff_rankN_varM en EN, effet_varM sous forme d'une
// liste "a;b;c;d;e" en FR) — pas besoin de rendu HTML pour ça.

// Mapping des libellés de stat secondaire (2nd_stat_type / stat2nom) vers une
// clé camelCase. Liste des types connus sur les armes Genshin ; tout type non
// listé retombe sur une conversion générique (avec avertissement, à
// compléter ici si besoin).
const SECONDARY_STAT_KEYS: Record<string, string> = {
  // Le wiki écrit ces 3 stats sans le suffixe "%" (constaté sur ~86 armes),
  // alors qu'il s'agit bien de bonus en pourcentage en jeu.
  ATK: 'atkPercent',
  HP: 'hpPercent',
  DEF: 'defPercent',
  'ATK%': 'atkPercent',
  'HP%': 'hpPercent',
  'DEF%': 'defPercent',
  'CRIT Rate': 'crtRate',
  'CRIT DMG': 'crtDmg',
  'Energy Recharge': 'energyRecharge',
  'Elemental Mastery': 'elementalMastery',
  'Physical DMG Bonus': 'physDmgBonus',
  'Healing Bonus': 'healingBonus',
  'Pyro DMG Bonus': 'pyroDmgBonus',
  'Hydro DMG Bonus': 'hydroDmgBonus',
  'Electro DMG Bonus': 'electroDmgBonus',
  'Cryo DMG Bonus': 'cryoDmgBonus',
  'Anemo DMG Bonus': 'anemoDmgBonus',
  'Geo DMG Bonus': 'geoDmgBonus',
  'Dendro DMG Bonus': 'dendroDmgBonus',
};

function secondaryStatKey(type: string): string {
  const known = SECONDARY_STAT_KEYS[type];
  if (known) return known;

  const generic = type
    .replace(/%/g, 'Percent')
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0
        ? w[0].toLowerCase() + w.slice(1).toLowerCase()
        : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
  console.warn(
    `⚠️  Type de stat secondaire inconnu "${type}" → clé générique "${generic}" (à ajouter dans SECONDARY_STAT_KEYS si besoin).`,
  );
  return generic;
}

// eff_att1, eff_att2, ... (EN uniquement — catégories d'effet, réutilisées
// telles quelles pour la sortie FR, comme "type"/"rarity").
function parseEffects(fields: Record<string, string>): string[] {
  const effects: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`eff_att${i}`];
    if (!value) break;
    effects.push(cleanWikitext(value));
  }
  return effects;
}

// Découpe le texte d'effet en lignes de description : soit une liste
// "<ul><li>...</li><li>...</li></ul>" (armes à plusieurs effets, ex: A
// Teaspoon of Transcendence), soit un texte à une seule ligne (cas courant,
// ex: Aquila Favonia).
function splitEffectLines(effectRaw: string): string[] {
  const liMatches = [...effectRaw.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  return liMatches.length > 0 ? liMatches : [effectRaw];
}

function buildEnRefinementLevels(
  fields: Record<string, string>,
): Record<string, WeaponRefinementRankData> | undefined {
  const passive = cleanWikitext(fields['passive'] ?? '');
  const effectRaw = fields['effect'];
  if (!passive || !effectRaw) return undefined;

  let maxRank = 0;
  for (const key of Object.keys(fields)) {
    const m = key.match(/^eff_rank(\d+)_var\d+$/);
    if (m) maxRank = Math.max(maxRank, parseInt(m[1], 10));
  }
  if (maxRank === 0) return undefined;

  const lines = splitEffectLines(effectRaw);
  const ranks: Record<string, WeaponRefinementRankData> = {};
  for (let rank = 1; rank <= maxRank; rank++) {
    const descriptions = lines.map((line) =>
      cleanWikitext(
        line.replace(
          /\(var(\d+)\)/g,
          (_, varNum) => fields[`eff_rank${rank}_var${varNum}`] ?? `(var${varNum})`,
        ),
      ),
    );
    ranks[String(rank)] = { title: passive, descriptions, upgradeCost: [] };
  }
  return ranks;
}

function buildFrRefinementLevels(
  fields: Record<string, string>,
): Record<string, WeaponRefinementRankData> | undefined {
  const passive = cleanWikitext(fields['effet'] ?? '');
  const effectRaw = fields['effet_desc'];
  if (!passive || !effectRaw) return undefined;

  const varLists: Record<string, string[]> = {};
  for (const key of Object.keys(fields)) {
    const m = key.match(/^effet_var(\d+)$/);
    if (m) varLists[m[1]] = fields[key].split(';').map((v) => v.trim());
  }
  const maxRank = Math.max(0, ...Object.values(varLists).map((v) => v.length));
  if (maxRank === 0) return undefined;

  const lines = effectRaw
    .split(/<br\s*\/?>/i)
    .map((l) => l.trim())
    .filter(Boolean);

  const ranks: Record<string, WeaponRefinementRankData> = {};
  for (let rank = 1; rank <= maxRank; rank++) {
    const descriptions = lines.map((line) =>
      cleanWikitext(
        line.replace(
          /\(var(\d+)\)/g,
          (_, varNum) => varLists[varNum]?.[rank - 1] ?? `(var${varNum})`,
        ),
      ),
    );
    ranks[String(rank)] = { title: passive, descriptions, upgradeCost: [] };
  }
  return ranks;
}

// Coûts de montée en rang ("1 → 2 Cost", ...) : uniquement disponibles dans
// le HTML rendu EN (portable infobox, hors des sections wiki classiques —
// pas d'id="..." exploitable par extractSectionHtml, d'où la recherche par
// sélecteur direct sur le lien "Refinement Rank"). Réutilisés tels quels pour
// la sortie FR (ce sont des quantités de Mora, indépendantes de la langue).
function parseEnRefinementCostsHtml(html: string): Record<string, WeaponAscensionMaterialItemData[]> {
  const $ = cheerio.load(html);
  const anchor = $('a[href="/wiki/Refinement_Rank"]').first();
  if (!anchor.length) return {};

  const panel = anchor.closest('h2').next('section.wds-tabber');
  if (!panel.length) return {};

  const costsByRank: Record<string, WeaponAscensionMaterialItemData[]> = {};
  panel.children('.wds-tab__content').each((idx, tab) => {
    const rank = String(idx + 1);
    const costDiv = $(tab).find('div.pi-item.pi-data[data-source="effect"]').first();
    if (!costDiv.length) {
      costsByRank[rank] = [];
      return;
    }
    const valueText = costDiv.find('.pi-data-value').first().text();
    const matches = [...valueText.matchAll(/([A-Za-zÀ-ÿ' -]+?)\s*×\s*([\d,]+)/g)];
    costsByRank[rank] = matches.map((m) => ({
      name: m[1].trim(),
      quantity: parseInt(m[2].replace(/,/g, ''), 10),
    }));
  });
  return costsByRank;
}

function attachUpgradeCosts(
  ranks: Record<string, WeaponRefinementRankData> | undefined,
  costsByRank: Record<string, WeaponAscensionMaterialItemData[]>,
): Record<string, WeaponRefinementRankData> | undefined {
  if (!ranks) return undefined;
  for (const rank of Object.keys(ranks)) {
    ranks[rank] = { ...ranks[rank], upgradeCost: costsByRank[rank] ?? [] };
  }
  return ranks;
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
  fields: Record<string, string>;
}

function parseFrWeaponPage(content: string): FrWeaponFields {
  const block = extractBracedBlock(content, '{{Infobox arme');
  const fields = block ? parseInfoboxFields(block) : {};
  return {
    description: cleanWikitext(fields['description'] ?? ''),
    history: cleanWikitext(extractSection(content, 'Histoire') ?? ''),
    fields,
  };
}

// Table "==Statistiques==" du wiki FR : seule source directement exploitable
// pour le Base ATK par PALIER d'ascension (le wiki EN ne donne qu'un
// intervalle min-max non détaillé). Un même niveau apparaît deux fois de
// suite au changement de palier (fin de palier N / début de palier N+1) :
// la 2e occurrence devient la clé "<niveau>_ASC", comme dans les fichiers de
// référence (ex: "20" puis "20_ASC").
interface FrStatsTable {
  levels: Record<string, WeaponLevelData>;
  secondaryByLevel: Record<string, string>;
}

function parseFrStatsTable(content: string): FrStatsTable {
  const section = extractSection(content, 'Statistiques');
  const levels: Record<string, WeaponLevelData> = {};
  const secondaryByLevel: Record<string, string> = {};
  if (!section) return { levels, secondaryByLevel };

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
    if (dataCells[2]) {
      secondaryByLevel[key] = dataCells[2].replace(/\u00A0/g, ' ').trim();
    }
  }
  return { levels, secondaryByLevel };
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

// ── Données minées (AnimeGameData) : valeurs exactes niveau par niveau ──────
//
// Le wiki (EN comme FR) ne documente le Base ATK / la stat secondaire QU'AUX
// PALIERS d'ascension (cf. notes plus haut). Pour obtenir la vraie valeur à
// CHAQUE niveau (1-70 ou 1-90), on s'appuie sur les tables de données minées
// du client, publiées par la communauté (dépôt DimbreathBot/AnimeGameData,
// mise à jour à chaque version du jeu) :
//   - WeaponExcelConfigData   : par arme (id), valeur de base + type de
//                               courbe de croissance pour l'ATQ et la stat
//                               secondaire (weaponProp), + weaponPromoteId.
//   - WeaponCurveExcelConfigData : multiplicateur de courbe par niveau (1-100)
//                               et par type de courbe (ex: GROW_CURVE_ATTACK_101).
//   - WeaponPromoteExcelConfigData : par palier d'ascension (weaponPromoteId),
//                               le niveau max débloqué et le bonus plat
//                               ajouté (ATQ, CRIT Rate/DMG, Recharge
//                               d'Énergie, Maîtrise Élémentaire uniquement —
//                               les bonus de DGT élémentaire/physique et
//                               Bonus de Soins scalent uniquement via la
//                               courbe, sans bonus plat additionnel).
//
// Formule vérifiée contre le wiki (Hunter's Bow, Aquila Favonia) :
//   valeur(niveau) = courbe(niveau, curveType) × initValue
//                     + bonusPlat(palierActif, propType)
// où bonusPlat vaut 0 si propType n'apparaît pas dans addProps (cas des DMG
// Bonus / Bonus de Soins). Le palier "juste après ascension" au même niveau
// (ex: "20_ASC") utilise le palier suivant (déjà promu) pour le même niveau.
//
// Cette source est utilisée en PRIORITÉ pour "levels" et
// "secondaryAttribute.levels". Si l'id de l'arme est absent du wikitext EN
// (arrive même sur des armes vieilles de plusieurs mois, pas seulement les
// toutes nouvelles — c'est juste que personne n'a rempli le champ), on
// résout l'id par le NOM de l'arme via TextMap_MediumEN.json (528k entrées ;
// à ne pas confondre avec TextMap/TextMapEN.json qui, lui, ne contient QUE du
// texte de dialogues/quêtes — vérifié, aucun nom d'objet dedans). Si même
// cette résolution par nom échoue (arme trop récente pour être encore dans
// les données minées), on retombe sur les paliers du wiki FR (cf.
// parseFrStatsTable) — moins précis (paliers seulement) mais toujours correct.

const GAMEDATA_ROOT_URL = 'https://raw.githubusercontent.com/DimbreathBot/AnimeGameData/master';
const GAMEDATA_CACHE_DIR = path.resolve(__dirname, './cache/gamedata');

interface WeaponPropEntry {
  initValue: number;
  propType: string;
  type: string; // curve type, "GROW_CURVE_NONE" si non applicable
}

interface WeaponExcelEntry {
  id: number;
  itemType: string;
  nameTextMapHash: number;
  weaponPromoteId: number;
  weaponProp: WeaponPropEntry[];
}

interface WeaponPromoteAddProp {
  propType: string;
  value: number;
}

interface WeaponPromoteEntry {
  weaponPromoteId: number;
  promoteLevel: number;
  unlockMaxLevel: number;
  addProps: WeaponPromoteAddProp[];
}

interface WeaponCurveInfo {
  type: string;
  value: number;
}

interface WeaponCurveEntry {
  level: number;
  curveInfos: WeaponCurveInfo[];
}

interface GameData {
  weaponsById: Map<number, WeaponExcelEntry>;
  curveValueByLevel: Map<number, Map<string, number>>;
  promotesByPromoteId: Map<number, WeaponPromoteEntry[]>;
  // Repli quand le wikitext EN n'a pas encore de "|id = " renseigné (arrive
  // même sur des armes vieilles de plusieurs mois, pas seulement les toutes
  // nouvelles) : on résout alors l'id via le nom, en passant par
  // TextMap_MediumEN.json (528k entrées ; TextMapEN.json "normal", lui, ne
  // contient QUE du texte de dialogues/quêtes — vérifié : aucun nom d'objet
  // dedans — d'où le nom trompeur "Medium" pour le fichier le plus complet).
  weaponIdByName: Map<string, number>;
}

// relPath: chemin relatif à la racine du dépôt (ex: "ExcelBinOutput/Weapon...json",
// "TextMap/TextMap_MediumEN.json"). Le cache disque local utilise le nom de
// fichier seul (les deux dossiers n'ont pas de collision de nom).
async function downloadJsonWithCache<T>(relPath: string): Promise<T> {
  fs.mkdirSync(GAMEDATA_CACHE_DIR, { recursive: true });
  const cachePath = path.join(GAMEDATA_CACHE_DIR, path.basename(relPath));
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  console.log(`Downloading game data: ${relPath}...`);
  const response = await axios.get(`${GAMEDATA_ROOT_URL}/${relPath}`, {
    headers: HTTP_HEADERS,
    httpsAgent,
  });
  fs.writeFileSync(cachePath, JSON.stringify(response.data), 'utf-8');
  return response.data;
}

let gameDataPromise: Promise<GameData | null> | null = null;

// Chargée une seule fois par run (cache mémoire), avec cache disque entre les
// runs — supprimer scripts/cache/gamedata/ pour forcer un rafraîchissement
// après une nouvelle version du jeu.
function loadGameData(): Promise<GameData | null> {
  if (!gameDataPromise) {
    gameDataPromise = (async () => {
      try {
        const [weapons, curves, promotes, textMap] = await Promise.all([
          downloadJsonWithCache<WeaponExcelEntry[]>('ExcelBinOutput/WeaponExcelConfigData.json'),
          downloadJsonWithCache<WeaponCurveEntry[]>('ExcelBinOutput/WeaponCurveExcelConfigData.json'),
          downloadJsonWithCache<WeaponPromoteEntry[]>('ExcelBinOutput/WeaponPromoteExcelConfigData.json'),
          downloadJsonWithCache<Record<string, string>>('TextMap/TextMap_MediumEN.json'),
        ]);

        const weaponsById = new Map(weapons.map((w) => [w.id, w]));

        const weaponIdByName = new Map<string, number>();
        for (const w of weapons) {
          if (w.itemType !== 'ITEM_WEAPON') continue;
          const name = textMap[String(w.nameTextMapHash)];
          if (name) weaponIdByName.set(name, w.id);
        }

        const curveValueByLevel = new Map<number, Map<string, number>>();
        for (const entry of curves) {
          const byType = new Map<string, number>();
          for (const info of entry.curveInfos) byType.set(info.type, info.value);
          curveValueByLevel.set(entry.level, byType);
        }

        const promotesByPromoteId = new Map<number, WeaponPromoteEntry[]>();
        for (const promote of promotes) {
          const list = promotesByPromoteId.get(promote.weaponPromoteId) ?? [];
          list.push(promote);
          promotesByPromoteId.set(promote.weaponPromoteId, list);
        }
        for (const list of promotesByPromoteId.values()) {
          list.sort((a, b) => a.promoteLevel - b.promoteLevel);
        }

        return { weaponsById, curveValueByLevel, promotesByPromoteId, weaponIdByName };
      } catch (err) {
        console.warn(
          `⚠️  Échec du chargement des données minées (AnimeGameData) : ${err}. Repli sur les paliers du wiki FR pour tous les "levels".`,
        );
        return null;
      }
    })();
  }
  return gameDataPromise;
}

// FIGHT_PROP_* (stat secondaire d'arme) -> libellé wiki + clé camelCase
// (alignée sur SECONDARY_STAT_KEYS). Élément Mastery est la seule stat en
// valeur brute (pas un pourcentage) parmi les substats d'arme possibles.
const FIGHT_PROP_INFO: Record<string, { label: string; key: string; isPercent: boolean }> = {
  FIGHT_PROP_CRITICAL: { label: 'CRIT Rate', key: 'crtRate', isPercent: true },
  FIGHT_PROP_CRITICAL_HURT: { label: 'CRIT DMG', key: 'crtDmg', isPercent: true },
  FIGHT_PROP_CHARGE_EFFICIENCY: { label: 'Energy Recharge', key: 'energyRecharge', isPercent: true },
  FIGHT_PROP_ELEMENT_MASTERY: { label: 'Elemental Mastery', key: 'elementalMastery', isPercent: false },
  FIGHT_PROP_HP_PERCENT: { label: 'HP', key: 'hpPercent', isPercent: true },
  FIGHT_PROP_ATTACK_PERCENT: { label: 'ATK', key: 'atkPercent', isPercent: true },
  FIGHT_PROP_DEFENSE_PERCENT: { label: 'DEF', key: 'defPercent', isPercent: true },
  FIGHT_PROP_PHYSICAL_ADD_HURT: { label: 'Physical DMG Bonus', key: 'physDmgBonus', isPercent: true },
  FIGHT_PROP_HEAL_ADD: { label: 'Healing Bonus', key: 'healingBonus', isPercent: true },
  FIGHT_PROP_FIRE_ADD_HURT: { label: 'Pyro DMG Bonus', key: 'pyroDmgBonus', isPercent: true },
  FIGHT_PROP_WATER_ADD_HURT: { label: 'Hydro DMG Bonus', key: 'hydroDmgBonus', isPercent: true },
  FIGHT_PROP_ELEC_ADD_HURT: { label: 'Electro DMG Bonus', key: 'electroDmgBonus', isPercent: true },
  FIGHT_PROP_ICE_ADD_HURT: { label: 'Cryo DMG Bonus', key: 'cryoDmgBonus', isPercent: true },
  FIGHT_PROP_WIND_ADD_HURT: { label: 'Anemo DMG Bonus', key: 'anemoDmgBonus', isPercent: true },
  FIGHT_PROP_ROCK_ADD_HURT: { label: 'Geo DMG Bonus', key: 'geoDmgBonus', isPercent: true },
  FIGHT_PROP_GRASS_ADD_HURT: { label: 'Dendro DMG Bonus', key: 'dendroDmgBonus', isPercent: true },
};

function promoteAddValue(promote: WeaponPromoteEntry, propType: string): number {
  return promote.addProps.find((p) => p.propType === propType)?.value ?? 0;
}

function formatStatValue(value: number, isPercent: boolean, locale: 'en' | 'fr'): string {
  if (!isPercent) return String(Math.round(value));
  const percent = (Math.round(value * 1000) / 10).toFixed(1);
  return locale === 'fr' ? `${percent.replace('.', ',')} %` : `${percent}%`;
}

interface ExactLevelsResult {
  levels: Record<string, WeaponLevelData>;
  secondary: { propType: string; levelsEn: Record<string, string>; levelsFr: Record<string, string> } | null;
}

async function computeExactLevels(
  weaponId: number | null,
  weaponName: string,
): Promise<ExactLevelsResult | null> {
  const gameData = await loadGameData();
  if (!gameData) return null;

  // Repli par nom si le wikitext EN n'a pas de "|id = " renseigné, MAIS AUSSI
  // si l'id renseigné ne correspond à aucune arme connue : constaté sur des
  // pages où le champ contient en réalité le storyId (un autre champ de
  // l'infobox du jeu) au lieu du vrai id d'arme — une erreur de saisie du
  // wiki, pas un cas d'arme absente des données minées. Dans les deux cas on
  // retente par le NOM avant d'abandonner (cf. GameData.weaponIdByName).
  const byId = weaponId !== null && !Number.isNaN(weaponId) ? gameData.weaponsById.get(weaponId) : undefined;
  const resolvedId = byId ? weaponId! : gameData.weaponIdByName.get(weaponName);
  if (resolvedId === undefined) return null;

  const weapon = gameData.weaponsById.get(resolvedId);
  if (!weapon) return null;

  const promotes = gameData.promotesByPromoteId.get(weapon.weaponPromoteId);
  if (!promotes || promotes.length === 0) return null;

  const atkProp = weapon.weaponProp.find((p) => p.propType === 'FIGHT_PROP_BASE_ATTACK');
  if (!atkProp) return null;

  const secondaryProp = weapon.weaponProp.find(
    (p) => p.propType !== 'FIGHT_PROP_BASE_ATTACK' && p.propType !== 'FIGHT_PROP_NONE',
  );
  const secondaryInfo = secondaryProp ? FIGHT_PROP_INFO[secondaryProp.propType] : undefined;
  if (secondaryProp && !secondaryInfo) {
    console.warn(
      `⚠️  FIGHT_PROP inconnu "${secondaryProp.propType}" (arme id ${weaponId}) → stat secondaire ignorée pour les données minées.`,
    );
  }

  const curveValueAt = (level: number, curveType: string): number | undefined =>
    gameData.curveValueByLevel.get(level)?.get(curveType);

  const levels: Record<string, WeaponLevelData> = {};
  const secondaryLevelsEn: Record<string, string> = {};
  const secondaryLevelsFr: Record<string, string> = {};

  for (let i = 0; i < promotes.length; i++) {
    const tier = promotes[i];
    const startLevel = i === 0 ? 1 : promotes[i - 1].unlockMaxLevel;
    const endLevel = tier.unlockMaxLevel;

    for (let level = startLevel; level <= endLevel; level++) {
      const atkCurve = curveValueAt(level, atkProp.type);
      if (atkCurve === undefined) return null; // table de courbe incomplète: on abandonne, le repli FR prendra le relais

      const baseAtk = Math.round(
        atkCurve * atkProp.initValue + promoteAddValue(tier, 'FIGHT_PROP_BASE_ATTACK'),
      );
      const key = level === startLevel && i > 0 ? `${level}_ASC` : `${level}`;
      levels[key] = { baseAtk };

      if (secondaryProp && secondaryInfo) {
        const secCurve = curveValueAt(level, secondaryProp.type);
        if (secCurve !== undefined) {
          const secValue =
            secCurve * secondaryProp.initValue + promoteAddValue(tier, secondaryProp.propType);
          secondaryLevelsEn[key] = formatStatValue(secValue, secondaryInfo.isPercent, 'en');
          secondaryLevelsFr[key] = formatStatValue(secValue, secondaryInfo.isPercent, 'fr');
        }
      }
    }
  }

  return {
    levels,
    secondary: secondaryProp && secondaryInfo
      ? { propType: secondaryProp.propType, levelsEn: secondaryLevelsEn, levelsFr: secondaryLevelsFr }
      : null,
  };
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
  const costsByRank = parseEnRefinementCostsHtml(enHtml);

  let frFields: FrWeaponFields | null = null;
  let levels: Record<string, WeaponLevelData> = {};
  let secondaryByLevel: Record<string, string> = {};
  let frAscension: AscensionTier[] = [];

  if (raw.frTitle) {
    const frContent = await fetchWikitext(FR_API_URL, raw.frTitle);
    if (frContent) {
      frFields = parseFrWeaponPage(frContent);
      const stats = parseFrStatsTable(frContent);
      levels = stats.levels;
      secondaryByLevel = stats.secondaryByLevel;

      await sleep(300);
      const frHtml = await fetchHtml(FR_API_URL, raw.frTitle);
      frAscension = parseFrElevationHtml(frHtml);
    }
  }

  // Priorité aux données minées (valeurs EXACTES à chaque niveau) sur les
  // paliers du wiki FR (repli, seulement aux paliers d'ascension) — cf. note
  // au-dessus de computeExactLevels.
  const weaponIdRaw = (raw.fields['id'] ?? '').trim();
  const weaponId = weaponIdRaw ? parseInt(weaponIdRaw, 10) : null;
  const exact = await computeExactLevels(weaponId, raw.title);

  const enSecondaryType = cleanWikitext(raw.fields['2nd_stat_type'] ?? '');
  let enSecondary: WeaponSecondaryAttributeData | undefined;
  let frSecondary: WeaponSecondaryAttributeData | undefined;

  if (exact) {
    levels = exact.levels;
    if (exact.secondary && enSecondaryType && enSecondaryType.toLowerCase() !== 'none') {
      const statKey = FIGHT_PROP_INFO[exact.secondary.propType]?.key ?? secondaryStatKey(enSecondaryType);
      const toLevels = (byLevel: Record<string, string>) => {
        const out: Record<string, Record<string, string>> = {};
        for (const [level, value] of Object.entries(byLevel)) out[level] = { [statKey]: value };
        return out;
      };
      enSecondary = { type: enSecondaryType, levels: toLevels(exact.secondary.levelsEn) };
      if (frFields) {
        const frType = cleanWikitext(frFields.fields['stat2nom'] ?? '') || enSecondaryType;
        frSecondary = { type: frType, levels: toLevels(exact.secondary.levelsFr) };
      }
    }
  } else if (enSecondaryType && enSecondaryType.toLowerCase() !== 'none') {
    // Repli : paliers du wiki FR uniquement (pas de données minées exploitables).
    const statKey = secondaryStatKey(enSecondaryType);
    const enLevels: Record<string, Record<string, string>> = {};
    const frLevels: Record<string, Record<string, string>> = {};
    for (const [level, frValue] of Object.entries(secondaryByLevel)) {
      enLevels[level] = { [statKey]: frValue.replace(',', '.').replace(/\s/g, '') };
      frLevels[level] = { [statKey]: frValue };
    }
    enSecondary = { type: enSecondaryType, levels: enLevels };
    if (frFields) {
      const frType = cleanWikitext(frFields.fields['stat2nom'] ?? '') || enSecondaryType;
      frSecondary = { type: frType, levels: frLevels };
    }
  }

  if (Object.keys(levels).length === 0) {
    console.warn(
      `⚠️  "${raw.pageTitle}": aucun palier Base ATK trouvé (ni données minées, ni page FR/table "Statistiques") → levels vide.`,
    );
  }

  // effects / secondaryAttribute / weaponRefinementLevel : absents du schéma
  // Prisma (cf. commentaire sur WeaponData), calculés uniquement pour le JSON.
  const effects = parseEffects(raw.fields);
  const enRefinement = attachUpgradeCosts(buildEnRefinementLevels(raw.fields), costsByRank);
  const frRefinement = frFields
    ? attachUpgradeCosts(buildFrRefinementLevels(frFields.fields), costsByRank)
    : undefined;

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
    ...(enSecondary ? { secondaryAttribute: enSecondary } : {}),
    ...(effects.length > 0 ? { effects } : {}),
    ...(enRefinement ? { weaponRefinementLevel: enRefinement } : {}),
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
      ...(frSecondary ? { secondaryAttribute: frSecondary } : {}),
      ...(effects.length > 0 ? { effects } : {}),
      ...(frRefinement ? { weaponRefinementLevel: frRefinement } : {}),
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
