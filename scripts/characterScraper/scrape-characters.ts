import * as fs from "node:fs";
import * as path from "node:path";
import { downloadFile, fetchCategoryMembers, fetchFileUrls, fetchWikitext } from "../lib/wiki-fetch";
import { PlayableCharacterInformation } from "./models/playableCharacterInformation";
import { mapWeaponType } from "./mapper/weaponTypeMapper";
import { mapElementType } from "./mapper/elementTypeMapper";
import { CharacterInformation } from "./models/characterInformation";
import { Unrevealed } from "./models/unrevealed";
import { mapRegionType } from "./mapper/regionTypeMapper";
import { Titles } from "./models/titles";
import { VoiceActors } from "./models/voiceActors";
import { Family } from "./models/family";
import { AscensionStats } from "./models/ascensionStats";
import { convertLua } from "../lib/tools";
import { VoiceLanguage, VoiceLine } from "./models/voiceLine";
import { GeneralDataCharacter } from "./models/generalDataCharacter";
import { LevelStats } from "./models/levelStats";

const KEYS = {
  PLAYABLE_CHARACTER_INFORMATION: "Playable Character Information",
  CHARACTER_INFORMATION: "Character Information",
  UNREVEALED: "Unrevealed",
  TITLES: "Titles",
  VOICE_ACTORS: "Voice Actors",
};

const PAGES = {
  PLAYABLE_CHARACTERS: "Playable Characters",
  ASCENSION_STATS_DATA: "Module:Character Ascensions and Stats/data",
  VOICE_OVERS_SUFFIX: "/Voice-Overs",
};

const REGEXS = {
  SECTION : /<!--([\s\S]*?)-->/g,
  INFOBOX_FIELD : /^\|\s*([\w' -]+?)\s*=\s*(.*)$/,
  BIRTHDAY : /^(\w+)\s+(\d+(?:st|nd|rd|th))$/,
  OBTAIN_ITEM_BULLET : /^\*\s*/,
  WIKILINK_BRACKETS : /\[\[|\]\]/g,
  OTHER_LANGUAGES : /\{\{Other Languages\n([\s\S]*?)\n\}\}/,
  REF_TAG_SELF_CLOSING : /<ref[^>]*\/>/gi,
  REF_TAG_BLOCK : /<ref[^>]*>[\s\S]*?<\/ref>/gi,
  // "{{w|Manaka Iwami|Iwami Manaka}}" -> "Iwami Manaka"
  VA_TEMPLATE_LINK : /^\{\{w\|[^|]*\|(?<name>[\s\S]+)\}\}$/,
  // "[[imdb:nm5726463|Kelly Baskin]]" -> "Kelly Baskin"
  VA_WIKILINK : /^\[\[[^|]*\|(?<name>[^\]]+)\]\]$/,
  // "[https://... Cai Shujin]" -> "Cai Shujin"
  VA_EXTERNAL_LINK : /^\[https?:\/\/\S+\s+(?<name>[^\]]+)\]$/,
  // Strips a trailing native-script parenthetical: "Iwami Manaka (石見舞菜香)" -> "Iwami Manaka"
  VA_TRAILING_NATIVE_NAME : /\s*\([\s\S]*\)\s*$/,
  STORY_VO_BLOCK : /\{\{VO\/Story\n([\s\S]*?)\n\}\}/,
  // "vo_02_01_title" -> id "02_01", field "title"
  VOICE_LINE_FIELD : /^vo_(\d+_\d+)_(title|file|tx)$/,
  // "[[Favonius Cathedral|Cathedral]]" -> "Cathedral", "[[Vision]]" -> "Vision"
  WIKILINK : /\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g,
  BR_TAG : /<br\s*\/?>/gi,
  HTML_TAG : /<[^>]+>/g,
  SLUG_INVALID_CHARS : /[^a-z0-9]+/g,
  SLUG_EDGE_UNDERSCORES : /^_+|_+$/g,
}


const BIRTHDAY_FALLBACK_YEAR = 2000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ASSETS_DIR = path.resolve(__dirname, "../../assets");

