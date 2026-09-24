import { fetchCategoryMembers, fetchWikitext } from "../lib/wiki-fetch";
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

const KEYS = {
  PLAYABLE_CHARACTER_INFORMATION: "Playable Character Information",
  CHARACTER_INFORMATION: "Character Information",
  UNREVEALED: "Unrevealed",
  TITLES: "Titles",
  VOICE_ACTORS: "Voice Actors",
};

const PAGES = {
  PLAYABLE_CHARACTERS: "Playable Characters",
  ASCENSION_STATS_DATA: "Module:Character Ascensions and Stats/data"
};

const REGEXS = {
  SECTION : /<!--([\s\S]*?)-->/g,
  INFOBOX_FIELD : /^\|\s*([\w' -]+?)\s*=\s*(.*)$/,
  BIRTHDAY : /^(\w+)\s+(\d+(?:st|nd|rd|th))$/,
  OBTAIN_ITEM_BULLET : /^\*\s*/,
  WIKILINK_BRACKETS : /\[\[|\]\]/g,
  OTHER_LANGUAGES : /\{\{Other Languages\n([\s\S]*?)\n\}\}/,
}


const BIRTHDAY_FALLBACK_YEAR = 2000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SELECTED_CHARACTER = "Amber"

export function getCharactersName(): Promise<string[]> {
  return fetchCategoryMembers(PAGES.PLAYABLE_CHARACTERS);
}

export async function fetchCharacter(characterName: string): Promise<string | null> {
  return await fetchWikitext(characterName);
}

function splitWikitextSections(wikitext: string): Record<string, string> {
  //console.log("WIKITEXT", wikitext)
  const matches = [...wikitext.matchAll(REGEXS.SECTION)];
  //console.log("MATCHES", matches)
  //console.log("MATCHES LENGTH", matches.length)
  console.log("MATCHES", matches[1])
  return Object.fromEntries(matches.map((match, i) => {
    const start = match.index! + match[0].length;
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
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .trim();

  let display: string;
  let m: RegExpMatchArray | null;

  if ((m = cleaned.match(/^\{\{w\|[^|]*\|([\s\S]+)\}\}$/))) {
    display = m[1];
  } else if ((m = cleaned.match(/^\[\[[^|]*\|([^\]]+)\]\]$/))) {
    display = m[1];
  } else if ((m = cleaned.match(/^\[https?:\/\/\S+\s+([^\]]+)\]$/))) {
    display = m[1];
  } else {
    display = cleaned;
  }

  return display.replace(/\s*\([\s\S]*\)\s*$/, "").trim();
}

export async function fetchAscensionStats(): Promise<string | null> {
  return await fetchWikitext(PAGES.ASCENSION_STATS_DATA);
}

function parseAscensionStats(fields: Record<string, number | string | string[]>): AscensionStats {
  return fields as unknown as AscensionStats;
}

//scrapCharacters()
(async () => {
  const rawCharacter = await fetchCharacter(SELECTED_CHARACTER);
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
  const ascensionStats = parseAscensionStats(ascensionStatsTable[SELECTED_CHARACTER]);

  //console.log(ascensionStats);

  const generalDataCharacter = {
    playableCharacterInformation,
    characterInformation,
    unrevealed,
    titles,
    voiceActors,
    family
  };

  //console.log(generalDataCharacter);
})();

