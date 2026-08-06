// scripts/scrape-enemies.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';
const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/enemies/${lang}`);
const CACHE_PATH = path.resolve(__dirname, './cache/enemies-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Contrairement à Category:Domains / Category:Achievements, Category:Enemies
// ne contient aucune page directement : seulement quatre sous-catégories,
// Category:Common Enemies, Category:Elite Enemies, Category:Normal Bosses et
// Category:Weekly Bosses. On les interroge donc séparément puis on fusionne
// les résultats (dédoublonnage par pageTitle par précaution, même si les
// catégories sont normalement disjointes).
//
// Chaque page utilise {{Enemy Infobox}} (name/title/type/family/group/région/
// zone/dégâts/faiblesse/capacités), mais son contenu diffère fortement selon
// le type :
// - Common/Elite Enemies : infobox minimaliste (family/group/weakpoint/
//   ability), pas de title/région/area/subArea/dmgtype, drops via
//   {{Drops Table|type=...}} (transclusion générique, pas de récompenses par
//   World Level).
// - Normal/Weekly Bosses : infobox complète (title/région/dmgtype/...),
//   récompenses via {{World Boss Rewards}} / {{Weekly Boss Rewards}}
//   (matériaux exclusifs, gemmes d'ascension, sets d'artéfacts) + un tableau
//   de récompenses par World Level (boss normaux) ou Domain Level (boss
//   hebdomadaires, table transclue depuis le Trounce Domain). Les boss à
//   plusieurs phases (ex: La Signora, Childe) ont PLUSIEURS blocs
//   {{Enemy Infobox}} sur la même page (un par phase) : on les extrait tous,
//   pas seulement le premier.
//
// Les stats de combat détaillées ({{Enemy Stats}}) ne sont PAS calculables
// depuis le wikitext brut, quel que soit le type d'ennemi : le wiki ne stocke
// que des ratios (hp_ratio, hp_type, atk_ratio) appliqués à une table de
// scaling par niveau via un module Lua. On récupère donc en plus le HTML
// rendu de la page (action=parse) pour lire les tableaux déjà calculés (RES +
// Level Scaling) dans la section "==Stats==", ainsi que les tableaux/cartes de
// récompenses dans "==Rewards==" (boss hebdomadaires), "==Drops==" (Common/
// Elite Enemies) ou "==Drops==" > "===Items===" (boss normaux). Une requête
// HTTP supplémentaire par ennemi est donc nécessaire (fetchEnemyHtml).
//
// Certaines pages des catégories ne sont pas des fiches ennemi mais des pages
// guides ("Normal Boss", "Weekly Boss", "Common Enemy", "Elite Enemy") : elles
// n'ont pas de {{Enemy Infobox}} et sont donc naturellement filtrées, comme
// pour les achievements/domains.
//
// ── FR ────────────────────────────────────────────────────────────────────
//
// Comme pour scrape-domains.ts/scrape-artifacts.ts, la page FR ({{Infobox
// Ennemi}}) est structurellement bien plus pauvre que l'EN : nom/famille/
// groupe/titre (boss uniquement) et une section "==Récompenses==" via
// {{Récompenses/Ennemi|...}} (Common/Elite Enemies, liste plate de
// matériaux) ou {{Récompenses/Boss|boss=...|gemmes=...|sets=...}} (boss).
// Aucune trace de dmgtype/weakpoint/abilities, de stats détaillées (RES +
// Level Scaling) ni de tableau de récompenses par World/Domain Level. On
// traduit donc uniquement ce qui EST disponible côté FR (nom, titre,
// famille, groupe, matériaux/sets de récompense) et on réutilise tel quel le
// reste des données EN (abilities, dmgtype, stats, location, basicRewards —
// seul le libellé de chaque récompense de basicRewards est traduit, les
// quantités/paliers restant identiques), comme le font déjà
// scrape-domains.ts et scrape-artifacts.ts pour leurs propres champs
// non-disponibles côté FR.
// ─────────────────────────────────────────────────────────────────────────────

const ENEMY_CATEGORIES = [
  'Category:Common Enemies',
  'Category:Elite Enemies',
  'Category:Normal Bosses',
  'Category:Weekly Bosses',
];

// Les deux catégories de boss produisent le schéma de sortie "riche"
// (title/location/phases détaillées/basicRewards par palier) ; Common/Elite
// Enemies produisent un schéma allégé (voir writeEnemyFiles).
function isBossType(rawType: string): boolean {
  return /^(normal|weekly) bosses$/i.test(rawType.trim());
}

const ELEMENTS = [
  'physical',
  'pyro',
  'hydro',
  'electro',
  'cryo',
  'dendro',
  'anemo',
  'geo',
] as const;

// Ordre + libellés attendus en sortie pour bossRewards.basicRewards[].rewards
// (repris tel quel du fichier de référence la_signora_REWRITEN.json).
const BASIC_REWARD_NAMES = [
  'Adventure EXP',
  'Mora',
  'Companionship EXP',
  'Character EXP',
];

// Équivalents FR des 4 libellés ci-dessus. "EXP d'Aventure"/"EXP d'affinité"
// sont repris tels quels de REWARD_LABELS.fr dans scrape-domains.ts (wording
// confirmé sur les pages Trounce FR) ; "Mora" est identique EN/FR. "EXP de
// Personnage" n'a pas d'équivalent confirmé sur une page FR (le tableau de
// récompenses par palier n'existe pas côté FR, cf. NOTE ci-dessus) : c'est
// une traduction directe du terme, pas une valeur relevée sur le wiki.
const BASIC_REWARD_NAMES_FR: Record<string, string> = {
  'Adventure EXP': "EXP d'Aventure",
  Mora: 'Mora',
  'Companionship EXP': "EXP d'affinité",
  'Character EXP': 'EXP de Personnage',
};

interface LevelStats {
  hp: number;
  def: number;
  atk: number;
}

interface PhaseStatsRaw {
  resistance: Record<string, number>;
  levels: Record<string, LevelStats>;
}

interface RawPhase {
  name: string;
  damageTypes: string[];
  hasWeakPoint: boolean;
  abilities: string[];
  stats: PhaseStatsRaw;
}

interface BasicReward {
  // Un seul des deux est renseigné selon le type de boss : "domainLevel"
  // pour les boss hebdomadaires (table transclue depuis un Trounce Domain,
  // paliers "I".."IV"), "worldLevel" pour les boss normaux (table "World
  // Level" directement sur la page du boss, paliers "0".."8"). Ce sont deux
  // notions différentes du jeu, pas juste un renommage de la même colonne.
  domainLevel?: number;
  worldLevel?: number;
  bossLevel: number;
  rewards: { name: string; quantity: number }[];
}

interface PoolRewards {
  materials: string[];
  artefacts: string[];
}

interface RawEnemy {
  pageTitle: string;
  name: string;
  title: string; // boss uniquement
  type: string; // valeur brute de l'infobox : "Common Enemies" | "Elite Enemies" | "Normal Bosses" | "Weekly Bosses"
  family: string;
  group: string;
  region: string; // boss uniquement
  area: string; // boss uniquement
  subArea: string; // boss uniquement
  domain: string; // boss uniquement — champ "location" de l'infobox (nom du Trounce Domain, si applicable)
  phases: RawPhase[]; // toujours 1 seule entrée pour Common/Elite Enemies
  poolRewards: PoolRewards;
  basicRewards: BasicReward[]; // boss uniquement — [] pour Common/Elite Enemies
  releaseVersion: string;
  otherLanguagesFrName: string | null;
}

// Traductions FR disponibles pour un ennemi donné (cf. NOTE FR en tête de
// fichier) : uniquement les champs réellement présents sur la page FR.
interface FrEnemyPage {
  name: string;
  title: string; // boss uniquement — champ "titre" de {{Infobox Ennemi}}
  family: string;
  group: string;
  poolRewards: PoolRewards;
}

interface CachedEnemy {
  pageTitle: string;
  releaseVersion: string;
  en:
    | ReturnType<typeof buildBossOutput>
    | ReturnType<typeof buildCommonEnemyOutput>;
  // Toujours renseigné : repli sur le contenu EN (nom EN inclus) quand aucune
  // page FR exploitable n'a été trouvée, cf. enrichEnemy.
  fr:
    | ReturnType<typeof buildBossOutput>
    | ReturnType<typeof buildCommonEnemyOutput>;
}

// ── Wikitext helpers (repris tels quels des scripts achievements/domains) ───

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

// Certains boss à plusieurs phases (La Signora, Childe, ...) ont PLUSIEURS
// blocs {{Enemy Infobox}} sur la même page, un par phase, dans l'ordre.
function extractAllBracedBlocks(
  content: string,
  startMarker: string,
): string[] {
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
    const m = line.match(/^\|\s*([\w -]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Variante utilisée pour l'infobox FR ({{Infobox Ennemi}}) : les noms de
// champs peuvent contenir des accents (ex: "élément"), non couverts par \w
// en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp(
        `[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`,
        'g',
      ),
      '',
    )
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// dmgtype (sans suffixe) puis dmgtype2, dmgtype3, ... selon le nombre
// d'éléments infligés par le boss.
function parseDamageTypes(fields: Record<string, string>): string[] {
  const types: string[] = [];
  if (fields['dmgtype']) types.push(cleanWikitext(fields['dmgtype']));
  for (let i = 2; ; i++) {
    const value = fields[`dmgtype${i}`];
    if (!value) break;
    types.push(cleanWikitext(value));
  }
  return types;
}

// ability1, ability2, ... jusqu'à la première absente.
function parseAbilities(fields: Record<string, string>): string[] {
  const abilities: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`ability${i}`];
    if (!value) break;
    abilities.push(cleanWikitext(value));
  }
  return abilities;
}

// Pas de |name= exploitable sur la plupart des pages (seul Andrius en a un) :
// on dérive du titre de page, en retirant les suffixes de désambiguïsation
// du type "Azhdaha (Weekly Boss)".
function extractEnemyName(
  fields: Record<string, string>,
  pageTitle: string,
): string {
  if (fields['name']) return cleanWikitext(fields['name']);
  return pageTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// ── HTML helpers (tableaux déjà calculés par le wiki, via action=parse) ────

// Isole le HTML d'une section (identifiée par son id de heading) jusqu'au
// prochain heading de niveau h2 ou h3, quel que soit le niveau du heading de
// départ. Ex: "Stats" (h2) s'arrête au prochain h2 ("Abilities"), "Items"
// (h3, imbriqué sous "Drops") s'arrête au prochain h3 ("Energy").
function extractSectionHtml(html: string, id: string): string | null {
  const marker = `id="${id}"`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  // Le heading portant cet id peut être un h2 (ex: "Stats") ou un h3 imbriqué
  // (ex: "Items" sous "Drops"). Un h2 doit avaler ses propres sous-sections
  // h3 (ex: "Phase 1"/"Phase 2" sous "Stats") : on ne s'arrête donc qu'au
  // prochain h2 dans ce cas, jamais à un h3 intermédiaire.
  const lastH2Before = html.lastIndexOf('<h2', idx);
  const lastH3Before = html.lastIndexOf('<h3', idx);
  const isH2 = lastH2Before > lastH3Before;

  const searchFrom = idx + marker.length;
  const nextH2 = html.indexOf('<h2', searchFrom);
  const nextH3 = html.indexOf('<h3', searchFrom);
  const candidates = isH2 ? [nextH2] : [nextH2, nextH3];
  const validCandidates = candidates.filter((n) => n !== -1);
  const end = validCandidates.length
    ? Math.min(...validCandidates)
    : html.length;
  return html.slice(idx, end);
}

// "−30%" (signe moins unicode utilisé par le wiki) / "0%" / "170%" -> nombre.
function parsePercent(raw: string): number {
  const cleaned = raw.replace(/−/g, '-').replace('%', '').trim();
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? 0 : n;
}

function parseNumber(raw: string): number {
  const n = parseInt(raw.replace(/,/g, '').trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

// Table "RES" ({{Enemy Stats}}) : une ligne d'icônes d'éléments, puis une ou
// plusieurs lignes de valeurs (une par état, ex: Normal/Stunned pour Childe).
// On ne garde que la première ligne de valeurs (état "par défaut").
function parseResistanceTable(
  $: ReturnType<typeof cheerio.load>,
  table: cheerio.Element,
): Record<string, number> {
  const rows = $(table).find('tr').toArray();
  const elementRowIdx = rows.findIndex(
    (row) => $(row).find('img[alt]').length >= 4,
  );
  if (elementRowIdx === -1) return {};

  const elements = $(rows[elementRowIdx])
    .find('img[alt]')
    .toArray()
    .map((img) => ($(img).attr('alt') ?? '').trim().toLowerCase())
    .filter(Boolean);

  const dataRow = rows[elementRowIdx + 1];
  if (!dataRow) return {};

  const values = $(dataRow)
    .find('td, th')
    .toArray()
    .map((cell) => $(cell).text().trim())
    .filter((v) => /%$/.test(v));
  // Une éventuelle colonne d'état ("Normal"/"Stunned") en tête de ligne est
  // filtrée ici car elle ne matche pas /%$/.
  const aligned = values.slice(-elements.length);

  const resistance: Record<string, number> = {};
  elements.forEach((el, i) => {
    if (aligned[i] !== undefined) resistance[el] = parsePercent(aligned[i]);
  });
  return resistance;
}

// Table "Level Scaling" ({{Enemy Stats}}) : Level | HP | ATK | DEF, une ligne
// par niveau. Contrairement à une sélection de niveaux "milestones", on
// récupère ICI systématiquement toutes les lignes présentes (typiquement 1 à
// 104 par paliers de 1), le wiki les calculant déjà toutes via son module Lua.
function parseLevelScalingTable(
  $: ReturnType<typeof cheerio.load>,
  table: cheerio.Element,
): Record<string, LevelStats> {
  const levels: Record<string, LevelStats> = {};
  for (const row of $(table).find('tr').toArray()) {
    const cells = $(row).find('td').toArray();
    if (cells.length < 4) continue; // lignes d'en-tête (th) ignorées
    const level = $(cells[0]).text().trim();
    if (!/^\d+$/.test(level)) continue;
    levels[level] = {
      hp: parseNumber($(cells[1]).text()),
      atk: parseNumber($(cells[2]).text()),
      def: parseNumber($(cells[3]).text()),
    };
  }
  return levels;
}

// Dans la section "==Stats==", chaque phase produit exactement 2 tables dans
// l'ordre : RES puis Level Scaling (confirmé sur La Signora [2 phases],
// Childe [3 phases] et Cryo Regisvine [1 phase, pas de sous-titre "Phase"]).
// On filtre d'abord les tables non pertinentes puis on les apparie 2 par 2.
function parseStatsPhases(sectionHtml: string): PhaseStatsRaw[] {
  const $ = cheerio.load(sectionHtml);
  const tables = $('table')
    .toArray()
    .filter((t) => {
      const cls = $(t).attr('class') ?? '';
      const text = $(t).text();
      return (
        (cls.includes('wikitable') && text.includes('RES')) ||
        cls.includes('waffle') ||
        text.includes('Level Scaling')
      );
    });

  const phases: PhaseStatsRaw[] = [];
  for (let i = 0; i + 1 < tables.length; i += 2) {
    phases.push({
      resistance: parseResistanceTable($, tables[i]),
      levels: parseLevelScalingTable($, tables[i + 1]),
    });
  }
  return phases;
}

// Liste d'icônes de la section Rewards, hors tableaux (`.wds-tabber`) : ce
// sont les matériaux exclusifs, gemmes d'ascension (toutes qualités), sets
// d'artéfacts, Dream Solvent et Northlander Billets. La classe
// "card-quality-XX" (2 chiffres ou plus, ex: "34", "45", "123") identifie
// spécifiquement les sets d'artéfacts (qui peuvent apparaître sur plusieurs
// raretés), contrairement aux matériaux ("card-quality-4", 1 chiffre).
function parsePoolRewards(sectionHtml: string): PoolRewards {
  const $ = cheerio.load(sectionHtml);
  const materials: string[] = [];
  const artefacts: string[] = [];
  const seen = new Set<string>();

  $('.card-container.mini-card').each((_, el) => {
    if ($(el).closest('.wds-tabber').length > 0) return;

    const name = $(el).find('a[title]').first().attr('title')?.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);

    const qualityClass =
      $(el)
        .find('[class*="card-quality-"]')
        .first()
        .attr('class')
        ?.match(/card-quality-(\d+)/)?.[1] ?? '';

    if (qualityClass.length > 1) artefacts.push(name);
    else materials.push(name);
  });

  return { materials, artefacts };
}

function romanToInt(roman: string): number {
  const map: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  const s = roman.toUpperCase();
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    if (!cur) return NaN;
    const next = map[s[i + 1]];
    result += next && cur < next ? -cur : cur;
  }
  return result;
}

// "I"/"II"/"III"/"IV" (Trounce Domains) ou "0".."8" (World Level, boss
// normaux) selon le type de boss.
function parseLevelCell(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const roman = romanToInt(trimmed);
  return Number.isNaN(roman) ? 0 : roman;
}

// Table "Basic Drops" (1er onglet du tabber Rewards) : Domain/World Level |
// Boss Level | Adventure EXP | Mora | Character EXP | Companionship EXP |
// (Talent Materials | Northlander Billets | Dream Solvent, ignorés ici).
function parseBasicRewards(sectionHtml: string): BasicReward[] {
  const $ = cheerio.load(sectionHtml);
  const table = $('.wds-tabber .wds-tab__content')
    .first()
    .find('table.wikitable')
    .first();
  if (!table.length) return [];

  const rows = table.find('tr').toArray();
  if (!rows.length) return [];

  const columns = $(rows[0])
    .find('th')
    .toArray()
    .map(
      (th) =>
        $(th).find('a[title]').first().attr('title') ??
        $(th).text().replace(/\s+/g, ' ').trim(),
    );

  // columns[0] = en-tête de la 1ère colonne ("World Level" ou "Domain
  // Level" selon le type de boss) : détermine quelle clé remplir plus bas.
  const isWorldLevel = /world/i.test(columns[0] ?? '');

  const results: BasicReward[] = [];
  for (const row of rows.slice(1)) {
    const levelCell = $(row).find('th').first();
    if (!levelCell.length) continue; // ligne vide de séparation ("mw-empty-elt")

    const tds = $(row).find('td').toArray();
    if (!tds.length) continue;

    const rewards: { name: string; quantity: number }[] = [];
    for (const name of BASIC_REWARD_NAMES) {
      const colIdx = columns.indexOf(name);
      if (colIdx === -1) continue;
      // columns[0] = en-tête du niveau (th, hors `tds`) : décalage de 1.
      const td = tds[colIdx - 1];
      if (!td) continue;
      const text = $(td).text().replace(/,/g, '').trim();
      if (!/^\d+$/.test(text)) continue;
      rewards.push({ name, quantity: parseInt(text, 10) });
    }

    const level = parseLevelCell(levelCell.text());
    results.push({
      ...(isWorldLevel ? { worldLevel: level } : { domainLevel: level }),
      bossLevel: parseNumber($(tds[0]).text()),
      rewards,
    });
  }
  return results;
}

// ── FR : {{Infobox Ennemi}} + {{Récompenses/Ennemi}} / {{Récompenses/Boss}} ─

// Sépare une valeur "A;B;C" (séparateur observé sur les templates
// Récompenses/*) en libellés nettoyés.
function splitFrRewardList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => cleanWikitext(s))
    .filter(Boolean);
}

// {{Récompenses/Boss|type=...|boss=A;B|gemmes=C;D|sets=E;F}} : "boss" et
// "gemmes" sont des matériaux (matériau de boss + gemmes d'ascension), "sets"
// des sets d'artéfacts — même distinction materials/artefacts que côté EN.
function parseFrBossRewards(block: string): PoolRewards {
  const fields = parseInfoboxFieldsAccented(block);
  return {
    materials: [
      ...splitFrRewardList(fields['boss']),
      ...splitFrRewardList(fields['gemmes']),
    ],
    artefacts: splitFrRewardList(fields['sets']),
  };
}

// {{Récompenses/Ennemi|Masque endommagé}} (Common/Elite Enemies) : un seul
// paramètre positionnel, liste de matériaux séparés par ";" (jamais de sets
// d'artéfacts à ce niveau, cf. NOTE FR en tête de fichier).
function parseFrEnemyRewards(block: string): PoolRewards {
  const inner = block
    .replace(/^\{\{Récompenses\/Ennemi\s*\|/, '')
    .replace(/\}\}$/, '');
  return { materials: splitFrRewardList(inner), artefacts: [] };
}

function parseFrPoolRewards(content: string): PoolRewards {
  const bossBlock = extractBracedBlock(content, '{{Récompenses/Boss');
  if (bossBlock) return parseFrBossRewards(bossBlock);

  const enemyBlock = extractBracedBlock(content, '{{Récompenses/Ennemi');
  if (enemyBlock) return parseFrEnemyRewards(enemyBlock);

  return { materials: [], artefacts: [] };
}

function parseFrEnemyPage(content: string): FrEnemyPage | null {
  const block = extractBracedBlock(content, '{{Infobox Ennemi');
  if (!block) return null;
  const fields = parseInfoboxFieldsAccented(block);

  return {
    name: cleanWikitext(fields['nom'] ?? ''),
    title: cleanWikitext(fields['titre'] ?? ''),
    family: cleanWikitext(fields['famille'] ?? ''),
    group: cleanWikitext(fields['groupe'] ?? ''),
    poolRewards: parseFrPoolRewards(content),
  };
}

// ── FR : nom documenté par {{Other Languages}} sur la page EN elle-même ────
//
// Repris de scrape-domains.ts (resolveFrNameViaOtherLanguages) : quand aucune
// page FR dédiée n'existe pour un ennemi (pas de langlink), le wikitext EN
// documente malgré tout le nom officiel FR via {{Other Languages|fr=...}}
// (confirmé sur "Bolteater Bathysmal Vishap Hatchling" et "Magatsu Mitake
// Narukami no Mikoto", tous deux sans page FR mais avec un champ fr= renseigné).
// Contrairement aux pages de domaines, ce champ est ici TOUJOURS en clair
// dans le wikitext brut (paramètres nommés explicites, jamais un seul
// paramètre positionnel résolu par un module Lua) : la lecture du wikitext
// suffit, sans requête HTML supplémentaire.
function parseOtherLanguagesField(
  content: string,
  lang: string,
): string | null {
  const block = extractBracedBlock(content, '{{Other Languages');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  const value = fields[lang];
  return value ? cleanWikitext(value) : null;
}

// Filet de sécurité si jamais le format positionnel (résolu uniquement dans
// le rendu HTML, comme documenté pour les domaines) se rencontrait malgré
// tout sur une page d'ennemi : on retente sur le HTML déjà récupéré par
// enrichWithHtml (pas de requête supplémentaire).
function parseFrNameFromOtherLanguagesHtml(html: string): string | null {
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

// ── API ───────────────────────────────────────────────────────────────────────

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
};
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number) {
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
        console.warn(
          `⚠️  ${label} a échoué (tentative ${i + 1}/${attempts}), nouvel essai...`,
        );
        await sleep(800 * (i + 1));
      }
    }
  }
  throw lastErr;
}

async function fetchEnemyHtml(pageTitle: string): Promise<string> {
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
}

// Titre de page FR équivalent (via langlink), résolu tel quel côté domains/
// artifacts : requête dédiée par page, utilisée en repli quand le langlink
// groupé de fetchBatch n'a rien donné.
async function fetchFrTitleDirect(pageTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch langlink FR "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'langlinks',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      return page?.langlinks?.[0]?.title ?? null;
    });
  } catch (err) {
    console.warn(
      `⚠️  Échec du fetch langlink FR pour "${pageTitle}" après plusieurs tentatives: ${err}`,
    );
    return null;
  }
}

async function fetchFrWikitext(frTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext FR "${frTitle}"`, async () => {
      const response = await axios.get(FR_API_URL, {
        params: {
          action: 'query',
          titles: frTitle,
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
    console.warn(
      `⚠️  Échec du fetch wikitext FR pour "${frTitle}" après plusieurs tentatives: ${err}`,
    );
    return null;
  }
}

interface RawInfoboxEnemy {
  pageTitle: string;
  name: string;
  title: string;
  type: string;
  family: string;
  group: string;
  region: string;
  area: string;
  subArea: string;
  domain: string;
  infoboxes: Record<string, string>[];
  releaseVersion: string;
  frTitle: string | null;
  // Nom FR documenté par {{Other Languages|fr=...}} sur la page EN elle-même
  // (indépendant de l'existence d'un langlink/d'une page FR dédiée), résolu
  // directement depuis le wikitext déjà en main — cf. resolveOtherLanguagesFrName.
  otherLanguagesFrName: string | null;
}

async function fetchBatch(
  category: string,
  gcmcontinue?: string,
): Promise<{
  results: RawInfoboxEnemy[];
  nextContinue?: string;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: category,
    gcmlimit: '50',
    prop: 'revisions|langlinks',
    rvprop: 'content',
    rvslots: 'main',
    lllang: 'fr',
    format: 'json',
    formatversion: '2',
  };
  if (gcmcontinue) params.gcmcontinue = gcmcontinue;

  const response = await axios.get(EN_API_URL, {
    params,
    headers: HTTP_HEADERS,
    httpsAgent,
  });

  const pages = response.data?.query?.pages ?? [];
  const nextContinue = response.data?.continue?.gcmcontinue;
  const results: RawInfoboxEnemy[] = [];

  for (const page of pages) {
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    // Exclut les pages guides ("Normal Boss", "Weekly Boss", "Common Enemy",
    // "Elite Enemy") sans infobox.
    if (!content.includes('{{Enemy Infobox')) continue;

    const infoboxBlocks = extractAllBracedBlocks(content, '{{Enemy Infobox');
    const infoboxes = infoboxBlocks.map(parseInfoboxFields);
    const fields = infoboxes[0] ?? {};

    // Le titre / le lien de domaine ne sont parfois présents que sur un seul
    // des blocs infobox (ex: La Signora phase 1 uniquement) : on cherche
    // dans tous les blocs, dans l'ordre. Non applicable aux Common/Elite
    // Enemies (jamais renseignés), qui n'ont de toute façon qu'un seul bloc.
    const title = infoboxes.find((f) => f['title'])?.['title'] ?? '';
    const domain = infoboxes.find((f) => f['location'])?.['location'] ?? '';

    const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);
    const version = versionMatch ? versionMatch[1].trim() : '';

    results.push({
      pageTitle: page.title,
      name: extractEnemyName(fields, page.title),
      title: cleanWikitext(title),
      type: cleanWikitext(fields['type'] ?? ''),
      family: cleanWikitext(fields['family'] ?? ''),
      group: cleanWikitext(fields['group'] ?? ''),
      region: cleanWikitext(fields['region'] ?? ''),
      area: cleanWikitext(fields['area'] ?? ''),
      subArea: cleanWikitext(fields['subarea'] ?? ''),
      domain: cleanWikitext(domain),
      infoboxes,
      releaseVersion: version,
      frTitle: page.langlinks?.[0]?.title ?? null,
      otherLanguagesFrName: parseOtherLanguagesField(content, 'fr'),
    });
  }

  return { results, nextContinue };
}

async function fetchAllForCategory(
  category: string,
): Promise<RawInfoboxEnemy[]> {
  const all: RawInfoboxEnemy[] = [];
  let cont: string | undefined;
  let page = 1;
  do {
    console.log(`Fetching ${category} batch ${page}...`);
    const { results, nextContinue } = await fetchBatch(category, cont);
    all.push(...results);
    cont = nextContinue;
    page++;
    await sleep(500);
  } while (cont);
  return all;
}

// Complète chaque ennemi avec les phases (stats) et récompenses, extraites du
// HTML rendu de sa page (1 requête HTTP supplémentaire par ennemi).
async function enrichWithHtml(
  enemy: RawInfoboxEnemy,
): Promise<RawEnemy> {
  let html = '';
  try {
    html = await fetchEnemyHtml(enemy.pageTitle);
  } catch (err) {
    console.warn(`⚠️  Échec du fetch HTML pour "${enemy.pageTitle}": ${err}`);
  }

  const statsSection = html ? extractSectionHtml(html, 'Stats') : null;
  const statsPhases = statsSection ? parseStatsPhases(statsSection) : [];

  // "Rewards" (boss hebdomadaires), "Items" (sous-section de "Drops" pour les
  // boss normaux), "Drops" (Common/Elite Enemies, table transcluse directe
  // sans sous-section "Items") : on essaie dans cet ordre.
  const rewardsSection = html
    ? (extractSectionHtml(html, 'Rewards') ??
      extractSectionHtml(html, 'Items') ??
      extractSectionHtml(html, 'Drops'))
    : null;
  const poolRewards = rewardsSection
    ? parsePoolRewards(rewardsSection)
    : { materials: [], artefacts: [] };
  const basicRewards = rewardsSection ? parseBasicRewards(rewardsSection) : [];

  // Le nombre de phases est déterminé par le nombre de blocs
  // {{Enemy Infobox}} (un par phase, confirmé sur La Signora et Childe), PAS
  // par le nombre de blocs {{Enemy Stats}} : certains boss à une seule phase
  // documentent plusieurs variantes de stats sous "==Stats==" (ex: Aeonblight
  // Drake a "===Normal===" et "===Stygian Onslaught===", un état de combat
  // renforcé, pas une phase distincte) sans avoir plusieurs infobox pour
  // autant. Dans ce cas on ne garde que le premier bloc de stats (l'état de
  // base) et les blocs excédentaires sont ignorés. Common/Elite Enemies n'ont
  // jamais qu'un seul bloc infobox, donc toujours 1 phase.
  const phaseCount = Math.max(enemy.infoboxes.length, 1);
  if (statsPhases.length !== phaseCount) {
    console.warn(
      `⚠️  "${enemy.pageTitle}": ${statsPhases.length} bloc(s) de stats pour ${phaseCount} phase(s) (infobox) — ` +
        (statsPhases.length > phaseCount
          ? 'les blocs excédentaires (variante de combat ?) sont ignorés.'
          : 'stats manquantes pour au moins une phase.'),
    );
  }
  const phases: RawPhase[] = [];
  for (let i = 0; i < phaseCount; i++) {
    const infobox =
      enemy.infoboxes[Math.min(i, enemy.infoboxes.length - 1)] ?? {};
    const statsRaw = statsPhases[i] ?? { resistance: {}, levels: {} };

    const resistance: Record<string, number> = {};
    for (const el of ELEMENTS) resistance[el] = statsRaw.resistance[el] ?? 0;

    phases.push({
      name: infobox['name'] ? cleanWikitext(infobox['name']) : enemy.name,
      damageTypes: parseDamageTypes(infobox),
      hasWeakPoint: (infobox['weakpoint'] ?? '').trim().toLowerCase() === 'yes',
      abilities: parseAbilities(infobox),
      stats: { resistance, levels: statsRaw.levels },
    });
  }

  return {
    pageTitle: enemy.pageTitle,
    name: enemy.name,
    title: enemy.title,
    type: enemy.type,
    family: enemy.family,
    group: enemy.group,
    region: enemy.region,
    area: enemy.area,
    subArea: enemy.subArea,
    domain: enemy.domain,
    phases,
    poolRewards,
    basicRewards,
    releaseVersion: enemy.releaseVersion,
    // Filet de sécurité HTML (cf. parseFrNameFromOtherLanguagesHtml) : ne
    // coûte aucune requête supplémentaire, le HTML est déjà en main ici pour
    // les stats/récompenses.
    otherLanguagesFrName:
      enemy.otherLanguagesFrName ??
      (html ? parseFrNameFromOtherLanguagesHtml(html) : null),
  };
}

async function fetchAllInfoboxEnemies(): Promise<RawInfoboxEnemy[]> {
  const byPageTitle = new Map<string, RawInfoboxEnemy>();
  for (const category of ENEMY_CATEGORIES) {
    const results = await fetchAllForCategory(category);
    for (const enemy of results) {
      // Comme pour scrape-domains.ts/scrape-artifacts.ts : le langlink FR
      // groupé peut arriver sur une continuation différente de celle de la
      // page elle-même — on complète plutôt que d'écraser si un round
      // ultérieur ramène la même page avec un frTitle et pas l'autre.
      const existing = byPageTitle.get(enemy.pageTitle);
      if (existing) {
        if (enemy.frTitle && !existing.frTitle)
          existing.frTitle = enemy.frTitle;
        continue;
      }
      byPageTitle.set(enemy.pageTitle, enemy);
    }
  }
  return [...byPageTitle.values()];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): CachedEnemy[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: CachedEnemy[]) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${data.length} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────

// Le champ "type" de l'infobox donne directement "Common Enemies" / "Elite
// Enemies" / "Normal Bosses" / "Weekly Bosses". On le transforme en libellé
// singulier lisible.
function enemyTypeLabel(rawType: string): string {
  if (/^weekly bosses$/i.test(rawType)) return 'Weekly Boss';
  if (/^normal bosses$/i.test(rawType)) return 'Normal Boss';
  if (/^elite enemies$/i.test(rawType)) return 'Elite Enemy';
  if (/^common enemies$/i.test(rawType)) return 'Common Enemy';
  return rawType;
}

// Champs traduisibles côté FR (cf. NOTE FR en tête de fichier) : absent pour
// l'EN (comportement par défaut, aucune override) ou quand aucune page FR
// n'a pu être résolue/parsée pour cet ennemi.
interface EnemyTranslation {
  name: string;
  title: string;
  family: string;
  group: string;
  poolRewards: PoolRewards;
}

function basicRewardsForLang(
  basicRewards: BasicReward[],
  lang: 'en' | 'fr',
): BasicReward[] {
  if (lang === 'en') return basicRewards;
  return basicRewards.map((entry) => ({
    ...entry,
    rewards: entry.rewards.map((reward) => ({
      ...reward,
      name: BASIC_REWARD_NAMES_FR[reward.name] ?? reward.name,
    })),
  }));
}

// Boss (Normal/Weekly) : schéma riche avec title/location/phases détaillées/
// récompenses par palier.
function buildBossOutput(
  enemy: RawEnemy,
  enemyType: string,
  lang: 'en' | 'fr' = 'en',
  translation?: EnemyTranslation,
) {
  return {
    name: translation?.name || enemy.name,
    enemyType,
    title: translation?.title || enemy.title,
    family: translation?.family || enemy.family,
    group: translation?.group || enemy.group,
    location: {
      region: enemy.region,
      area: enemy.area,
      subArea: enemy.subArea,
      domain: enemy.domain,
    },
    phases: enemy.phases.map((phase, idx) => ({
      phase: idx + 1,
      // Pas de traduction par phase disponible côté FR (une seule "titre" par
      // page) : on réutilise le nom traduit du boss pour chaque phase, comme
      // l'EN réutilise déjà enemy.name faute de |name= par phase.
      name: translation?.name || phase.name,
      damageTypes: phase.damageTypes,
      hasWeakPoint: phase.hasWeakPoint,
      abilities: phase.abilities,
      stats: {
        levels: phase.stats.levels,
        resistance: phase.stats.resistance,
      },
    })),
    bossRewards: {
      poolRewards: translation?.poolRewards || enemy.poolRewards,
      basicRewards: basicRewardsForLang(enemy.basicRewards, lang),
    },
    releaseVersion: enemy.releaseVersion,
  };
}

// Common/Elite Enemy : schéma allégé — pas de title/location/dmgtype (jamais
// renseignés sur ces pages) ni de récompenses par palier (pas de World/Domain
// Level pour un ennemi normal, seulement une Drops Table générique). Une
// seule "phase" existe toujours pour ces ennemis (un seul bloc infobox), donc
// pas de tableau `phases` : ses stats/abilities sont remontées directement.
function buildCommonEnemyOutput(
  enemy: RawEnemy,
  enemyType: string,
  translation?: EnemyTranslation,
) {
  const [phase] = enemy.phases;
  return {
    name: translation?.name || enemy.name,
    enemyType,
    family: translation?.family || enemy.family,
    group: translation?.group || enemy.group,
    hasWeakPoint: phase?.hasWeakPoint ?? false,
    abilities: phase?.abilities ?? [],
    stats: {
      levels: phase?.stats.levels ?? {},
      resistance: phase?.stats.resistance ?? {},
    },
    drops: translation?.poolRewards || enemy.poolRewards,
    releaseVersion: enemy.releaseVersion,
  };
}

// Enrichit un ennemi avec ses données EN (HTML rendu, cf. enrichWithHtml) et,
// si une page FR existe, construit également la version FR à partir des
// traductions disponibles (cf. NOTE FR en tête de fichier).
async function enrichEnemy(enemy: RawInfoboxEnemy): Promise<CachedEnemy> {
  const rawEnemy = await enrichWithHtml(enemy);
  const isBoss = isBossType(rawEnemy.type);
  const enemyType = enemyTypeLabel(rawEnemy.type);

  const buildOutput = (lang: 'en' | 'fr', translation?: EnemyTranslation) =>
    isBoss
      ? buildBossOutput(rawEnemy, enemyType, lang, translation)
      : buildCommonEnemyOutput(rawEnemy, enemyType, translation);

  const en = buildOutput('en');

  let frTitle = enemy.frTitle;
  if (!frTitle) frTitle = await fetchFrTitleDirect(enemy.pageTitle);

  // Repli quand aucune page FR dédiée n'est trouvée/exploitable (ci-dessous) :
  // le nom FR documenté par {{Other Languages|fr=...}} sur la page EN
  // elle-même (cf. resolveOtherLanguagesFrName), sinon le nom EN tel quel.
  // Le reste du contenu (title/family/group/poolRewards/basicRewards) reste
  // en anglais dans les deux cas, faute de source FR — demande utilisateur du
  // 2026-07-25.
  const fallbackName = rawEnemy.otherLanguagesFrName || rawEnemy.name;
  const fallbackFr = () =>
    buildOutput('en', {
      name: fallbackName,
      title: rawEnemy.title,
      family: rawEnemy.family,
      group: rawEnemy.group,
      poolRewards: rawEnemy.poolRewards,
    });

  let fr: ReturnType<typeof buildOutput>;
  if (frTitle) {
    const frContent = await fetchFrWikitext(frTitle);
    const frPage = frContent ? parseFrEnemyPage(frContent) : null;
    if (frPage) {
      const translation: EnemyTranslation = {
        name: frPage.name || frTitle,
        title: frPage.title,
        family: frPage.family,
        group: frPage.group,
        poolRewards:
          frPage.poolRewards.materials.length ||
          frPage.poolRewards.artefacts.length
            ? frPage.poolRewards
            : rawEnemy.poolRewards,
      };
      fr = buildOutput('fr', translation);
    } else {
      console.warn(
        `⚠️  "${enemy.pageTitle}": page FR "${frTitle}" introuvable ou sans {{Infobox Ennemi}} exploitable, fichier fr/ écrit avec le nom "${fallbackName}".`,
      );
      fr = fallbackFr();
    }
  } else {
    console.warn(
      `⚠️  "${enemy.pageTitle}": aucune page FR trouvée, fichier fr/ écrit avec le nom "${fallbackName}".`,
    );
    fr = fallbackFr();
  }

  return {
    pageTitle: rawEnemy.pageTitle,
    releaseVersion: rawEnemy.releaseVersion,
    en,
    fr,
  };
}

async function fetchAndEnrichAll(): Promise<CachedEnemy[]> {
  const infoboxEnemies = await fetchAllInfoboxEnemies();
  const enriched: CachedEnemy[] = [];
  for (let i = 0; i < infoboxEnemies.length; i++) {
    const enemy = infoboxEnemies[i];
    console.log(
      `Fetching stats/rewards for "${enemy.pageTitle}" (${i + 1}/${infoboxEnemies.length})...`,
    );
    enriched.push(await enrichEnemy(enemy));
    await sleep(500);
  }
  return enriched;
}

function writeEnemyFiles(enemies: CachedEnemy[], versionFilter?: string[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  const filtered = versionFilter?.length
    ? enemies.filter((e) => versionFilter.includes(e.releaseVersion))
    : enemies;

  let written = 0;
  for (const enemy of filtered) {
    const filename = `${slugify(enemy.en.name)}.json`;

    fs.writeFileSync(
      path.join(enDir, filename),
      JSON.stringify(enemy.en, null, 2),
      'utf-8',
    );

    // Toujours écrit : enemy.fr replie sur le contenu EN (nom EN inclus)
    // quand aucune page FR exploitable n'a été trouvée, cf. enrichEnemy.
    fs.writeFileSync(
      path.join(frDir, filename),
      JSON.stringify(enemy.fr, null, 2),
      'utf-8',
    );

    written++;
  }

  console.log(
    `✅ Wrote ${written} enemy files (en/ + fr/) to ${enDir} / ${frDir}`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout    : npx ts-node ... scrape-enemies.ts --fetch',
    );
    console.error(
      '  Cache + générer tout     : npx ts-node ... scrape-enemies.ts --cache',
    );
    console.error('  Filtrer par version(s)   : ... --cache 2.3 3.0');
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versionFilter = args.slice(1);

  let enemies: CachedEnemy[];

  if (useCache) {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    enemies = cached;
    console.log(`Loaded ${enemies.length} enemies from cache.`);
  } else {
    console.log(
      'Fetching all enemies from wiki (this will take a few minutes)...',
    );
    enemies = await fetchAndEnrichAll();
    saveCache(enemies);
  }

  writeEnemyFiles(enemies, versionFilter.length ? versionFilter : undefined);
}

main();