// Prefix inserted in place of "{language}" in voice-over file names (see Module:VO on the wiki).
const VOICE_LANGUAGE_PREFIXES: Record<VoiceLanguage, string> = {
  EN: "",
  CN: "ZH_",
  JP: "JA_",
  KR: "KO_",
};

const HTML_ENTITIES: Record<string, string> = {
  "&mdash;": "—",
  "&ndash;": "–",
  "&nbsp;": " ",
  "&amp;": "&",
};

export function getCharactersName(): Promise<string[]> {
  return fetchCategoryMembers(PAGES.PLAYABLE_CHARACTERS);
}

export async function fetchCharacter(characterName: string): Promise<string | null> {
  return await fetchWikitext(characterName);
}

function splitWikitextSections(wikitext: string): Record<string, string> {
  const matches = [...wikitext.matchAll(REGEXS.SECTION)];
  return Object.fromEntries(matches.map((match, i) => {
    const start = match.index + match[0].length;
    const end = matches[i + 1]?.index ?? wikitext.length;
    return [match[1].trim(), wikitext.slice(start, end).trim()];
  }));
}

function extractOtherLanguages(wikitext: string): string {
  return REGEXS.OTHER_LANGUAGES.exec(wikitext)?.[1] ?? '';
}

function parseInfoboxFields(block: string): Record<string, string> {
  const allLines = block.split('\n');
  const closingIndex = allLines.findIndex(line => line.trim() === '}}');
  const lines = closingIndex === -1 ? allLines : allLines.slice(0, closingIndex);

  const { fields } = lines.reduce(
    (acc, line) => {
      const match = REGEXS.INFOBOX_FIELD.exec(line);
      if (match) {
        acc.currentKey = match[1].trim();
        acc.fields[acc.currentKey] = match[2].trim();
      } else if (acc.currentKey && line.trim()) {
        const previous = acc.fields[acc.currentKey];
        acc.fields[acc.currentKey] = previous ? `${previous}\n${line.trim()}` : line.trim();
      }
      return acc;
    },
    { fields: {} as Record<string, string>, currentKey: null as string | null },
  );
  return fields;
}

export async function scrapCharacters(): Promise<void> {
  const charactersNames: string[] = await getCharactersName();

  for (const name of charactersNames) {
    const wikitext = await fetchCharacter(name);
    if (wikitext) console.log(splitWikitextSections(wikitext));
  }
}

export function parsePlayableCharacterInformation(rawPlayableCharacterInformation : Record<string, string>) : PlayableCharacterInformation {
  return {
    quality: Number(rawPlayableCharacterInformation["quality"]),
    weapon: mapWeaponType(rawPlayableCharacterInformation["weapon"]),
    element: mapElementType(rawPlayableCharacterInformation["element"]),
    name: rawPlayableCharacterInformation["name"],
  };
}

export function parseCharacterInformation(rawCharacterInformation : Record<string, string>) : CharacterInformation {
  return {
    realName: rawCharacterInformation["realname"],
  };
}

export function parseBirthday(birthday : string) : Date {
  const birthdayMatch = REGEXS.BIRTHDAY.exec(birthday);
  const month = birthdayMatch?.[1];
  const day = birthdayMatch?.[2]?.slice(0, 2);
  if (!month || !day) throw new Error(`Unparseable birthday: ${birthday}`);

  const monthIndex = MONTH_NAMES.indexOf(month);
  if (monthIndex === -1) throw new Error(`Unknown month: ${month}`);

  return new Date(BIRTHDAY_FALLBACK_YEAR, monthIndex, Number(day));
}

export function parseObtain(rawObtain: string): string[] {
  return rawObtain
    .split('\n')
    .map(line => line.replace(REGEXS.OBTAIN_ITEM_BULLET, '').replace(REGEXS.WIKILINK_BRACKETS, '').trim())
    .filter(Boolean);
}

