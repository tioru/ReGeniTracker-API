// scripts/scrape-creatures-gamedata.ts
//
// Vérifie prisma/data/creatures/{en,fr}/*.json contre le texte OFFICIEL du
// jeu (données minées, dépôt DimbreathBot/AnimeGameData — même source déjà
// utilisée par scrape-weapons.ts et scrape-food-gamedata.ts), au lieu du
// wiki communautaire. Mode RAPPORT SEUL par défaut, aucun fichier modifié.
//
// ── Comment une créature est retrouvée dans les données minées ──────────────
//
// AnimalDescribeExcelConfigData.json donne, par créature, une icône (sprite
// interne, ex: "UI_AnimalIcon_Alpaca_01") et un nameTextMapHash. Résolution
// PAR NOM (comme scrape-food-gamedata.ts pour les plats) : le nom EN scrapé
// du wiki est cherché tel quel dans le TextMap EN — pas de correspondance
// par id, les ids des deux fichiers ne se recoupent pas.
//
// AnimalCodexExcelConfigData.json (même id que AnimalDescribe, vérifié sur
// les 207 entrées de type CODEX_ANIMAL — les 246 autres entrées de
// AnimalDescribe sans codex associé sont des variantes de modèle non
// jouables/non pêchables, ignorées) donne le VRAI texte de description
// (descTextMapHash) et une catégorie de jeu (subType : CODEX_SUBTYPE_AVIARY /
// ANIMAL / FISH / CRITTER) — plus grossière que les champs `family`/`group`
// du wiki, remontée à titre INFORMATIF seulement (gameCategory), jamais
// comparée automatiquement à ces deux champs (cf. audit du 2026-08-10 :
// family/group sont une classification inventée par le wiki, sans
// équivalent texte dans le jeu — rien à valider dessus ici).
//
// 206/210 créatures résolues par nom (98%) lors de la vérification initiale
// — les 4 non résolues (Butterfly, Firefly, Moonglow Frostfin Whale, Puny
// Shroomboar) ont un nom de page wiki qui ne correspond à aucune entrée du
// TextMap sous ce libellé exact (probablement des noms génériques regroupant
// plusieurs sous-espèces côté jeu) : signalées en `unresolved`, pas une
// erreur de script.
//
// ── Nettoyage du texte miné ──────────────────────────────────────────────
// Même fonction que scrape-food-gamedata.ts (`\n` littéral,
// `{NON_BREAK_SPACE}`, formes genrées `{M#}{F#}`, `#` de build en tête de
// ligne FR) — cf. ce fichier pour le détail de chaque cas rencontré.
//
// ── Ce que ce script fait / ne fait PAS ──────────────────────────────────
// Par défaut (aucun flag) : mode RAPPORT SEUL. Écrit
// scripts/cache/creatures-gamedata-report.json listant, pour chaque
// créature et chaque langue, le statut du nom et de la description
// (`match`, `differs`, `filled_gap`, `wiki_only`, `game_only`,
// `both_empty`), plus la catégorie de jeu et l'icône officielle à titre
// informatif.
//
// `--apply` : écrase `description` avec le texte officiel du jeu quand il
// est résolu et diverge du wiki (`filled_gap` ET `differs`) — même
// politique que scrape-food-gamedata.ts (le jeu fait autorité sur le texte
// descriptif). Corrige aussi `name` mais UNIQUEMENT quand le nom wiki est
// un préfixe strict du nom officiel (troncature, cf. isSafeNameTruncation)
// — jamais quand le jeu est plus court que le wiki (le wiki peut avoir
// ajouté un qualificatif ou un suffixe "(animal)" de désambiguïsation
// volontaire contre un homonyme réel côté matériaux/plats, vérifié à la
// main sur les 6 noms divergents de l'audit du 2026-08-10 : seul
// forest_boar.json — "Sanglier" -> "Sanglier des forêts" — correspond).
// Ne touche jamais à `family`, `group`, `image`, `drops`, `location`,
// `releaseVersion`, `bait` : hors du scope vérifiable par cette source.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/scrape-creatures-gamedata.ts
//   npx ts-node -r tsconfig-paths/register scripts/scrape-creatures-gamedata.ts --apply

import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GAMEDATA_ROOT_URL = 'https://raw.githubusercontent.com/DimbreathBot/AnimeGameData/master';
const GAMEDATA_CACHE_DIR = path.resolve(__dirname, './cache/gamedata');
const CREATURES_ROOT_DIR = path.resolve(__dirname, '../prisma/data/creatures');
const REPORT_PATH = path.resolve(__dirname, './cache/creatures-gamedata-report.json');

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Une entrée par dossier de langue déjà présent sous prisma/data/creatures/.
const LANGUAGE_TEXTMAP: Record<string, string> = {
  en: 'TextMap_MediumEN.json',
  fr: 'TextMap_MediumFR.json',
};

