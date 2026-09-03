// scripts/scrape-materials.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EN_API_URL,
  FR_API_URL,
  HTTP_HEADERS,
  httpsAgent,
  sleep,
  withRetry,
  fetchCategoryMembers,
  fetchWikitext,
  fetchWikitextWithLanglink,
  fetchHtml,
} from './lib/wiki-fetch';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/materials/${lang}`);
const DOMAINS_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/domains/${lang}`);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// La page wiki d'un matériau ({{Item Infobox}}) liste ses sources dans des
// champs source1, source2, ... dont la NATURE varie complètement d'une ligne
// à l'autre : nom de domaine en clair ("Cecilia Garden"), lien vers un
// mécanisme ("[[Alchemy]]", "[[Parametric Transformer]]"), phrase générique
// ("Dropped by [[Whopperflowers]]", "Dropped by [[Normal Bosses]] and
// [[Weekly Bosses]]"), template de vente ("{{Sold By|...}}") ou texte libre
// de cueillette ("Found under the eaves of houses in ..."). Il n'y a pas de
// champ structuré unique à parser : chaque type de source nécessite sa propre
// détection + sa propre source de données (cf. buildSourceEntries).
//
// ── DOMAIN ────────────────────────────────────────────────────────────────
// Plutôt que d'essayer de déduire le nom de la rotation ("Submerged Valley")
// depuis la page du matériau (qui ne le mentionne jamais), on recoupe avec
// les fichiers DÉJÀ SCRAPÉS par scrape-domains.ts (prisma/data/domains/en et
// fr) : chaque domaine y liste ses matériaux par jour de rotation
// (rewards[].reward[].name). C'est la source la plus fiable disponible (et
// elle donne le nom FR de la rotation gratuitement, cf. buildDomainIndex).
//
// ── BOSS / WEEKLY_BOSS / COMMON_ENEMY ────────────────────────────────────
// Les noms + niveaux ne sont PAS dans le wikitext brut : ils viennent d'un
// widget ({{Dropped By}}), qui n'apparaît qu'une fois la page rendue
// (action=parse). La section peut s'appeler "Dropped By" (h2, matériaux de
// boss/ascension) ou "Drops" (h3 sous "How to Obtain", matériaux de drop
// d'ennemi commun) selon la page — cf. DROPPED_BY_ID_PATTERN. À l'intérieur,
// un paragraphe par catégorie ("N Weekly Bosses drop ...", "N Normal Bosses
// drop ...", "N Common Enemies drop ...") précède la liste de cartes
// correspondante : on regroupe donc les cartes par le texte de la catégorie
// qui les précède plutôt que de tout mettre dans un seul type.
//
// ── ALCHEMY ───────────────────────────────────────────────────────────────
// Contrairement aux coûts d'ascension d'armes, les recettes ({{Recipe}})
// sont bien présentes dans le wikitext brut : pas besoin de HTML rendu.
// resultQuantity n'apparaît dans aucun {{Recipe}} observé (toujours 1 en
// pratique sur les matériaux vus) : on part de cette hypothèse par défaut.
//
// ── usedIn / usedByCharacters / usedByWeapons ───────────────────────────
// Proviennent de 3 sections HTML rendues : "Craft Usage" (→ usedIn),
// "Ascension Usage" (→ usedByCharacters.ascension + usedByWeapons, dans CET
// ORDRE : la section liste toujours un paragraphe "Characters" suivi d'un
// paragraphe "Weapons", identifiables par l'attribut title="Characters" /
// title="Weapons" du lien d'intro), et "Talent Leveling Usage" (→
// usedByCharacters.talent). Dans les 3 cas, les noms sont extraits de
// l'attribut title="..." du lien de la carte, JAMAIS du texte visible de la
// légende (.card-caption) : le wiki y injecte des traits d'union invisibles
// (&#173;, "soft hyphen") pour permettre la césure à l'affichage
// ("El­e­gy for the End"), qui polluent le nom si on lit le texte au lieu de
// l'attribut. C'est la cause confirmée des soft-hyphens trouvés dans le
// fichier de référence fait à la main (boreal_wolfs_cracked_tooth.json).
//
// ── sellers ───────────────────────────────────────────────────────────────
// Section HTML rendue "Shop Availability", même structure de tableau que
// pour les armes (cf. parseShopAvailabilityHtml, repris quasi tel quel de
// scrape-weapons.ts). Absente de la page ⇒ sellers: [] — y compris quand une
// source externe (hors wiki) indique que l'objet est bien vendable : on
// reste fidèle à ce que CE wiki documente, comme le fait déjà
// scrape-domains.ts pour les Trounce Domains sans données de vagues.
//
// ── LOCAL_SPECIALTY (nouveau) ────────────────────────────────────────────
// Les matériaux de cueillette en monde ouvert (ex: Philanemo Mushroom) n'ont
// aucun équivalent dans les types de source déjà modélisés (DOMAIN /
// PARAMETRIC_TRANSFORMER / ALCHEMY / BOSS / WEEKLY_BOSS / COMMON_ENEMY) — vu
// lors de la revue du modèle de données. On ajoute donc LOCAL_SPECIALTY, qui
// stocke tel quel le texte libre de localisation ("Found under the eaves of
// houses in the City of Mondstadt, ...") faute de structure exploitable côté
// wiki.
//
// ── FR ────────────────────────────────────────────────────────────────────
// Comme pour scrape-weapons.ts et scrape-domains.ts, la page FR (via
// langlink) n'est une source fiable QUE pour le nom et la description
// traduits. Sellers / usedIn / usedByCharacters / usedByWeapons / noms de
// boss/ennemis / noms d'ingrédients de recette n'ont pas d'équivalent
// structuré côté FR : réutilisés tels quels depuis l'EN. Les noms de domaine
// et de rotation, eux, sont traduits via l'index domaines FR (cf. DOMAIN
// ci-dessus) plutôt que réutilisés en anglais.
//
// ── Retry ─────────────────────────────────────────────────────────────────
// Repris à l'identique de scrape-domains.ts (withRetry) : quelques requêtes
// individuelles échouent de façon transitoire sur un run complet, sans lien
// avec la logique de parsing. Appliqué à TOUS les appels réseau.
// ─────────────────────────────────────────────────────────────────────────────