export function parseUnrevealed(rawUnrevealed : Record<string, string>) : Unrevealed {
  return {
    birthday: parseBirthday(rawUnrevealed["birthday"]),
    constellation: rawUnrevealed["constellation"],
    region: mapRegionType(rawUnrevealed["region"]),
    affiliation: rawUnrevealed["affiliation"],
    dish: rawUnrevealed["dish"],
    namecard: rawUnrevealed["namecard"],
    obtainType: rawUnrevealed["obtainType"],
    obtain: parseObtain(rawUnrevealed["obtain"]),
    releaseDate: new Date(rawUnrevealed["releaseDate"]),
  };
}

export function parseTitles(rawTitles : Record<string, string>) : Titles {
  return {
    title: rawTitles["title"],
    title2: rawTitles["title2"],
  };
}

export function parseVoiceActors(rawVoiceActors : Record<string, string>) : VoiceActors {
  return {
    voiceCN: extractVoiceActorName(rawVoiceActors["voiceCN"]) ?? "",
    voiceJP: extractVoiceActorName(rawVoiceActors["voiceJP"]) ?? "",
    voiceEN: extractVoiceActorName(rawVoiceActors["voiceEN"]) ?? "",
    voiceKR: extractVoiceActorName(rawVoiceActors["voiceKR"]) ?? "",
  }
}

export function parseFamily(rawFamily : Record<string, string>) : Family {
  return {
    en: rawFamily["en"],
    zhs: rawFamily["zhs"],
    zhs_rm: rawFamily["zhs_rm"],
    zht: rawFamily["zht"],
    zht_rm: rawFamily["zht_rm"],
    ja: rawFamily["ja"],
    ja_rm: rawFamily["ja_rm"],
    ko: rawFamily["ko"],
    es: rawFamily["es"],
    fr: rawFamily["fr"],
    ru: rawFamily["ru"],
    th: rawFamily["th"],
    vi: rawFamily["vi"],
    de: rawFamily["de"],
    id: rawFamily["id"],
    pt: rawFamily["pt"],
    tr: rawFamily["tr"],
    it: rawFamily["it"],
  };
}

function extractVoiceActorName(raw: string | undefined): string | null {
  if (!raw) return null;

  const cleaned = raw
    .replace(REGEXS.REF_TAG_SELF_CLOSING, "")
    .replace(REGEXS.REF_TAG_BLOCK, "")
    .trim();

  const display =
    cleaned.match(REGEXS.VA_TEMPLATE_LINK)?.groups?.name ??
    cleaned.match(REGEXS.VA_WIKILINK)?.groups?.name ??
    cleaned.match(REGEXS.VA_EXTERNAL_LINK)?.groups?.name ??
    cleaned;

  return display.replace(REGEXS.VA_TRAILING_NATIVE_NAME, "").trim();
}

export async function fetchAscensionStats(): Promise<string | null> {
  return await fetchWikitext(PAGES.ASCENSION_STATS_DATA);
}

function parseAscensionStats(fields: Record<string, number | string | string[]>): AscensionStats {
  return fields as unknown as AscensionStats;
}

const ANIME_GAME_DATA_BASE = "https://raw.githubusercontent.com/DimbreathBot/AnimeGameData/main/ExcelBinOutput";
// Obfuscated field name holding the actual multiplier value in AvatarCurveExcelConfigData.json.
const CURVE_VALUE_KEY = "GGKIEIJLCJJ";

interface AvatarGrowCurve {
  growCurve: string;
  type: string; // e.g. FIGHT_PROP_BASE_HP, FIGHT_PROP_BASE_ATTACK, FIGHT_PROP_BASE_DEFENSE
}

interface AvatarExcelEntry {
  hpBase: number;
  attackBase: number;
  defenseBase: number;
  propGrowCurves: AvatarGrowCurve[];
}

interface CurveInfo {
  type: string;
  arith: string;
  [CURVE_VALUE_KEY]: number;
}

interface CurveLevelEntry {
  level: number;
  curveInfos: CurveInfo[];
}

function findAvatarEntry(avatars: AvatarExcelEntry[], stats: AscensionStats): AvatarExcelEntry {
  const match = avatars.find(a =>
    Math.abs(a.hpBase - stats.base_hp) < 0.01 &&
    Math.abs(a.attackBase - stats.base_atk) < 0.01 &&
    Math.abs(a.defenseBase - stats.base_def) < 0.01,
  );
  if (!match) throw new Error("No matching AnimeGameData avatar entry found for these base stats");
  return match;
}

