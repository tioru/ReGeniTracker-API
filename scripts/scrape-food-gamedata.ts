// scripts/scrape-food-gamedata.ts
//
// Complète/vérifie prisma/data/foods/{en,fr}/*.json avec le texte OFFICIEL du
// jeu (données minées, dépôt DimbreathBot/AnimeGameData — même source déjà
// utilisée par scrape-weapons.ts pour les stats niveau par niveau), au lieu
// du wiki communautaire. Contrairement au wiki, chaque TextMap de langue
// contient forcément une chaîne pour chaque palier de qualité qui existe
// réellement dans le jeu — pas de trou de traduction possible.
//
// ── Comment un plat est retrouvé dans les données minées ────────────────────
//
// Chaque palier de qualité (Normal/Délicieux/Suspect) d'un plat est un objet
// À PART ENTIÈRE dans MaterialExcelConfigData.json (itemType=ITEM_MATERIAL,
// foodQuality=FOOD_QUALITY_ORDINARY/DELICIOUS/STRANGE/NONE), PAS 3 champs
// d'une même entrée. Leur nom affiché (résolu via TextMap) suit une
// convention textuelle simple, vérifiée sur plusieurs dizaines de plats :
//   - Normal / qualité fixe : le nom du plat tel quel (ex: "Almond Tofu").
//   - Délicieux             : "Delicious " + nom (ex: "Delicious Almond Tofu").
//   - Suspect                : "Suspicious " + nom (ex: "Suspicious Almond Tofu").
// PIÈGE vérifié : les ids ne sont PAS regroupés par plat de façon prévisible
// (ex: pour "Nine-Fruit Nectar", le palier Suspect est id 108832 et le palier
// Normal id 108833, mais l'id juste en dessous, 108831, est un plat
// TOTALEMENT différent — "Delicious Meat-Lover's Feast"). Seule la résolution
// par NOM (via la convention ci-dessus) est fiable, jamais par proximité d'id.
//
// ── Nettoyage du texte miné ──────────────────────────────────────────────
//
// Le texte brut des TextMap contient des marqueurs absents du wiki :
//   - `\n` littéral (2 caractères, backslash+n — pas un vrai retour à la
//     ligne) : marqueur de saut de paragraphe interne au jeu (ex: sur "Dango
//     Milk", entre la partie descriptive et la mise en garde "drink too
//     much..."), l'équivalent du `<br />` wiki (déjà remplacé par un espace
//     dans cleanWikitext) — même traitement ici.
//   - `{NON_BREAK_SPACE}` : espace insécable littéral (ex: "10{NON_BREAK_SPACE}%").
//   - `{M#mot}{F#mot}` : variante genrée (masculin/féminin) — on retient
//     toujours le masculin, faute de connaître le genre du joueur ciblé (même
//     limitation que le wiki avec son `{{MF|m=|f=}}`, qu'il affiche par
//     défaut au masculin lui aussi). Existe aussi en forme SOLO — `{F#e}`
//     seul, sans `{M#...}` associé (ex: "Surpris{F#e}" = masculin "Surpris"
//     nu, féminin "Surprise" avec suffixe) — géré séparément après la paire,
//     masculin = suffixe vide.
//   - un `#` en tout début de chaîne sur certaines lignes FR (pas EN) : un
//     marqueur de build interne à mihoyo (texte contenant du markup), pas du
//     texte à afficher — simplement retiré.
//
// ── Ce que ce script fait / ne fait PAS ──────────────────────────────────
//
// Par défaut (aucun flag) : mode RAPPORT SEUL, aucun fichier JSON modifié.
// Écrit scripts/cache/food-gamedata-report.json listant, pour chaque plat et
// chaque langue : les paliers non résolus dans les données minées, et pour
// chaque champ résolu son statut (`match`, `filled_gap`, `differs`,
// `game_duplicate_skipped` — cf. hasRealEffectVariance).
//
// `--apply` : le jeu fait AUTORITÉ (décision explicite du 2026-08-10, après
// avoir constaté que le wiki élague volontairement certaines tournures —
// phrase "In Co-Op Mode...", virgules de milliers, préfixe "X's specialty."
// — sans que ce soit des erreurs). Écrase donc `descriptions.*` et
// `effectTexts.*` avec le texte officiel nettoyé dès qu'il est résolu
// (`filled_gap` ET `differs`), quelle que soit la raison de la divergence.
// Seule exception : `game_duplicate_skipped` (paliers delicious/suspicious
// sans vrai bonus distinct sur les plats à qualité fixe) reste intouché —
// ce n'est pas un choix de style, écrire `null` y est correct.
//
// NOTE (2026-08-10) : le premier plat vérifié avec cette source (Nine-Fruit
// Nectar) a révélé que sa description "normal" FR sur le wiki contient en
// réalité le texte du palier "délicieux" (`description = ` du wikitext
// recopie mot pour mot le texte officiel du palier Délicieux, pas celui du
// palier Normal) — et que "délicieux" duplique ce même texte (par
// coïncidence à peu près correct pour CE palier, mais avec un mot manquant
// dû à un vieux bug de `cleanWikitext` qui supprime `{{MF|m=|f=}}` au lieu
// de garder la forme masculine). Un vrai bug de contenu wiki, détecté
// seulement parce qu'une source indépendante (le jeu) existe pour comparer.
//
// `--create-missing-fr` : certains plats (récompenses de quête/évènement,
// ex. "Lantern Rite Special Come and Get It") n'ont AUCUNE page wiki FR —
// scrape-food.ts n'a donc jamais généré de fichier prisma/data/foods/fr/
// pour eux (contrairement à Creatures/Enemies/Books, pas de repli
// {{Other Languages}}, cf. onglet « Nourriture »). Mais le jeu, lui, n'a pas
// cette limite : si le plat existe en jeu, sa traduction FR existe aussi.
// Ce mode crée le fichier FR manquant à partir du texte officiel (nom,
// descriptions, effets) plus une traduction du vendeur et du plat de base
// via un index inversé texte→hash construit sur le TextMap EN (le même hash
// numérique désigne la même ligne dans toutes les langues). Se limite
// volontairement aux plats à la structure simple des cas rencontrés
// (ingredients/sources vides, character nul) — un plat avec des champs non
// couverts par cette traduction est signalé et ignoré plutôt que de générer
// un fichier partiellement faux.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/scrape-food-gamedata.ts
//   npx ts-node -r tsconfig-paths/register scripts/scrape-food-gamedata.ts --apply
//   npx ts-node -r tsconfig-paths/register scripts/scrape-food-gamedata.ts --create-missing-fr

