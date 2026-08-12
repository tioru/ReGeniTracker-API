// scripts/scrape-books-gamedata.ts
//
// Vérifie/complète prisma/data/books/fr/*.json avec le texte OFFICIEL du jeu
// (données minées, dépôt DimbreathBot/AnimeGameData — même source déjà
// utilisée par scrape-creatures-gamedata.ts et scrape-food-gamedata.ts), pour
// corriger les résidus de texte EN laissés par scrape-books.ts.
//
// ── Pourquoi ce script existe ────────────────────────────────────────────
//
// scrape-books.ts (cf. son commentaire ligne 322) reprend délibérément le
// texte EN quand la page wiki FR n'a ni champ "description" ni champ
// "source"/"tomeN" dans son infobox — sans ce repli, ~2/3 des livres FR se
// retrouvaient sans description ni source du tout. Conséquence : au moins
// 17 des 118 fichiers fr/*.json contiennent encore du texte anglais brut
// dans `description`, `source` ou `volumes[].location` (constaté le
// 2026-08-12, ex: along_with_divinity_prologue.json — source =
// "Grand Master's Office" au lieu de "bureau du Grand Maître").
//
// ── `description` : source officielle trouvée (Material) ───────────────
//
// Chaque livre "BOOK" (volume unique) est aussi un objet d'inventaire côté
// jeu : une entrée MaterialExcelConfigData.json (itemType=ITEM_MATERIAL,
// materialType=MATERIAL_QUEST dans les cas vérifiés) porte son nameTextMapHash
// ET son descTextMapHash — cette description EST le texte affiché dans
// l'infobulle d'inventaire, identique au champ `description` du wiki quand
// il est correctement traduit (vérifié sur along_with_divinity_prologue :
// le texte FR miné via ce hash correspond mot pour mot au `description`
// déjà bon de ce fichier). Résolution par NOM (comme scrape-food-gamedata.ts
// pour les plats) : le nom EN du livre est cherché tel quel dans le TextMap
// EN. Le jeu fait AUTORITÉ sur ce champ — même politique que
// scrape-creatures-gamedata.ts / scrape-food-gamedata.ts : `--apply` écrase
// `description` dès que le texte miné est résolu et diverge du wiki
// (trou comblé OU contenu différent), catégorie BOOK_COLLECTION exclue
// (son `description` est toujours `null`, cf. scrape-books.ts).
//
// ── `source` / `volumes[].location` : PAS de champ Material dédié ───────
//
// Contrairement à `description`, il n'existe aucun champ structuré du jeu
// pour la provenance/emplacement d'un livre (vérifié : specialDescTextMapHash
// de l'entrée Material d'along_with_divinity_prologue est vide, ce n'est pas
// ça). Le seul recours est de chercher le texte EN laissé tel quel comme
// chaîne EXACTE ailleurs dans TextMap_MediumEN.json (ex: "Vaulting the Wall
// of Morning Mist" est le titre exact d'un lieu/quête, retrouvé tel quel à
// un hash dont le TextMap FR donne "Par-delà le mur de la brume matinale").
// Ça ne fonctionne QUE quand le texte laissé est lui-même un terme officiel
// du jeu (nom de lieu, de quête...) — la plupart des `source` sont en
// réalité de la prose éditoriale du wiki ("Found in ...", "On top of a rock
// next to...") qui n'existe nulle part telle quelle dans les données du jeu
// ("Grand Master's Office" par exemple n'apparaît QUE comme sous-chaîne
// d'une phrase de description de lieu, jamais comme entrée à part entière —
// vérifié par balayage complet du TextMap EN le 2026-08-12) : aucune
// traduction fiable n'en est extraite automatiquement, ces cas restent
// signalés `leftover_unresolved` pour reprise manuelle plutôt que de risquer
// une extraction de sous-chaîne fausse (l'ordre des mots diffère entre EN et
// FR, impossible d'isoler la portion correspondante dans la phrase FR).
//
// Politique volontairement PLUS PRUDENTE que pour `description` : faute de
// champ Material faisant autorité, on ne touche `source`/`volumes[].location`
// QUE quand la valeur FR est un résidu EN avéré (strictement identique à la
// valeur EN) — jamais quand le wiki a déjà produit une traduction FR
// différente, même approximative, qu'on n'a ici aucun moyen fiable de
// juger meilleure ou pire que le texte miné.
//
// ── Ce que ce script fait / ne fait PAS ──────────────────────────────────
//
// Par défaut (aucun flag) : mode RAPPORT SEUL. Écrit
// scripts/cache/books-gamedata-report.json listant, pour chaque livre FR,
// le statut de `description`, `source` et (pour les collections) de chaque
// `volumes[N].location`.
//
// `--apply` : écrase `description` avec le texte officiel dès qu'il diverge
// (trou comblé ou contenu différent) ; écrase `source`/`volumes[].location`
// UNIQUEMENT quand la valeur est un résidu EN identique au champ EN ET que
// le texte officiel est résolu via TextMap. Ne touche jamais `name`,
// `author`, `publisher`, `illustrator`, `region`, `rarity`, `category` :
// hors du scope vérifiable par cette source.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/scrape-books-gamedata.ts
//   npx ts-node -r tsconfig-paths/register scripts/scrape-books-gamedata.ts --apply