function computeLevelStats(avatar: AvatarExcelEntry, curveTable: CurveLevelEntry[]): LevelStats[] {
  const curveNameByProp: Record<string, string> = {};
  for (const c of avatar.propGrowCurves) curveNameByProp[c.type] = c.growCurve;

  const baseByProp: Record<string, number> = {
    FIGHT_PROP_BASE_HP: avatar.hpBase,
    FIGHT_PROP_BASE_ATTACK: avatar.attackBase,
    FIGHT_PROP_BASE_DEFENSE: avatar.defenseBase,
  };

  const multiplierFor = (curveInfos: CurveInfo[], prop: string): number => {
    const curveName = curveNameByProp[prop];
    const info = curveInfos.find(c => c.type === curveName);
    return info ? info[CURVE_VALUE_KEY] : 1;
  };

  return curveTable.map(({ level, curveInfos }) => ({
    level,
    hp: baseByProp.FIGHT_PROP_BASE_HP * multiplierFor(curveInfos, 'FIGHT_PROP_BASE_HP'),
    atk: baseByProp.FIGHT_PROP_BASE_ATTACK * multiplierFor(curveInfos, 'FIGHT_PROP_BASE_ATTACK'),
    def: baseByProp.FIGHT_PROP_BASE_DEFENSE * multiplierFor(curveInfos, 'FIGHT_PROP_BASE_DEFENSE'),
  }));
}

export async function fetchCharacterLevelStats(stats: AscensionStats): Promise<LevelStats[]> {
  const [avatars, curveTable] = await Promise.all([
    fetchJson<AvatarExcelEntry[]>(`${ANIME_GAME_DATA_BASE}/AvatarExcelConfigData.json`),
    fetchJson<CurveLevelEntry[]>(`${ANIME_GAME_DATA_BASE}/AvatarCurveExcelConfigData.json`),
  ]);
  const avatar = findAvatarEntry(avatars, stats);
  return computeLevelStats(avatar, curveTable);
}

interface RawVoiceLine {
  title: string;
  file: string; // still contains the "{language}" placeholder
  tx?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(REGEXS.SLUG_INVALID_CHARS, "_")
    .replace(REGEXS.SLUG_EDGE_UNDERSCORES, "");
}

function cleanWikitext(raw: string): string {
  const withoutMarkup = raw
    .replace(REGEXS.WIKILINK, "$1")
    .replace(REGEXS.BR_TAG, "\n")
    .replace(REGEXS.HTML_TAG, "");
  return Object.entries(HTML_ENTITIES)
    .reduce((text, [entity, char]) => text.replaceAll(entity, char), withoutMarkup)
    .trim();
}

export function parseStoryVoiceLines(wikitext: string, characterName: string): RawVoiceLine[] {
  const block = REGEXS.STORY_VO_BLOCK.exec(wikitext)?.[1];
  if (!block) return [];

  // Comments ("<!-- Chats -->") must go first, otherwise they get appended to the previous field.
  const fields = parseInfoboxFields(block.replace(REGEXS.SECTION, ""));
  const character = fields["character"] || characterName;
  const name = fields["name"] || character;
  const fullname = fields["fullname"] || name;
  const replacePlaceholders = (value: string) => value
    .replaceAll("{character}", character)
    .replaceAll("{name}", name)
    .replaceAll("{fullname}", fullname);

  const voiceLinesById = new Map<string, Partial<RawVoiceLine>>();
  for (const [key, value] of Object.entries(fields)) {
    const match = REGEXS.VOICE_LINE_FIELD.exec(key);
    if (!match) continue;
    const id = match[1];
    const field = match[2] as keyof RawVoiceLine;
    const voiceLine = voiceLinesById.get(id) ?? {};
    voiceLine[field] = replacePlaceholders(value);
    voiceLinesById.set(id, voiceLine);
  }

  return [...voiceLinesById.values()].filter((v): v is RawVoiceLine => Boolean(v.title && v.file));
}