import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GAMEDATA_ROOT_URL = 'https://raw.githubusercontent.com/DimbreathBot/AnimeGameData/master';
const GAMEDATA_CACHE_DIR = path.resolve(__dirname, './cache/gamedata');
const FOODS_ROOT_DIR = path.resolve(__dirname, '../prisma/data/foods');
const REPORT_PATH = path.resolve(__dirname, './cache/food-gamedata-report.json');

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Une entrée par dossier de langue déjà présent sous prisma/data/foods/ — pas
// besoin de toucher ce fichier pour ajouter une langue, juste ce mapping.
const LANGUAGE_TEXTMAP: Record<string, string> = {
  en: 'TextMap_MediumEN.json',
  fr: 'TextMap_MediumFR.json',
};

interface MaterialEntry {
  id: number;
  itemType: string;
  foodQuality: string;
  nameTextMapHash: number;
  descTextMapHash: number;
  effectDescTextMapHash: number;
}

type Tier = 'normal' | 'delicious' | 'suspicious';
const TIERS: Tier[] = ['normal', 'delicious', 'suspicious'];

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
// "Un mélange...entraîné...10 %"
function cleanGameText(text: string | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^#/, '')
    .replace(/\{M#([^{}]*)\}\{F#([^{}]*)\}/g, '$1')
    .replace(/\{F#([^{}]*)\}\{M#([^{}]*)\}/g, '$2')
    // Formes solo (pas de {M#...}/{F#...} en vis-à-vis) : masculin = ce qui
    // est dans {M#...}, féminin seul = suffixe retiré (masculin nu).
    .replace(/\{M#([^{}]*)\}/g, '$1')
    .replace(/\{F#[^{}]*\}/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\{NON_BREAK_SPACE\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function buildNameIndex(materials: MaterialEntry[], textMap: Record<string, string>): Map<string, MaterialEntry> {
  const index = new Map<string, MaterialEntry>();
  for (const m of materials) {
    if (m.itemType !== 'ITEM_MATERIAL') continue;
    const name = textMap[String(m.nameTextMapHash)];
    // En cas de collision de nom entre deux objets ITEM_MATERIAL distincts
    // (rare), on garde la première rencontrée — pas de moyen fiable de
    // départager sans info supplémentaire, et aucune collision observée sur
    // les 452 plats testés.
    if (name && !index.has(name)) index.set(name, m);
  }
  return index;
}

function resolveTierEntries(baseName: string, nameIndex: Map<string, MaterialEntry>): Record<Tier, MaterialEntry | null> {
  return {
    normal: nameIndex.get(baseName) ?? null,
    delicious: nameIndex.get(`Delicious ${baseName}`) ?? null,
    suspicious: nameIndex.get(`Suspicious ${baseName}`) ?? null,
  };
}

interface FieldReport {
  tier: Tier;
  field: 'description' | 'effectText';
  wiki: string | null;
  game: string | null;
  status: 'match' | 'differs' | 'filled_gap' | 'wiki_only' | 'game_only' | 'both_empty' | 'game_duplicate_skipped';
}

interface FoodReport {
  pageTitle: string;
  language: string;
  unresolvedTiers: Tier[];
  fields: FieldReport[];
}

function compareField(wiki: string | null, game: string | null): FieldReport['status'] {
  if (wiki === null && game === null) return 'both_empty';
  if (wiki === null && game !== null) return 'filled_gap';
  if (wiki !== null && game === null) return 'wiki_only';
  return wiki === game ? 'match' : 'differs';
}

// Sur les plats à qualité fixe (ex: "Harvest's Boon"), le jeu crée quand même
// 3 objets Material distincts (Normal/Délicieux/Suspect) mais leur
// `effectDescTextMapHash` est LE MÊME texte générique non informatif
// ("A little surprise from ...") faute de vrai bonus différent par palier —
// c'est d'ailleurs pour ça que resolveEffectTexts (scrape-food.ts) laisse ces
// paliers à `null` côté wiki : rien de mécaniquement distinct à documenter.
// Sans ce garde-fou, --apply recréerait ici le bug "paliers fantômes côté
// FR" déjà corrigé le 2026-08-04 (cf. NOTE food.prisma / journal de sessions)
// — recopier 3x le même texte creux plutôt que garder `null`.
function hasRealEffectVariance(gameEffectByTier: Record<Tier, string | null>): boolean {
  const values = TIERS.map((t) => gameEffectByTier[t]).filter((v): v is string => v !== null);
  return new Set(values).size > 1;
}

interface GameDataSources {
  textMaps: Record<string, Record<string, string>>;
  nameIndexes: Record<string, Map<string, MaterialEntry>>;
}

async function loadGameDataSources(): Promise<GameDataSources> {
  const materials = await downloadJsonWithCache<MaterialEntry[]>('ExcelBinOutput/MaterialExcelConfigData.json');
  const textMaps: Record<string, Record<string, string>> = {};
  const nameIndexes: Record<string, Map<string, MaterialEntry>> = {};

  for (const [lang, fileName] of Object.entries(LANGUAGE_TEXTMAP)) {
    textMaps[lang] = await downloadJsonWithCache<Record<string, string>>(`TextMap/${fileName}`);
    nameIndexes[lang] = buildNameIndex(materials, textMaps[lang]);
    console.log(`✅ Index construit pour "${lang}" (${nameIndexes[lang].size} objets nommés).`);
  }

  return { textMaps, nameIndexes };
}

// Jugée sur le texte EN (langue toujours chargée) : la duplication "3
// paliers, même texte creux" est une propriété du plat côté jeu, pas de la
// langue — inutile de la recalculer par langue.
function computeEffectVarianceIsReal(enTiers: Record<Tier, MaterialEntry | null>, textMapEn: Record<string, string>): boolean {
  const gameEffectByTierEn = Object.fromEntries(
    TIERS.map((tier) => [tier, enTiers[tier] ? cleanGameText(textMapEn[String(enTiers[tier].effectDescTextMapHash)]) : null]),
  ) as Record<Tier, string | null>;
  return hasRealEffectVariance(gameEffectByTierEn);
}

function buildFieldReports(
  entry: MaterialEntry,
  tier: Tier,
  textMap: Record<string, string>,
  langData: any,
  effectVarianceIsReal: boolean,
): { descField: FieldReport; effectField: FieldReport } {
  const gameDesc = cleanGameText(textMap[String(entry.descTextMapHash)]);
  const gameEffect = cleanGameText(textMap[String(entry.effectDescTextMapHash)]);

  const wikiDesc: string | null = langData.descriptions?.[tier] ?? null;
  const wikiEffect: string | null = langData.effectTexts?.[tier] ?? null;

  const descStatus = compareField(wikiDesc, gameDesc);
  // Un palier "normal" a toujours un vrai effet par définition (c'est la
  // référence) ; delicious/suspicious ne sont un vrai trou que si le plat a
  // un effet différent par palier — sinon `null` est la valeur correcte (cf.
  // hasRealEffectVariance).
  const effectStatus =
    tier !== 'normal' && !effectVarianceIsReal && wikiEffect === null
      ? 'game_duplicate_skipped'
      : compareField(wikiEffect, gameEffect);

  return {
    descField: { tier, field: 'description', wiki: wikiDesc, game: gameDesc, status: descStatus },
    effectField: { tier, field: 'effectText', wiki: wikiEffect, game: gameEffect, status: effectStatus },
  };
}

// Écrase par le texte officiel du jeu tout champ résolu où il diverge du
// wiki (trou comblé OU contenu différent) — décision explicite (2026-08-10) :
// le jeu est la source de vérité, quitte à réintroduire des tournures que le
// wiki élaguait par choix éditorial (phrase Co-Op, virgules de milliers,
// préfixe "X's specialty."). Seul `game_duplicate_skipped` reste intouché :
// ce n'est pas une question de style mais d'existence réelle de l'info (cf.
// hasRealEffectVariance).
function applyAuthoritative(langData: any, fields: FieldReport[]): boolean {
  let modified = false;
  for (const field of fields) {
    if (field.game === null) continue;
    if (field.status !== 'filled_gap' && field.status !== 'differs') continue;
    const bucket = field.field === 'description' ? langData.descriptions : langData.effectTexts;
    bucket[field.tier] = field.game;
    modified = true;
  }
  return modified;
}

function processFoodLanguage(
  fileName: string,
  lang: string,
  enTiers: Record<Tier, MaterialEntry | null>,
  effectVarianceIsReal: boolean,
  sources: GameDataSources,
  apply: boolean,
): FieldReport[] | null {
  const langPath = path.join(FOODS_ROOT_DIR, lang, fileName);
  if (!fs.existsSync(langPath)) return null;

  const langData = JSON.parse(fs.readFileSync(langPath, 'utf-8'));
  const fields: FieldReport[] = [];

  for (const tier of TIERS) {
    const entry = enTiers[tier];
    if (!entry) continue;
    const { descField, effectField } = buildFieldReports(entry, tier, sources.textMaps[lang], langData, effectVarianceIsReal);
    fields.push(descField, effectField);
  }

  if (apply && applyAuthoritative(langData, fields)) {
    fs.writeFileSync(langPath, JSON.stringify(langData, null, 2) + '\n', 'utf-8');
    return fields;
  }

  return fields;
}

// text -> hash, pour retrouver la traduction FR d'un champ libre (nom de
// vendeur, nom d'ingrédient) qui partage sa ligne de texte avec un NPC/objet
// déjà présent ailleurs dans le TextMap — pas seulement les noms de plats
// couverts par buildNameIndex (qui, lui, ne garde que itemType=ITEM_MATERIAL).
function buildReverseIndex(textMap: Record<string, string>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [hash, text] of Object.entries(textMap)) {
    if (text && !index.has(text)) index.set(text, hash);
  }
  return index;
}

function translateViaSharedHash(text: string, enReverseIndex: Map<string, string>, textMapFr: Record<string, string>): string | null {
  const hash = enReverseIndex.get(text);
  if (!hash) return null;
  return cleanGameText(textMapFr[hash]);
}

// FR name du plat de base (ex: "Come and Get It" -> "Ramen Alézi") lu depuis
// son propre fichier FR déjà scrapé — pas depuis le jeu : baseDish est une
// relation vers un AUTRE plat, dont le nom affiché suit les conventions du
// wiki (accents, titres localisés), pas celles du jeu.
function resolveBaseDishFrName(enBaseDish: string): string | null {
  const frPath = path.join(FOODS_ROOT_DIR, 'fr', `${slugify(enBaseDish)}.json`);
  if (!fs.existsSync(frPath)) return null;
  const data = JSON.parse(fs.readFileSync(frPath, 'utf-8'));
  return data.name ?? null;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`, 'g'), '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Ne crée le fichier que pour la structure simple effectivement rencontrée
// (ingredients/sources vides, pas de character/recipeHint) : au-delà, une
// traduction automatique risquerait de produire un fichier faux plutôt
// qu'absent — signalé et laissé de côté pour une reprise manuelle.
function canAutoTranslate(enData: any): string | null {
  if (enData.ingredients?.length > 0) return 'ingredients non vides';
  if (enData.sources?.length > 0) return 'sources non vides';
  if (enData.character) return 'character renseigné';
  if (enData.recipeHint) return 'recipeHint renseigné';
  if (enData.specialDish) return 'specialDish renseigné';
  return null;
}

function buildMissingFrData(
  enData: any,
  enTiers: Record<Tier, MaterialEntry | null>,
  sources: GameDataSources,
  enReverseIndex: Map<string, string>,
): any {
  const textMapFr = sources.textMaps.fr;
  const normalEntry = enTiers.normal as MaterialEntry;

  const descriptions: Record<Tier, string | null> = { normal: '', delicious: null, suspicious: null };
  const effectTexts: Record<Tier, string | null> = { normal: '', delicious: null, suspicious: null };
  for (const tier of TIERS) {
    const entry = enTiers[tier];
    if (!entry || enData.descriptions[tier] === null) continue;
    descriptions[tier] = cleanGameText(textMapFr[String(entry.descTextMapHash)]);
  }
  for (const tier of TIERS) {
    const entry = enTiers[tier];
    if (!entry || enData.effectTexts[tier] === null) continue;
    effectTexts[tier] = cleanGameText(textMapFr[String(entry.effectDescTextMapHash)]);
  }

  const sellers = (enData.sellers ?? []).map((seller: any) => ({
    ...seller,
    name: translateViaSharedHash(seller.name, enReverseIndex, textMapFr) ?? seller.name,
  }));

  return {
    ...enData,
    name: cleanGameText(textMapFr[String(normalEntry.nameTextMapHash)]) ?? enData.name,
    descriptions,
    effectTexts,
    sellers,
    baseDish: enData.baseDish ? (resolveBaseDishFrName(enData.baseDish) ?? enData.baseDish) : null,
  };
}

function createMissingFrFiles(enDir: string, sources: GameDataSources): { created: number; skipped: string[] } {
  const frDir = path.join(FOODS_ROOT_DIR, 'fr');
  const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json'));
  const enReverseIndex = buildReverseIndex(sources.textMaps.en);

  let created = 0;
  const skipped: string[] = [];

  for (const fileName of enFiles) {
    const frPath = path.join(frDir, fileName);
    if (fs.existsSync(frPath)) continue;

    const enPath = path.join(enDir, fileName);
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
    if (!enData.pageTitle) continue;

    const enTiers = resolveTierEntries(enData.pageTitle, sources.nameIndexes.en);
    if (!enTiers.normal) continue; // pas résolu côté jeu non plus, rien à faire ici

    const blocker = canAutoTranslate(enData);
    if (blocker) {
      skipped.push(`${fileName} (${blocker})`);
      continue;
    }

    const frData = buildMissingFrData(enData, enTiers, sources, enReverseIndex);
    fs.writeFileSync(frPath, JSON.stringify(frData, null, 2) + '\n', 'utf-8');
    created++;
    console.log(`✅ Créé : prisma/data/foods/fr/${fileName}`);
  }

  return { created, skipped };
}

function processFood(fileName: string, enDir: string, sources: GameDataSources, apply: boolean): FoodReport[] | null {
  const enData = JSON.parse(fs.readFileSync(path.join(enDir, fileName), 'utf-8'));
  const baseName: string | undefined = enData.pageTitle;
  if (!baseName) return null;

  // Résolu une seule fois via le nom EN (clé technique dans les données
  // minées comme dans nos JSON) : les ids retrouvés sont réutilisés pour
  // toutes les langues, seul le TextMap consulté change.
  const enTiers = resolveTierEntries(baseName, sources.nameIndexes.en);
  if (!enTiers.normal) {
    // Cas attendu pour les variantes de quête/évènement dont le nom de page
    // inclut un suffixe absent du jeu (ex: "Apple Cider (Mika: Deliver By
    // Hand)") — pas une erreur, juste rien à comparer.
    return null;
  }

  const unresolvedTiers = TIERS.filter((tier) => !enTiers[tier]);
  const effectVarianceIsReal = computeEffectVarianceIsReal(enTiers, sources.textMaps.en);

  const reports: FoodReport[] = [];
  for (const lang of Object.keys(LANGUAGE_TEXTMAP)) {
    const fields = processFoodLanguage(fileName, lang, enTiers, effectVarianceIsReal, sources, apply);
    if (fields) reports.push({ pageTitle: baseName, language: lang, unresolvedTiers, fields });
  }
  return reports;
}

function printSummary(reports: FoodReport[], unresolvedCount: number, apply: boolean): void {
  const allFields = reports.flatMap((r) => r.fields);
  const gaps = allFields.filter((f) => f.status === 'filled_gap').length;
  const differing = allFields.filter((f) => f.status === 'differs').length;
  const skipped = allFields.filter((f) => f.status === 'game_duplicate_skipped').length;
  const overwritable = gaps + differing;
  const applySuffix = apply ? ' — fichiers mis à jour avec le texte officiel du jeu.' : ' (relancer avec --apply pour écraser avec le texte officiel).';

  console.log(`\n✅ Rapport écrit vers ${REPORT_PATH}`);
  console.log(`   ${unresolvedCount} plat(s) non résolu(s) dans les données minées (variantes quête/évènement, attendu).`);
  console.log(`   ${gaps} trou(s) comblé(s) + ${differing} champ(s) divergent(s) = ${overwritable} champ(s) au total${applySuffix}`);
  console.log(`   ${skipped} champ(s) laissé(s) intact (paliers sans vrai effet distinct, cf. hasRealEffectVariance).`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const createMissingFr = process.argv.includes('--create-missing-fr');
  const sources = await loadGameDataSources();

  const enDir = path.join(FOODS_ROOT_DIR, 'en');

  if (createMissingFr) {
    const { created, skipped } = createMissingFrFiles(enDir, sources);
    console.log(`\n✅ ${created} fichier(s) FR créé(s) depuis le texte officiel du jeu.`);
    if (skipped.length > 0) {
      console.log(`   ${skipped.length} plat(s) résolu(s) côté jeu mais ignoré(s) (structure non couverte) :`);
      for (const s of skipped) console.log(`   - ${s}`);
    }
    return;
  }

  const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json'));

  const reports: FoodReport[] = [];
  let unresolvedCount = 0;

  for (const fileName of enFiles) {
    const foodReports = processFood(fileName, enDir, sources, apply);
    if (foodReports) reports.push(...foodReports);
    else unresolvedCount++;
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(reports, null, 2) + '\n', 'utf-8');

  printSummary(reports, unresolvedCount, apply);
}

main();
