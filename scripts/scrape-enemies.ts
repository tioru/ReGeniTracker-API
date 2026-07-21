// scripts/scrape-enemies.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/enemies/en');
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
  const candidates = isH2
    ? [nextH2]
    : [nextH2, nextH3];
  const validCandidates = candidates.filter((n) => n !== -1);
  const end = validCandidates.length ? Math.min(...validCandidates) : html.length;
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

// ── API ───────────────────────────────────────────────────────────────────────

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function fetchEnemyHtml(pageTitle: string): Promise<string> {
  const response = await axios.get(API_URL, {
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
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  };
  if (gcmcontinue) params.gcmcontinue = gcmcontinue;

  const response = await axios.get(API_URL, {
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
    await new Promise((r) => setTimeout(r, 500));
  } while (cont);
  return all;
}

// Complète chaque ennemi avec les phases (stats) et récompenses, extraites du
// HTML rendu de sa page (1 requête HTTP supplémentaire par ennemi).
async function enrichWithHtml(enemy: RawInfoboxEnemy): Promise<RawEnemy> {
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
      hasWeakPoint:
        (infobox['weakpoint'] ?? '').trim().toLowerCase() === 'yes',
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
  };
}

async function fetchAll(): Promise<RawEnemy[]> {
  const byPageTitle = new Map<string, RawInfoboxEnemy>();
  for (const category of ENEMY_CATEGORIES) {
    const results = await fetchAllForCategory(category);
    for (const enemy of results) byPageTitle.set(enemy.pageTitle, enemy);
  }

  const infoboxEnemies = [...byPageTitle.values()];
  const enriched: RawEnemy[] = [];
  for (let i = 0; i < infoboxEnemies.length; i++) {
    const enemy = infoboxEnemies[i];
    console.log(
      `Fetching stats/rewards for "${enemy.pageTitle}" (${i + 1}/${infoboxEnemies.length})...`,
    );
    enriched.push(await enrichWithHtml(enemy));
    await new Promise((r) => setTimeout(r, 500));
  }
  return enriched;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): RawEnemy[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: RawEnemy[]) {
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

// Boss (Normal/Weekly) : schéma riche avec title/location/phases détaillées/
// récompenses par palier.
function buildBossOutput(enemy: RawEnemy, enemyType: string) {
  return {
    name: enemy.name,
    enemyType,
    title: enemy.title,
    family: enemy.family,
    group: enemy.group,
    location: {
      region: enemy.region,
      area: enemy.area,
      subArea: enemy.subArea,
      domain: enemy.domain,
    },
    phases: enemy.phases.map((phase, idx) => ({
      phase: idx + 1,
      name: phase.name,
      damageTypes: phase.damageTypes,
      hasWeakPoint: phase.hasWeakPoint,
      abilities: phase.abilities,
      stats: {
        levels: phase.stats.levels,
        resistance: phase.stats.resistance,
      },
    })),
    bossRewards: {
      poolRewards: enemy.poolRewards,
      basicRewards: enemy.basicRewards,
    },
    releaseVersion: enemy.releaseVersion,
  };
}

// Common/Elite Enemy : schéma allégé — pas de title/location/dmgtype (jamais
// renseignés sur ces pages) ni de récompenses par palier (pas de World/Domain
// Level pour un ennemi normal, seulement une Drops Table générique). Une
// seule "phase" existe toujours pour ces ennemis (un seul bloc infobox), donc
// pas de tableau `phases` : ses stats/abilities sont remontées directement.
function buildCommonEnemyOutput(enemy: RawEnemy, enemyType: string) {
  const [phase] = enemy.phases;
  return {
    name: enemy.name,
    enemyType,
    family: enemy.family,
    group: enemy.group,
    hasWeakPoint: phase?.hasWeakPoint ?? false,
    abilities: phase?.abilities ?? [],
    stats: {
      levels: phase?.stats.levels ?? {},
      resistance: phase?.stats.resistance ?? {},
    },
    drops: enemy.poolRewards,
    releaseVersion: enemy.releaseVersion,
  };
}

function writeEnemyFiles(enemies: RawEnemy[], versionFilter?: string[]) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const filtered = versionFilter?.length
    ? enemies.filter((e) => versionFilter.includes(e.releaseVersion))
    : enemies;

  let written = 0;
  for (const enemy of filtered) {
    const filename = `${slugify(enemy.name)}.json`;
    const enemyType = enemyTypeLabel(enemy.type);
    const output = isBossType(enemy.type)
      ? buildBossOutput(enemy, enemyType)
      : buildCommonEnemyOutput(enemy, enemyType);

    fs.writeFileSync(
      path.join(OUTPUT_DIR, filename),
      JSON.stringify(output, null, 2),
      'utf-8',
    );
    written++;
  }

  console.log(`✅ Wrote ${written} enemy files to ${OUTPUT_DIR}`);
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

  let enemies: RawEnemy[];

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
    enemies = await fetchAll();
    saveCache(enemies);
  }

  writeEnemyFiles(enemies, versionFilter.length ? versionFilter : undefined);
}

main();