function voiceLineFileName(rawVoiceLine: RawVoiceLine, language: VoiceLanguage): string {
  return rawVoiceLine.file.replaceAll("{language}", VOICE_LANGUAGE_PREFIXES[language]);
}

// Returns true when the file is available on disk (already there or freshly downloaded).
async function saveAsset(url: string, relativePath: string): Promise<boolean> {
  const destination = path.join(ASSETS_DIR, relativePath);
  if (fs.existsSync(destination)) return true;

  const buffer = await downloadFile(url, relativePath);
  if (!buffer) return false;

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  return true;
}

export async function fetchVoiceLines(characterName: string): Promise<VoiceLine[]> {
  const wikitext = await fetchWikitext(characterName + PAGES.VOICE_OVERS_SUFFIX);
  if (!wikitext) return [];

  const rawVoiceLines = parseStoryVoiceLines(wikitext, characterName);
  const languages = Object.keys(VOICE_LANGUAGE_PREFIXES) as VoiceLanguage[];
  const urls = await fetchFileUrls(rawVoiceLines.flatMap(raw => languages.map(language => voiceLineFileName(raw, language))));

  const characterSlug = slugify(characterName);
  const voiceLines: VoiceLine[] = [];
  for (const raw of rawVoiceLines) {
    const title = cleanWikitext(raw.title);
    const files: VoiceLine["files"] = {};

    for (const language of languages) {
      const fileName = voiceLineFileName(raw, language);
      const url = urls[fileName];
      if (!url) continue;

      // Relative to assets/ so it maps directly to the ServeStatic URL.
      const relativePath = path.posix.join("characters", characterSlug, "voicelines", language.toLowerCase(), slugify(title) + path.extname(fileName));
      if (await saveAsset(url, relativePath)) files[language] = relativePath;
    }

    voiceLines.push({
      title,
      transcription: raw.tx ? cleanWikitext(raw.tx) : undefined,
      files,
    });
  }
  return voiceLines;
}

//scrapCharacters()
(async () => {
  const charactersName = await getCharactersName();
  
  const rawCharacter = await fetchCharacter(charactersName[0]);
  if (!rawCharacter) throw new Error();

  const rawCharacterSplitedSection = splitWikitextSections(rawCharacter);

  const rawPlayableCharacterInformation = parseInfoboxFields(rawCharacterSplitedSection[KEYS.PLAYABLE_CHARACTER_INFORMATION]);
  const playableCharacterInformation = parsePlayableCharacterInformation(rawPlayableCharacterInformation);

  const rawCharacterInformation = parseInfoboxFields(rawCharacterSplitedSection[KEYS.CHARACTER_INFORMATION]);
  const characterInformation = parseCharacterInformation(rawCharacterInformation);

  const rawUnrevealed = parseInfoboxFields(rawCharacterSplitedSection[KEYS.UNREVEALED]);
  const unrevealed = parseUnrevealed(rawUnrevealed);

  const rawTitles = parseInfoboxFields(rawCharacterSplitedSection[KEYS.TITLES]);
  const titles = parseTitles(rawTitles);

  const rawVoiceActors = parseInfoboxFields(rawCharacterSplitedSection[KEYS.VOICE_ACTORS]);
  const voiceActors = parseVoiceActors(rawVoiceActors);

  const rawFamily = parseInfoboxFields(extractOtherLanguages(rawCharacter));
  const family = parseFamily(rawFamily);

  const rawAscensionStats = await fetchAscensionStats();
  if (!rawAscensionStats) throw new Error();

  const ascensionStatsTable = convertLua(rawAscensionStats);
  const ascensionStats = parseAscensionStats(ascensionStatsTable[charactersName[0]]);

  const levelStats = await fetchCharacterLevelStats(ascensionStats);
  console.log(levelStats.filter(s => [1, 20, 90].includes(s.level)));

  const voiceLines = await fetchVoiceLines(charactersName[0])

  const generalDataCharacter : GeneralDataCharacter = {
    playableCharacterInformation,
    unrevealed,
    titles,
    voiceActors,
    family,
    voiceLines
  };

  console.log(generalDataCharacter);
})();

function fetchJson<T>(arg0: string): any {
  throw new Error("Function not implemented.");
}