interface AnimalDescribeEntry {
  id: number;
  icon: string;
  nameTextMapHash: number;
}

interface AnimalCodexEntry {
  id: number;
  type: string;
  subType: string;
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
// "Un mélange...entraîné...10 %" — identique à scrape-food-gamedata.ts.
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

// Ne garde que les entrées AnimalDescribe qui ont un pendant AnimalCodex de
// type CODEX_ANIMAL (207/453) : les 246 autres sont des variantes de modèle
// sans fiche jouable/pêchable, aucun intérêt pour la vérification wiki.
function buildNameIndex(
  describe: AnimalDescribeEntry[],
  codexById: Map<number, AnimalCodexEntry>,
  textMap: Record<string, string>,
): Map<string, { describe: AnimalDescribeEntry; codex: AnimalCodexEntry }> {
  const index = new Map<string, { describe: AnimalDescribeEntry; codex: AnimalCodexEntry }>();
  for (const d of describe) {
    const codex = codexById.get(d.id);
    if (!codex || codex.type !== 'CODEX_ANIMAL') continue;
    const name = textMap[String(d.nameTextMapHash)];
    // Collision de nom entre deux entrées distinctes (rare) : on garde la
    // première rencontrée, comme buildNameIndex de scrape-food-gamedata.ts.
    if (name && !index.has(name)) index.set(name, { describe: d, codex });
  }
  return index;
}

interface FieldReport {
  field: 'name' | 'description';
  wiki: string | null;
  game: string | null;
  status: 'match' | 'differs' | 'filled_gap' | 'wiki_only' | 'game_only' | 'both_empty';
}

interface CreatureReport {
  fileName: string;
  language: string;
  gameCategory: string; // subType brut du jeu — informatif, jamais comparé à family/group.
  gameIcon: string;
  fields: FieldReport[];
}

function compareField(wiki: string | null, game: string | null): FieldReport['status'] {
  if (wiki === null && game === null) return 'both_empty';
  if (wiki === null && game !== null) return 'filled_gap';
  if (wiki !== null && game === null) return 'wiki_only';
  return wiki === game ? 'match' : 'differs';
}

// Un nom wiki n'est corrigé QUE s'il est un préfixe strict du nom officiel
// du jeu (le jeu ajoute un qualificatif que le wiki a coupé, ex. "Sanglier"
// -> "Sanglier des forêts") — jamais dans l'autre sens (le wiki ajoute
// quelque chose que le jeu n'a pas, ex. "Grenouille verte" -> "Grenouille"),
// qui peut être un choix éditorial délibéré, et jamais quand le wiki AJOUTE
// un suffixe de désambiguïsation type "(animal)" que le jeu, lui, n'a pas
// besoin de porter (le jeu n'a pas de collision de nom entre ses propres
// tables). Règle validée à la main sur les 6 cas de l'audit du 2026-08-10 :
// ne sélectionne que forest_boar.json, écarte les 5 autres.
function isSafeNameTruncation(wiki: string | null, game: string | null): boolean {
  if (wiki === null || game === null || wiki === game) return false;
  return game.length > wiki.length && game.startsWith(wiki);
}

interface GameDataSources {
  textMaps: Record<string, Record<string, string>>;
  nameIndexes: Record<string, Map<string, { describe: AnimalDescribeEntry; codex: AnimalCodexEntry }>>;
}

async function loadGameDataSources(): Promise<GameDataSources> {
  const describe = await downloadJsonWithCache<AnimalDescribeEntry[]>('ExcelBinOutput/AnimalDescribeExcelConfigData.json');
  const codex = await downloadJsonWithCache<AnimalCodexEntry[]>('ExcelBinOutput/AnimalCodexExcelConfigData.json');
  const codexById = new Map(codex.map((c) => [c.id, c]));

  const textMaps: Record<string, Record<string, string>> = {};
  const nameIndexes: GameDataSources['nameIndexes'] = {};

  for (const [lang, fileName] of Object.entries(LANGUAGE_TEXTMAP)) {
    textMaps[lang] = await downloadJsonWithCache<Record<string, string>>(`TextMap/${fileName}`);
    nameIndexes[lang] = buildNameIndex(describe, codexById, textMaps[lang]);
    console.log(`✅ Index construit pour "${lang}" (${nameIndexes[lang].size} créatures nommées).`);
  }

  return { textMaps, nameIndexes };
}

// Résolu une seule fois via le nom EN (clé technique dans les données
// minées comme dans nos JSON) : l'entrée trouvée est réutilisée pour
// toutes les langues, seul le TextMap consulté change — même logique que
// resolveTierEntries de scrape-food-gamedata.ts.
function processCreatureLanguage(
  fileName: string,
  lang: string,
  match: { describe: AnimalDescribeEntry; codex: AnimalCodexEntry },
  sources: GameDataSources,
  apply: boolean,
): CreatureReport | null {
  const langPath = path.join(CREATURES_ROOT_DIR, lang, fileName);
  if (!fs.existsSync(langPath)) return null;

  const langData = JSON.parse(fs.readFileSync(langPath, 'utf-8'));
  const textMap = sources.textMaps[lang];

  const gameName = cleanGameText(textMap[String(match.describe.nameTextMapHash)]);
  const gameDesc = cleanGameText(textMap[String(match.codex.descTextMapHash)]);

  const wikiName: string | null = langData.name ?? null;
  const wikiDesc: string | null = langData.description ?? null;

  const nameField: FieldReport = { field: 'name', wiki: wikiName, game: gameName, status: compareField(wikiName, gameName) };
  const descField: FieldReport = { field: 'description', wiki: wikiDesc, game: gameDesc, status: compareField(wikiDesc, gameDesc) };

  let modified = false;

  if (apply && gameDesc !== null && (descField.status === 'filled_gap' || descField.status === 'differs')) {
    langData.description = gameDesc;
    modified = true;
  }

  // Sur les 6 noms divergents relevés à l'audit du 2026-08-10, seul
  // isSafeNameTruncation() décrit un vrai trou (nom wiki tronqué, ex.
  // "Sanglier" -> "Sanglier des forêts") : les 4 autres ajoutent
  // "(animal)" pour désambiguïser un homonyme réel avec un matériau/plat
  // du même nom (vérifié à la main), et 1 (frog.json, "Grenouille verte"
  // vs "Grenouille") est un ajout wiki qui peut être un choix éditorial —
  // ni l'un ni l'autre n'est une troncature, donc jamais écrasé ici.
  if (apply && isSafeNameTruncation(wikiName, gameName)) {
    langData.name = gameName;
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(langPath, JSON.stringify(langData, null, 2) + '\n', 'utf-8');
  }

  return {
    fileName,
    language: lang,
    gameCategory: match.codex.subType,
    gameIcon: match.describe.icon,
    fields: [nameField, descField],
  };
}

function processCreature(fileName: string, enDir: string, sources: GameDataSources, apply: boolean): { reports: CreatureReport[]; unresolved: boolean } {
  const enData = JSON.parse(fs.readFileSync(path.join(enDir, fileName), 'utf-8'));
  const wikiName: string | undefined = enData.name;
  if (!wikiName) return { reports: [], unresolved: true };

  const match = sources.nameIndexes.en.get(wikiName);
  if (!match) return { reports: [], unresolved: true };

  const reports: CreatureReport[] = [];
  for (const lang of Object.keys(LANGUAGE_TEXTMAP)) {
    const report = processCreatureLanguage(fileName, lang, match, sources, apply);
    if (report) reports.push(report);
  }
  return { reports, unresolved: false };
}

function printSummary(reports: CreatureReport[], unresolvedNames: string[], apply: boolean): void {
  const allFields = reports.flatMap((r) => r.fields);
  const gaps = allFields.filter((f) => f.status === 'filled_gap').length;
  const differing = allFields.filter((f) => f.status === 'differs').length;
  const matching = allFields.filter((f) => f.status === 'match').length;
  const nameFixes = reports.flatMap((r) => r.fields.filter((f) => f.field === 'name')).filter((f) => isSafeNameTruncation(f.wiki, f.game)).length;
  const applySuffix = apply
    ? ` — descriptions divergentes écrasées avec le texte officiel, ${nameFixes} nom(s) tronqué(s) corrigé(s).`
    : ` (relancer avec --apply pour écraser les descriptions divergentes et ${nameFixes} nom(s) tronqué(s)).`;

  console.log(`\n✅ Rapport écrit vers ${REPORT_PATH}`);
  console.log(`   ${unresolvedNames.length} créature(s) non résolue(s) dans les données minées : ${unresolvedNames.join(', ') || '(aucune)'}`);
  console.log(`   ${matching} champ(s) conforme(s) au jeu, ${gaps} trou(s) comblé(s), ${differing} champ(s) divergent(s)${applySuffix}`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sources = await loadGameDataSources();

  const enDir = path.join(CREATURES_ROOT_DIR, 'en');
  const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json'));

  const reports: CreatureReport[] = [];
  const unresolvedNames: string[] = [];

  for (const fileName of enFiles) {
    const { reports: creatureReports, unresolved } = processCreature(fileName, enDir, sources, apply);
    if (unresolved) {
      const enData = JSON.parse(fs.readFileSync(path.join(enDir, fileName), 'utf-8'));
      unresolvedNames.push(enData.name ?? fileName);
    } else {
      reports.push(...creatureReports);
    }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ unresolvedNames, reports }, null, 2) + '\n', 'utf-8');

  printSummary(reports, unresolvedNames, apply);
}

main();
