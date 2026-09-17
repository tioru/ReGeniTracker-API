import { fetchCategoryMembers, fetchWikitext } from "../lib/wiki-fetch";
import { PlayableCharacterInformation } from "./models/playableCharacterInformation";
import { mapWeaponType } from "./mapper/weaponTypeMapper";
import { mapElementType } from "./mapper/elementTypeMapper";
import { CharacterInformation } from "./models/characterInformation";
import { Unrevealed } from "./models/unrevealed";
import { mapRegionType } from "./mapper/regionTypeMapper";

const PLAYABLE_CHARACTERS_CATEGORY = "Playable Characters"
const SECTION_REGEX = /<!--([\s\S]*?)-->/g;
const BIRTHDAY_REGEX = /^(\w+)\s+(\d+(?:st|nd|rd|th))$/;
const BIRTHDAY_FALLBACK_YEAR = 2000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PLAYABLE_CHARACTER_INFORMATION_KEY = "Playable Character Information"
const CHARACTER_INFORMATION_KEY = "Character Information"
const UNREVEALED_KEY = "Unrevealed"

export function getCharactersName(): Promise<string[]> {
  return fetchCategoryMembers(PLAYABLE_CHARACTERS_CATEGORY);
}

export async function scrapeCharacter(characterName: string): Promise<string | null> {
  return await fetchWikitext(characterName);
}

function splitWikitextSections(wikitext: string): Record<string, string> { // To simplify
  const sections: Record<string, string> = {};
  const matches = [...wikitext.matchAll(SECTION_REGEX)];
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = matches[i + 1]?.index ?? wikitext.length;
    sections[title] = wikitext.slice(start, end).trim();
  }
  return sections;
}

function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w' -]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
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
  const birthdayMatch = birthday.match(BIRTHDAY_REGEX);
  const month = birthdayMatch?.[1];
  const day = birthdayMatch?.[2]?.slice(0, 2);
  if (!month || !day) throw new Error(`Unparseable birthday: ${birthday}`);

  const monthIndex = MONTH_NAMES.indexOf(month);
  if (monthIndex === -1) throw new Error(`Unknown month: ${month}`);

  return new Date(BIRTHDAY_FALLBACK_YEAR, monthIndex, Number(day));
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
    obtain: rawUnrevealed["obtain"],
    releaseDate: new Date(rawUnrevealed["releaseDate"]),
  };
}

//scrapCharacters()
scrapeCharacter("Amber").then((response) => {
  if (!response) throw new Error();
  const characterSplitedSection = splitWikitextSections(response);
  //console.log(characterSplitedSection)

  const rawPlayableCharacterInformation = parseInfoboxFields(characterSplitedSection[PLAYABLE_CHARACTER_INFORMATION_KEY]);
  const playableCharacterInformation = parsePlayableCharacterInformation(rawPlayableCharacterInformation);
  //console.log(playableCharacterInformation)

  const rawCharacterInformation = parseInfoboxFields(characterSplitedSection[CHARACTER_INFORMATION_KEY]);
  const characterInformation = parseCharacterInformation(rawCharacterInformation);
  //console.log(characterInformation)

  const rawUnrevealed = parseInfoboxFields(characterSplitedSection[UNREVEALED_KEY]);
  const unrevealed = parseUnrevealed(rawUnrevealed);
  console.log(rawUnrevealed);
  console.log(unrevealed);
})