import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GAMEDATA_ROOT_URL = 'https://raw.githubusercontent.com/DimbreathBot/AnimeGameData/master';
const GAMEDATA_CACHE_DIR = path.resolve(__dirname, './cache/gamedata');
const BOOKS_ROOT_DIR = path.resolve(__dirname, '../prisma/data/books');
const REPORT_PATH = path.resolve(__dirname, './cache/books-gamedata-report.json');

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const LANGUAGE_TEXTMAP: Record<string, string> = {
  en: 'TextMap_MediumEN.json',
  fr: 'TextMap_MediumFR.json',
};

interface MaterialEntry {
  id: number;
  itemType: string;
  nameTextMapHash: number;
  descTextMapHash: number;
}

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

// "#Un mélange...{M#entraîné}{F#entraînée}...10{NON_BREAK_SPACE}%" ->
// "Un mélange...entraîné...10 %" — identique à scrape-food-gamedata.ts /
// scrape-creatures-gamedata.ts.
function cleanGameText(text: string | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^#/, '')
    .replace(/\{M#([^{}]*)\}\{F#([^{}]*)\}/g, '$1')
    .replace(/\{F#([^{}]*)\}\{M#([^{}]*)\}/g, '$2')
    .replace(/\{M#([^{}]*)\}/g, '$1')
    .replace(/\{F#[^{}]*\}/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\{NON_BREAK_SPACE\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

// Un seul livre peut en théorie partager son nom avec une autre entrée
// Material (rare, jamais observé sur les 118 livres) : on garde la première
// rencontrée, comme buildNameIndex de scrape-food-gamedata.ts.
function buildMaterialNameIndex(materials: MaterialEntry[], textMap: Record<string, string>): Map<string, MaterialEntry> {
  const index = new Map<string, MaterialEntry>();
  for (const m of materials) {
    if (m.itemType !== 'ITEM_MATERIAL') continue;
    const name = textMap[String(m.nameTextMapHash)];
    if (name && !index.has(name)) index.set(name, m);
  }
  return index;
}

// text -> hash, pour retrouver un résidu EN laissé tel quel dans `source`/
// `volumes[].location` quand il correspond à un terme officiel du jeu (nom
// de lieu, de quête...) présent ailleurs dans le TextMap.
function buildReverseIndex(textMap: Record<string, string>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [hash, text] of Object.entries(textMap)) {
    if (text && !index.has(text)) index.set(text, hash);
  }
  return index;
}

// Résout un résidu EN vers son texte FR officiel via correspondance EXACTE
// uniquement — jamais de sous-chaîne (l'ordre des mots diffère entre EN et
// FR, aucun moyen fiable d'isoler la portion correspondante dans la phrase
// FR). `source` peut être un ensemble de provenances jointes par "; "
// (cf. parseSourcesEn de scrape-books.ts) : chaque partie est résolue
// séparément, et la valeur n'est retournée QUE si TOUTES les parties sont
// résolues — pas de traduction partielle mêlant EN et FR dans un seul champ.
function resolveLeftoverViaTextMap(
  enValue: string,
  reverseIndexEn: Map<string, string>,
  textMapFr: Record<string, string>,
): string | null {
  const direct = reverseIndexEn.get(enValue);
  if (direct) return cleanGameText(textMapFr[direct]);

  const parts = enValue.split('; ');
  if (parts.length < 2) return null;

  const resolvedParts: string[] = [];
  for (const part of parts) {
    const hash = reverseIndexEn.get(part);
    if (!hash) return null;
    const resolved = cleanGameText(textMapFr[hash]);
    if (!resolved) return null;
    resolvedParts.push(resolved);
  }
  return resolvedParts.join('; ');
}

type DescriptionStatus = 'match' | 'differs' | 'filled_gap' | 'no_material' | 'no_game_text' | 'not_applicable';
type LeftoverStatus = 'already_translated' | 'leftover_resolved' | 'leftover_unresolved' | 'both_empty';

interface FieldReport {
  field: string; // 'description' | 'source' | 'volumes[N].location'
  en: string | null;
  frBefore: string | null;
  frAfter: string | null;
  status: DescriptionStatus | LeftoverStatus;
}

interface BookReport {
  fileName: string;
  bookName: string;
  fields: FieldReport[];
}

interface GameDataSources {
  textMaps: Record<string, Record<string, string>>;
  materialNameIndex: Map<string, MaterialEntry>;
  reverseIndexEn: Map<string, string>;
}

async function loadGameDataSources(): Promise<GameDataSources> {
  const materials = await downloadJsonWithCache<MaterialEntry[]>('ExcelBinOutput/MaterialExcelConfigData.json');

  const textMaps: Record<string, Record<string, string>> = {};
  for (const [lang, fileName] of Object.entries(LANGUAGE_TEXTMAP)) {
    textMaps[lang] = await downloadJsonWithCache<Record<string, string>>(`TextMap/${fileName}`);
  }

  const materialNameIndex = buildMaterialNameIndex(materials, textMaps.en);
  const reverseIndexEn = buildReverseIndex(textMaps.en);
  console.log(`✅ Index construit (${materialNameIndex.size} objets nommés côté Material, ${reverseIndexEn.size} chaînes EN indexées).`);

  return { textMaps, materialNameIndex, reverseIndexEn };
}

function checkDescription(
  enValue: string | null,
  frValue: string | null,
  bookName: string,
  sources: GameDataSources,
): FieldReport {
  if (enValue === null) {
    return { field: 'description', en: null, frBefore: frValue, frAfter: frValue, status: 'not_applicable' };
  }

  const material = sources.materialNameIndex.get(bookName);
  if (!material) {
    return { field: 'description', en: enValue, frBefore: frValue, frAfter: frValue, status: 'no_material' };
  }

  const gameDesc = cleanGameText(sources.textMaps.fr[String(material.descTextMapHash)]);
  if (gameDesc === null) {
    return { field: 'description', en: enValue, frBefore: frValue, frAfter: frValue, status: 'no_game_text' };
  }

  if (frValue === gameDesc) {
    return { field: 'description', en: enValue, frBefore: frValue, frAfter: gameDesc, status: 'match' };
  }

  const status: DescriptionStatus = frValue === null ? 'filled_gap' : 'differs';
  return { field: 'description', en: enValue, frBefore: frValue, frAfter: gameDesc, status };
}

function checkLeftoverField(field: string, enValue: string | null, frValue: string | null, sources: GameDataSources): FieldReport {
  if (enValue === null && frValue === null) {
    return { field, en: null, frBefore: null, frAfter: null, status: 'both_empty' };
  }
  if (frValue !== enValue) {
    return { field, en: enValue, frBefore: frValue, frAfter: frValue, status: 'already_translated' };
  }

  const resolved = enValue ? resolveLeftoverViaTextMap(enValue, sources.reverseIndexEn, sources.textMaps.fr) : null;
  if (resolved) {
    return { field, en: enValue, frBefore: frValue, frAfter: resolved, status: 'leftover_resolved' };
  }
  return { field, en: enValue, frBefore: frValue, frAfter: frValue, status: 'leftover_unresolved' };
}

function processBook(fileName: string, enDir: string, frDir: string, sources: GameDataSources, apply: boolean): BookReport | null {
  const enPath = path.join(enDir, fileName);
  const frPath = path.join(frDir, fileName);
  if (!fs.existsSync(frPath)) return null; // pas de fichier FR généré pour ce livre, hors scope.

  const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  const frData = JSON.parse(fs.readFileSync(frPath, 'utf-8'));

  const fields: FieldReport[] = [];
  let modified = false;

  const descField = checkDescription(enData.description, frData.description, enData.name, sources);
  fields.push(descField);
  if (apply && (descField.status === 'filled_gap' || descField.status === 'differs')) {
    frData.description = descField.frAfter;
    modified = true;
  }

  const sourceField = checkLeftoverField('source', enData.source, frData.source, sources);
  fields.push(sourceField);
  if (apply && sourceField.status === 'leftover_resolved') {
    frData.source = sourceField.frAfter;
    modified = true;
  }

  const enVolumes: { number: number; location: string }[] = enData.volumes ?? [];
  const frVolumes: { number: number; location: string }[] = frData.volumes ?? [];
  for (let i = 0; i < enVolumes.length; i++) {
    const frVolume = frVolumes[i];
    if (!frVolume) continue;
    const volField = checkLeftoverField(`volumes[${i}].location`, enVolumes[i].location, frVolume.location, sources);
    fields.push(volField);
    if (apply && volField.status === 'leftover_resolved') {
      frVolume.location = volField.frAfter as string;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(frPath, JSON.stringify(frData, null, 2) + '\n', 'utf-8');
  }

  return { fileName, bookName: enData.name, fields };
}

function printSummary(reports: BookReport[], apply: boolean): void {
  const allFields = reports.flatMap((r) => r.fields);
  const descFixes = allFields.filter((f) => f.field === 'description' && (f.status === 'filled_gap' || f.status === 'differs')).length;
  const leftoverResolved = allFields.filter((f) => f.status === 'leftover_resolved').length;
  const leftoverUnresolved = allFields.filter((f) => f.status === 'leftover_unresolved').length;
  const applySuffix = apply
    ? ` — ${descFixes} description(s) et ${leftoverResolved} champ(s) résidu(s) EN corrigés avec le texte officiel.`
    : ` (relancer avec --apply pour corriger ${descFixes} description(s) et ${leftoverResolved} champ(s) résidu(s) EN).`;

  console.log(`\n✅ Rapport écrit vers ${REPORT_PATH}`);
  console.log(`   ${reports.length} livre(s) analysé(s)${applySuffix}`);
  console.log(`   ${leftoverUnresolved} résidu(s) EN NON résolus dans les données minées (prose éditoriale du wiki, pas un terme officiel du jeu) : reprise manuelle nécessaire.`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sources = await loadGameDataSources();

  const enDir = path.join(BOOKS_ROOT_DIR, 'en');
  const frDir = path.join(BOOKS_ROOT_DIR, 'fr');
  const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json'));

  const reports: BookReport[] = [];
  for (const fileName of enFiles) {
    const report = processBook(fileName, enDir, frDir, sources, apply);
    if (report) reports.push(report);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(reports, null, 2) + '\n', 'utf-8');

  printSummary(reports, apply);
}

main();