type SourceType =
  | 'DOMAIN'
  | 'PARAMETRIC_TRANSFORMER'
  | 'ALCHEMY'
  | 'BOSS'
  | 'WEEKLY_BOSS'
  | 'COMMON_ENEMY'
  | 'ELITE_ENEMY'
  | 'LOCAL_SPECIALTY'
  | 'ADVENTURE_RANK_REWARD';

interface AdventureRankRewardEntry {
  adventureRank: number;
  quantity: number;
}

type RestockType = 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'THREE_DAYS';

interface RecipeIngredient {
  item: string;
  quantity: number;
}

interface AlchemyRecipe {
  subtype: 'CRAFTING' | 'CONVERTING';
  resultQuantity: number;
  ingredients: RecipeIngredient[];
}

interface EnemySourceEntry {
  name: string;
  level: number | undefined;
}

interface MaterialSourceOutput {
  type: SourceType;
  minimumLevel?: number;
  minimumAdventureRank?: number; // ALCHEMY uniquement, ex: "[[Alchemy]] (AR 35+)"
  domain?: string;
  rotation?: string;
  names?: string[];
  recipes?: AlchemyRecipe[];
  location?: string; // LOCAL_SPECIALTY uniquement
  rewards?: AdventureRankRewardEntry[]; // ADVENTURE_RANK_REWARD uniquement
}

interface MaterialSellerData {
  name: string;
  currency: string;
  cost: number;
  stock: number;
  restock: RestockType;
}

interface MaterialOutput {
  name: string;
  image: string;
  rarity: number;
  categories: string[];
  description: string;
  sources: MaterialSourceOutput[];
  usedIn: string[];
  usedByCharacters: { ascension: string[]; talent: string[] };
  usedByWeapons: string[];
  sellers: MaterialSellerData[];
}

interface CachedMaterial {
  pageTitle: string;
  en: MaterialOutput;
  fr: MaterialOutput | null;
}

// ── Wikitext helpers (repris à l'identique des autres scripts scrape-*) ────

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

// Variante de extractBracedBlock qui retourne TOUS les blocs "{{marker ...}}"
// d'un contenu (ex: plusieurs {{Recipe}} à la suite), pas seulement le 1er.
function extractAllBracedBlocks(content: string, startMarker: string): string[] {
  const blocks: string[] = [];
  let offset = 0;
  while (true) {
    const idx = content.indexOf(startMarker, offset);
    if (idx === -1) break;
    const block = extractBracedBlock(content.slice(idx), startMarker);
    if (!block) break;
    blocks.push(block);
    offset = idx + block.length;
  }
  return blocks;
}

