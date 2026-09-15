import { fetchCategoryMembers, fetchWikitext } from "../lib/wiki-fetch";
import { characterInformation } from "./models/characterInformation";

const PLAYABLE_CHARACTERS_CATEGORY = "Playable Characters"
const SECTION_REGEX = /<!--([\s\S]*?)-->/g;
const CHARACTER_INFORMATION_KEY = "Playable Character Information"

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

export function parseCharacterInformation(rawCharacterInformation : Record<string, string>) : characterInformation {
    return {
      quality: Number(rawCharacterInformation["quality"]),
      weapon: rawCharacterInformation["weapon"],
      element: rawCharacterInformation["element"],
      name: rawCharacterInformation["name"],
    };
}

//scrapCharacters()
scrapeCharacter("Amber").then((response) => {
    if (!response) throw new Error();
    const characterSplitedSection = splitWikitextSections(response);

    const rawCharacterInformation = parseInfoboxFields(characterSplitedSection[CHARACTER_INFORMATION_KEY])
    const characterInformation = parseCharacterInformation(rawCharacterInformation);
    console.log(characterInformation.quality)
})

