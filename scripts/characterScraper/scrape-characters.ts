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

const PLAYABLE_CHARACTERS_CATEGORY = "Playable Characters"
const SECTION_REGEX = /<!--([\s\S]*?)-->/g;
const INFOBOX_FIELD_REGEX = /^\|\s*([\w' -]+?)\s*=\s*(.*)$/;
const BIRTHDAY_REGEX = /^(\w+)\s+(\d+(?:st|nd|rd|th))$/;
const OBTAIN_ITEM_BULLET_REGEX = /^\*\s*/;
const WIKILINK_BRACKETS_REGEX = /\[\[|\]\]/g;
const OTHER_LANGUAGES_REGEX = /\{\{Other Languages\n([\s\S]*?)\n\}\}/;
const BIRTHDAY_FALLBACK_YEAR = 2000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PLAYABLE_CHARACTER_INFORMATION_KEY = "Playable Character Information"
const CHARACTER_INFORMATION_KEY = "Character Information"
const UNREVEALED_KEY = "Unrevealed"
const TITLES_KEY = "Titles"
const VOICE_ACTORS_KEY = "Voice Actors"

export function getCharactersName(): Promise<string[]> {
  return fetchCategoryMembers(PLAYABLE_CHARACTERS_CATEGORY);
}

export async function scrapeCharacter(characterName: string): Promise<string | null> {
  return await fetchWikitext(characterName);
}

function splitWikitextSections(wikitext: string): Record<string, string> {
  const matches = [...wikitext.matchAll(SECTION_REGEX)];
  return Object.fromEntries(matches.map((match, i) => {
    const start = match.index! + match[0].length;
    const end = matches[i + 1]?.index ?? wikitext.length;
    return [match[1].trim(), wikitext.slice(start, end).trim()];
  }));
}

function extractOtherLanguages(wikitext: string): string {
  return OTHER_LANGUAGES_REGEX.exec(wikitext)?.[1] ?? '';
}

function parseInfoboxFields(block: string): Record<string, string> {
  const allLines = block.split('\n');
  const closingIndex = allLines.findIndex(line => line.trim() === '}}');
  const lines = closingIndex === -1 ? allLines : allLines.slice(0, closingIndex);

  const { fields } = lines.reduce(
    (acc, line) => {
      const match = INFOBOX_FIELD_REGEX.exec(line);
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
    const wikitext = await scrapeCharacter(name);
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
  const birthdayMatch = BIRTHDAY_REGEX.exec(birthday);
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
    .map(line => line.replace(OBTAIN_ITEM_BULLET_REGEX, '').replace(WIKILINK_BRACKETS_REGEX, '').trim())
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
    voiceCN: rawVoiceActors["voiceCN"],
    voiceJP: rawVoiceActors["voiceJP"],
    voiceEN: rawVoiceActors["voiceEN"],
    voiceKR: rawVoiceActors["voiceKR"],
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

//scrapCharacters()
scrapeCharacter("Amber").then((response) => {
  if (!response) throw new Error();
  const characterSplitedSection = splitWikitextSections(response);

  const rawPlayableCharacterInformation = parseInfoboxFields(characterSplitedSection[PLAYABLE_CHARACTER_INFORMATION_KEY]);
  const playableCharacterInformation = parsePlayableCharacterInformation(rawPlayableCharacterInformation);

  const rawCharacterInformation = parseInfoboxFields(characterSplitedSection[CHARACTER_INFORMATION_KEY]);
  const characterInformation = parseCharacterInformation(rawCharacterInformation);

  const rawUnrevealed = parseInfoboxFields(characterSplitedSection[UNREVEALED_KEY]);
  const unrevealed = parseUnrevealed(rawUnrevealed);

  const rawTitles = parseInfoboxFields(characterSplitedSection[TITLES_KEY]);
  const titles = parseTitles(rawTitles);

  const rawVoiceActors = parseInfoboxFields(characterSplitedSection[VOICE_ACTORS_KEY]);
  const voiceActors = parseVoiceActors(rawVoiceActors);

  const rawFamily = parseInfoboxFields(extractOtherLanguages(response));
  const family = parseFamily(rawFamily);

  const generalDataCharacter = {
    playableCharacterInformation,
    characterInformation,
    unrevealed,
    titles,
    voiceActors,
    family
  };

  console.log(generalDataCharacter);
})