function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    // Les champs d'infobox classiques n'ont jamais d'apostrophe, mais les
    // clés des {{Recipe}} sont des noms d'objets littéraux qui peuvent en
    // avoir (ex: "Boreal Wolf's Milk Tooth = 3") : la classe de caractères
    // doit donc l'inclure, sous peine de perdre l'ingrédient silencieusement.
    const m = line.match(/^\|\s*([\w' -]+?)\s*=\s*(.*)$/);
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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// "Varunada Lazurite" -> "VARUNADA_LAZURITE", "Ascension Gems" -> "ASCENSION_GEMS"
function toCategoryKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── HTML helpers (repris/adaptés de scrape-weapons.ts / scrape-enemies.ts) ──

function extractSectionHtml(html: string, id: string, idPattern?: RegExp): string | null {
  const match = idPattern ? idPattern.exec(html) : null;
  const idx = idPattern ? (match ? match.index : -1) : html.indexOf(`id="${id}"`);
  if (idx === -1) return null;

  const lastH2Before = html.lastIndexOf('<h2', idx);
  const lastH3Before = html.lastIndexOf('<h3', idx);
  const isH2 = lastH2Before > lastH3Before;

  const markerLength = idPattern ? (match?.[0].length ?? 0) : `id="${id}"`.length;
  const searchFrom = idx + markerLength;
  const nextH2 = html.indexOf('<h2', searchFrom);
  const nextH3 = html.indexOf('<h3', searchFrom);
  const candidates = isH2 ? [nextH2] : [nextH2, nextH3];
  const validCandidates = candidates.filter((n) => n !== -1);
  const end = validCandidates.length ? Math.min(...validCandidates) : html.length;
  return html.slice(idx, end);
}

function parseNumber(raw: string): number {
  const n = parseInt(raw.replace(/[,\s ]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

// La section "Dropped By" (matériaux de boss) est un h2 ; son équivalent pour
// les drops d'ennemis communs, "Drops", est un h3 niché sous "How to
// Obtain" — les deux id possibles sont essayés.
const DROPPED_BY_ID_PATTERN = /id="(Dropped_By|Drops)"/;

// Selon la page, "Craft Usage"/"Ascension Usage"/"Talent Leveling Usage"
// apparaissent soit comme des h2 autonomes avec leur nom complet (ex:
// Varunada Lazurite Sliver: id="Craft_Usage"), soit comme des h3 imbriqués
// sous un h2 "Usage" commun, avec un id raccourci (ex: Whopperflower Nectar:
// id="Craft" sous "==Usage==\n===Craft==="). On essaie les deux formes.
function extractSectionHtmlByIds(html: string, ids: string[]): string | null {
  for (const id of ids) {
    const section = extractSectionHtml(html, id);
    if (section) return section;
  }
  return null;
}

// ── Craft Usage → usedIn ─────────────────────────────────────────────────

function parseCraftUsageHtml(html: string): string[] {
  const section = extractSectionHtmlByIds(html, ['Craft_Usage', 'Craft']);
  if (!section) return [];
  const $ = cheerio.load(section);
  const names: string[] = [];
  $('table.article-table tr').each((_, row) => {
    const name = $(row).find('td').first().find('a[title]').first().attr('title')?.trim();
    if (name) names.push(name);
  });
  return names;
}

// ── Dropped By / Drops → BOSS / WEEKLY_BOSS / COMMON_ENEMY ─────────────────

function labelToSourceType(label: string): SourceType | null {
  // Le libellé est au singulier quand un seul boss/ennemi est concerné (ex:
  // "1 Weekly Boss drops X:" sur des matériaux à source unique), au pluriel
  // sinon : les deux formes doivent être acceptées.
  const l = label.trim().toLowerCase();
  if (l === 'weekly boss' || l === 'weekly bosses') return 'WEEKLY_BOSS';
  if (l === 'normal boss' || l === 'normal bosses' || l === 'boss' || l === 'bosses') return 'BOSS';
  if (l === 'common enemy' || l === 'common enemies') return 'COMMON_ENEMY';
  if (l === 'elite enemy' || l === 'elite enemies') return 'ELITE_ENEMY';
  return null;
}

function parseDroppedByHtml(html: string): Partial<Record<SourceType, EnemySourceEntry[]>> {
  const section = extractSectionHtml(html, '', DROPPED_BY_ID_PATTERN);
  if (!section) return {};

  // Chaque catégorie ("N Weekly Bosses drop X:") est introduite par un <p>
  // dont le lien d'intro porte le label recherché en attribut title. On
  // découpe la section en tranches [label, contenu jusqu'au label suivant].
  const labelMatches = [...section.matchAll(/<p>.*?title="([^"]+)">\1<\/a> drop/g)];
  const result: Partial<Record<SourceType, EnemySourceEntry[]>> = {};

  for (let i = 0; i < labelMatches.length; i++) {
    const type = labelToSourceType(labelMatches[i][1]);
    if (!type) {
      console.warn(`⚠️  Catégorie de source inconnue dans "Dropped By": "${labelMatches[i][1]}".`);
      continue;
    }
    const start = labelMatches[i].index ?? 0;
    const end = i + 1 < labelMatches.length ? labelMatches[i + 1].index : section.length;
    const chunk = section.slice(start, end);

    const $ = cheerio.load(chunk);
    const entries: EnemySourceEntry[] = [];
    $('.card-container').each((_, card) => {
      const name = $(card).find('a[title]').first().attr('title')?.trim();
      if (!name) return;
      const levelText = $(card).find('.card-text').first().text();
      const levelMatch = levelText.match(/Lv\.\s*(\d+)/);
      entries.push({ name, level: levelMatch ? parseInt(levelMatch[1], 10) : undefined });
    });
    result[type] = entries;
  }

  return result;
}

// ── Shop Availability → sellers ─────────────────────────────────────────────
// Repris de scrape-weapons.ts (parseShopAvailabilityHtml), avec mapRestock
// tolérant au tiret "—" utilisé par le wiki pour une case Notes vide.

function mapRestock(note: string): RestockType {
  const n = note.trim().toLowerCase();
  if (n.includes('daily')) return 'DAILY';
  if (n.includes('weekly')) return 'WEEKLY';
  if (n.includes('monthly')) return 'MONTHLY';
  if (n.includes('three') || n.includes('3 day')) return 'THREE_DAYS';
  if (n.length === 0 || n === '—' || n === '-') return 'NEVER';
  console.warn(`⚠️  Fréquence de restock inconnue: "${note}" → NEVER par défaut.`);
  return 'NEVER';
}

// Sur la plupart des pages, la colonne coût est numérique et l'en-tête
// donne directement la devise ("Sigil Cost" → "Sigil"). Mais certaines
// boutiques de troc (ex: Transoceanic Pearl chez Pahsiv) ont un en-tête
// générique "Material Cost" et un contenu de cellule par ligne du type
// "Tidalga ×2" (payé dans UN AUTRE MATÉRIAU, pas un nombre) : on détecte ce
// cas par ligne plutôt que de se fier à l'en-tête, pour ne jamais écrire une
// devise/un coût faux (mieux vaut ignorer la ligne que produire une donnée
// silencieusement incorrecte).
function parseCostCell(text: string, headerCurrency: string): { currency: string; cost: number } | null {
  const trimmed = text.trim();
  const itemMatch = trimmed.match(/^(.+?)\s*[×x]\s*(\d+)$/);
  if (itemMatch) {
    return { currency: cleanWikitext(itemMatch[1]), cost: parseInt(itemMatch[2], 10) };
  }
  const numeric = trimmed.replace(/[,\s ]/g, '');
  if (/^\d+$/.test(numeric)) {
    return { currency: headerCurrency, cost: parseInt(numeric, 10) };
  }
  return null;
}

function parseShopAvailabilityHtml(html: string, materialTitle: string): MaterialSellerData[] {
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
  const headerCurrency = costIdx !== -1 ? headers[costIdx].replace(/\s*cost$/i, '').trim() : 'Mora';

  const sellers: MaterialSellerData[] = [];
  for (const row of rows.slice(1)) {
    const cells = $(row).find('td').toArray();
    if (!cells.length) continue;

    const name = npcIdx !== -1 ? $(cells[npcIdx]).text().trim() : '';
    if (!name) continue;

    const cost = costIdx !== -1 ? parseCostCell($(cells[costIdx]).text(), headerCurrency) : { currency: headerCurrency, cost: 0 };
    if (!cost) {
      console.warn(
        `⚠️  "${materialTitle}": coût de vente illisible pour "${name}" ("${$(cells[costIdx]).text().trim()}") — vendeur ignoré.`,
      );
      continue;
    }

    sellers.push({
      name,
      currency: cost.currency,
      cost: cost.cost,
      stock: stockIdx !== -1 ? parseNumber($(cells[stockIdx]).text()) : 0,
      restock: mapRestock(notesIdx !== -1 ? $(cells[notesIdx]).text() : ''),
    });
  }
  return sellers;
}

// ── Ascension Usage / Talent Leveling Usage → usedByCharacters / usedByWeapons ──
// Chaque section démarre par un paragraphe d'intro par catégorie ("N
// Characters use X for ascension:" / "No Characters use X..."), dont le lien
// porte systématiquement title="Characters" ou title="Weapons". On découpe
// la section à ces marqueurs plutôt que de supposer un ordre ou un nombre de
// catégories fixe.

function splitSectionByLabels(section: string, labels: string[]): Record<string, string> {
  const positions = labels
    .map((label) => ({ label, idx: section.indexOf(`title="${label}"`) }))
    .filter((p) => p.idx !== -1)
    .sort((a, b) => a.idx - b.idx);

  const result: Record<string, string> = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : section.length;
    result[positions[i].label] = section.slice(start, end);
  }
  return result;
}

function extractCardNames(chunk: string): string[] {
  const $ = cheerio.load(chunk);
  const names: string[] = [];
  $('.card-container').each((_, card) => {
    const name = $(card).find('a[title]').first().attr('title')?.trim();
    if (name) names.push(name);
  });
  return names;
}

function parseAscensionUsageHtml(html: string): { characters: string[]; weapons: string[] } {
  const section = extractSectionHtmlByIds(html, ['Ascension_Usage', 'Ascension']);
  if (!section) return { characters: [], weapons: [] };

  const parts = splitSectionByLabels(section, ['Characters', 'Weapons']);
  return {
    characters: parts['Characters'] ? extractCardNames(parts['Characters']) : [],
    weapons: parts['Weapons'] ? extractCardNames(parts['Weapons']) : [],
  };
}

function parseTalentLevelingUsageHtml(html: string): string[] {
  const section = extractSectionHtmlByIds(html, ['Talent_Leveling_Usage', 'Talent_Leveling']);
  if (!section) return [];
  return extractCardNames(section);
}

// ── Alchemy (wikitext brut) ──────────────────────────────────────────────

function parseAlchemyRecipes(content: string): AlchemyRecipe[] {
  const blocks = extractAllBracedBlocks(content, '{{Recipe');
  const recipes: AlchemyRecipe[] = [];

  for (const block of blocks) {
    const fields = parseInfoboxFields(block);
    const rawSubtype = (fields['type'] ?? '').trim().toLowerCase();
    const subtype: AlchemyRecipe['subtype'] = rawSubtype === 'converting' ? 'CONVERTING' : 'CRAFTING';

    const ingredients: RecipeIngredient[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'type' || key === 'sort') continue;
      const quantity = parseInt(value, 10);
      if (Number.isNaN(quantity)) continue;
      ingredients.push({ item: key, quantity });
    }

    // resultQuantity n'apparaît dans aucun {{Recipe}} observé sur le wiki :
    // toujours 1 en pratique. À ajuster si un futur cas contredit ceci.
    recipes.push({ subtype, resultQuantity: 1, ingredients });
  }

  return recipes;
}

// ── Domain index (recoupement avec prisma/data/domains/{en,fr}) ────────────

interface DomainLookupEntry {
  domainEn: string;
  domainFr: string | null;
  rotationEn: string;
  rotationFr: string | null;
}

function buildDomainIndex(): Map<string, DomainLookupEntry> {
  const index = new Map<string, DomainLookupEntry>();
  const enDir = DOMAINS_DIR('en');
  const frDir = DOMAINS_DIR('fr');
  if (!fs.existsSync(enDir)) return index;

  for (const filename of fs.readdirSync(enDir)) {
    if (!filename.endsWith('.json')) continue;
    const en = JSON.parse(fs.readFileSync(path.join(enDir, filename), 'utf-8'));
    const frPath = path.join(frDir, filename);
    const fr = fs.existsSync(frPath) ? JSON.parse(fs.readFileSync(frPath, 'utf-8')) : null;

    (en.rewards ?? []).forEach((rotation: any, idx: number) => {
      const frRotation = fr?.rewards?.[idx];
      for (const item of rotation.reward ?? []) {
        index.set(item.name, {
          domainEn: en.name,
          domainFr: fr?.name ?? null,
          rotationEn: rotation.name,
          rotationFr: frRotation?.name ?? null,
        });
      }
    });
  }
  return index;
}

// ── EN: infobox + sources bruts ──────────────────────────────────────────

interface RawMaterialEn {
  pageTitle: string;
  title: string;
  rarity: number;
  categories: string[];
  description: string;
  rawSources: string[];
  localSpecialtyType: boolean;
  frTitle: string | null;
  content: string;
}

function parseMaterialInfoboxEn(
  pageTitle: string,
  content: string,
  frTitle: string | null,
): RawMaterialEn | null {
  const block = extractBracedBlock(content, '{{Item Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const rarity = parseInt(fields['quality'] ?? '', 10);
  const categories = [fields['group'], fields['group2'], fields['group3']]
    .filter((g): g is string => Boolean(g))
    .map((g) => toCategoryKey(cleanWikitext(g)));

  const rawSources: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`source${i}`];
    if (value === undefined) break;
    rawSources.push(value);
  }

  return {
    pageTitle,
    title: cleanWikitext(fields['title'] ?? pageTitle) || pageTitle,
    rarity: Number.isNaN(rarity) ? 0 : rarity,
    categories,
    description: cleanWikitext(fields['description'] ?? ''),
    rawSources,
    localSpecialtyType: /^local specialty/i.test((fields['type'] ?? '').trim()),
    frTitle,
    content,
  };
}

// ── Construction des `sources[]` ─────────────────────────────────────────

function buildSourceEntries(
  raw: RawMaterialEn,
  domainIndex: Map<string, DomainLookupEntry>,
  droppedBy: Partial<Record<SourceType, EnemySourceEntry[]>>,
  lang: 'en' | 'fr',
): MaterialSourceOutput[] {
  const entries: MaterialSourceOutput[] = [];
  const seenTypes = new Set<SourceType>();

  for (const raw1 of raw.rawSources) {
    // Les sources de vente ({{Sold By|...}}, "Purchase from ...") ne sont
    // jamais des entrées `sources[]` : elles alimentent `sellers[]` à part
    // (cf. parseShopAvailabilityHtml), qu'on tente d'extraire indépendamment
    // de la présence de ce genre de ligne.
    if (/\{\{Sold By/i.test(raw1) || /Purchase|Souvenir Shop/i.test(raw1)) continue;

    const cleaned = cleanWikitext(raw1);
    if (!cleaned) continue;

    // "[[Alchemy]]" tout court sur les matériaux simples, "[[Alchemy]] (AR
    // 35+)" sur les gemmes d'ascension (condition de rang d'aventure minimum
    // pour débloquer la recette), et "[[Crafting]]"/"[[Crafted]]" sur
    // certaines familles (ex: Crystalline Cyst Dust) — trois libellés
    // différents pour la même mécanique : dans tous les cas la recette
    // réelle vient de la même section "==Alchemy==" / {{Recipe}} en
    // wikitext. Le suffixe entre parenthèses est optionnel, capturé dans
    // minimumAdventureRank si présent.
    const alchemyMatch = cleaned.match(/^(?:Alchemy|Crafting|Crafted)(?:\s*\(AR\s*(\d+)\+?\))?$/i);
    if (alchemyMatch) {
      if (seenTypes.has('ALCHEMY')) continue;
      seenTypes.add('ALCHEMY');
      const recipes = parseAlchemyRecipes(raw.content);
      if (recipes.length === 0) {
        console.warn(`⚠️  "${raw.title}": source ALCHEMY sans {{Recipe}} trouvé.`);
      }
      entries.push({
        type: 'ALCHEMY',
        recipes,
        ...(alchemyMatch[1] ? { minimumAdventureRank: parseInt(alchemyMatch[1], 10) } : {}),
      });
      continue;
    }

    if (/^Parametric Transformer$/i.test(cleaned)) {
      if (seenTypes.has('PARAMETRIC_TRANSFORMER')) continue;
      seenTypes.add('PARAMETRIC_TRANSFORMER');
      entries.push({ type: 'PARAMETRIC_TRANSFORMER' });
      continue;
    }

    if (/^Dropped by/i.test(cleaned)) {
      // Les noms réels viennent de parseDroppedByHtml (fait une seule fois
      // pour toute la page) : on se contente ici d'émettre les types
      // réellement observés dans la section rendue. Le niveau minimum
      // (visible dans le texte source, ex: "(Lv.60+)", ou sur chaque carte
      // de la section rendue, ex: "Lv. 60+") est dérivé des niveaux
      // effectivement trouvés plutôt que supposé être toujours 1.
      for (const type of ['BOSS', 'WEEKLY_BOSS', 'COMMON_ENEMY', 'ELITE_ENEMY'] as const) {
        const dropEntries = droppedBy[type];
        if (seenTypes.has(type) || !dropEntries?.length) continue;
        seenTypes.add(type);
        const levels = dropEntries.map((e) => e.level).filter((l): l is number => l !== undefined);
        entries.push({
          type,
          minimumLevel: levels.length ? Math.min(...levels) : 1,
          names: dropEntries.map((e) => e.name),
        });
      }
      continue;
    }

    // "Adventure Rank NN Reward (×N)" : récompense automatique reçue en
    // atteignant un palier de rang d'aventure (observé sur les gemmes
    // d'ascension Dendro, ex: Brilliant Diamond). Plusieurs lignes de ce
    // type se suivent (un palier par ligne) : regroupées en UNE seule
    // entrée ADVENTURE_RANK_REWARD avec un palier par élément de `rewards`,
    // sur le même principe que les recettes multiples d'ALCHEMY.
    const arRewardMatch = cleaned.match(/^Adventure Rank (\d+) Reward(?:\s*\(×(\d+)\))?$/i);
    if (arRewardMatch) {
      const reward: AdventureRankRewardEntry = {
        adventureRank: parseInt(arRewardMatch[1], 10),
        quantity: arRewardMatch[2] ? parseInt(arRewardMatch[2], 10) : 1,
      };
      const existing = entries.find((e) => e.type === 'ADVENTURE_RANK_REWARD');
      if (existing) {
        existing.rewards!.push(reward);
      } else {
        entries.push({ type: 'ADVENTURE_RANK_REWARD', rewards: [reward] });
      }
      continue;
    }

    if (/Commission/i.test(cleaned)) {
      console.warn(
        `⚠️  "${raw.title}": source "Commission Bonus Rewards" non modélisée (pas de type dédié) — ignorée.`,
      );
      continue;
    }

    if (raw.localSpecialtyType) {
      if (seenTypes.has('LOCAL_SPECIALTY')) continue;
      seenTypes.add('LOCAL_SPECIALTY');
      entries.push({ type: 'LOCAL_SPECIALTY', location: cleaned });
      continue;
    }

    // `cleaned` vient toujours de la page EN (raw.rawSources n'est parsé que
    // depuis l'EN) : la comparaison doit donc toujours se faire contre le nom
    // EN du domaine, jamais contre le nom FR (sinon aucune correspondance
    // n'est jamais trouvée côté fr).
    const domainEntry = domainIndex.get(raw.title);
    if (domainEntry && cleaned === domainEntry.domainEn) {
      if (seenTypes.has('DOMAIN')) continue;
      seenTypes.add('DOMAIN');
      entries.push({
        type: 'DOMAIN',
        domain: lang === 'fr' ? domainEntry.domainFr ?? domainEntry.domainEn : domainEntry.domainEn,
        rotation: lang === 'fr' ? domainEntry.rotationFr ?? domainEntry.rotationEn : domainEntry.rotationEn,
        minimumLevel: 1,
      });
      continue;
    }

    console.warn(`⚠️  "${raw.title}": source non reconnue "${cleaned}" — ignorée (à ajouter dans buildSourceEntries si besoin).`);
  }

  return entries;
}

// ── Construction de la sortie finale ─────────────────────────────────────

function buildMaterialOutput(
  raw: RawMaterialEn,
  lang: 'en' | 'fr',
  frName: string | null,
  frFields: { description: string } | null,
  domainIndex: Map<string, DomainLookupEntry>,
  droppedBy: Partial<Record<SourceType, EnemySourceEntry[]>>,
  usedIn: string[],
  ascensionUsage: { characters: string[]; weapons: string[] },
  talentUsage: string[],
  sellers: MaterialSellerData[],
): MaterialOutput {
  const name = lang === 'fr' && frName ? frName : raw.title;
  const description = lang === 'fr' && frFields ? frFields.description : raw.description;

  return {
    name,
    // Même clé que scrape-material-images.ts (slugify(pageTitle)) : l'icône
    // est indépendante de la langue, donc identique en/fr — matche
    // directement le param :file de GET /assets/materials/:file (sans
    // extension, le controller essaie déjà .png/.webp/...).
    image: slugify(raw.pageTitle),
    rarity: raw.rarity,
    categories: raw.categories,
    description,
    sources: buildSourceEntries(raw, domainIndex, droppedBy, lang),
    // Pas d'équivalent FR pour ces sections (cf. NOTE en tête de fichier) :
    // réutilisées telles quelles.
    usedIn,
    usedByCharacters: { ascension: ascensionUsage.characters, talent: talentUsage },
    usedByWeapons: ascensionUsage.weapons,
    sellers,
  };
}

// ── FR: infobox (description uniquement — le nom vient du langlink) ─────
// Le wiki FR utilise un template différent de l'EN ({{Infobox objet}}, pas
// {{Item Infobox}}) et n'a pas de champ "title" équivalent : contrairement
// à l'EN (où le champ title existe pour gérer les soft-hyphens de mise en
// page), le nom FR est simplement le titre de la page, déjà connu via le
// langlink (frTitle) — inutile de le re-parser depuis l'infobox.

function parseFrMaterialFields(content: string): { description: string } | null {
  const block = extractBracedBlock(content, '{{Infobox objet');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  return {
    description: cleanWikitext(fields['description'] ?? ''),
  };
}

// ── Pipeline: 1 matériau ──────────────────────────────────────────────────

async function scrapeMaterial(
  pageTitle: string,
  domainIndex: Map<string, DomainLookupEntry>,
): Promise<CachedMaterial | null> {
  const { content, frTitle } = await fetchWikitextWithLanglink(pageTitle);
  if (!content) {
    console.warn(`⚠️  "${pageTitle}": page introuvable ou vide, ignorée.`);
    return null;
  }

  const raw = parseMaterialInfoboxEn(pageTitle, content, frTitle);
  if (!raw) {
    console.warn(`⚠️  "${pageTitle}": pas de {{Item Infobox}} trouvé, ignorée.`);
    return null;
  }

  const html = await fetchHtml(pageTitle);
  const droppedBy = parseDroppedByHtml(html);
  const usedIn = parseCraftUsageHtml(html);
  const ascensionUsage = parseAscensionUsageHtml(html);
  const talentUsage = parseTalentLevelingUsageHtml(html);
  const sellers = parseShopAvailabilityHtml(html, raw.title);

  const en = buildMaterialOutput(
    raw,
    'en',
    null,
    null,
    domainIndex,
    droppedBy,
    usedIn,
    ascensionUsage,
    talentUsage,
    sellers,
  );

  let fr: MaterialOutput | null = null;
  if (frTitle) {
    const frContent = await fetchWikitext(frTitle, FR_API_URL);
    const frFields = frContent ? parseFrMaterialFields(frContent) : null;
    if (frFields && frFields.description) {
      fr = buildMaterialOutput(
        raw,
        'fr',
        frTitle,
        frFields,
        domainIndex,
        droppedBy,
        usedIn,
        ascensionUsage,
        talentUsage,
        sellers,
      );
    } else {
      console.warn(`⚠️  "${pageTitle}": page FR "${frTitle}" trouvée mais infobox incomplète — fichier fr/ non généré.`);
    }
  } else {
    console.warn(`⚠️  "${pageTitle}": pas de langlink FR — fichier fr/ non généré.`);
  }

  return { pageTitle, en, fr };
}

async function scrapeAll(pageTitles: string[]): Promise<CachedMaterial[]> {
  const domainIndex = buildDomainIndex();
  const results: CachedMaterial[] = [];

  for (let i = 0; i < pageTitles.length; i++) {
    console.log(`Scraping "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    const material = await scrapeMaterial(pageTitles[i], domainIndex);
    if (material) results.push(material);
    await sleep(300);
  }

  return results;
}

// ── Bulk (optionnel): catégorie du wiki ──────────────────────────────────
// Le wiki n'a pas de catégorie unique regroupant TOUS les matériaux (les
// gemmes d'ascension, les drops d'ennemis et les spécialités locales sont
// catégorisés séparément) : --category ne couvre donc qu'une famille à la
// fois, à combiner en plusieurs runs si besoin.

// ── Output ────────────────────────────────────────────────────────────────────

function writeMaterialFiles(materials: CachedMaterial[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  let written = 0;
  let skippedFr = 0;
  for (const material of materials) {
    const filename = `${slugify(material.en.name)}.json`;

    fs.writeFileSync(path.join(enDir, filename), JSON.stringify(material.en, null, 2), 'utf-8');

    if (material.fr) {
      fs.writeFileSync(path.join(frDir, filename), JSON.stringify(material.fr, null, 2), 'utf-8');
    } else {
      skippedFr++;
    }
    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} matériau(x) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  console.log(`✅ Wrote ${written} material files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--fetch-category'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Fetch une liste de pages   : npx ts-node ... scrape-materials.ts --fetch "Nom 1" "Nom 2"');
    console.error('  Fetch une catégorie entière: npx ts-node ... scrape-materials.ts --fetch-category "Ascension Gems"');
    process.exit(1);
  }

  const pageTitles =
    args[0] === '--fetch-category' ? await fetchCategoryMembers(args[1]) : args.slice(1);

  if (pageTitles.length === 0) {
    console.error('❌ Aucune page à scraper (liste vide).');
    process.exit(1);
  }

  const materials = await scrapeAll(pageTitles);
  writeMaterialFiles(materials);
}

main();
