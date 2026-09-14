import { fetchCategoryMembers, fetchWikitext } from "./lib/wiki-fetch";

const PLAYABLE_CHARACTERS_CATEGORY = "Playable Characters"
const SECTION_REGEX = new RegExp("<!--([\s\S]*?)-->");

export function getCharactersName(): Promise<string[]> {
    return fetchCategoryMembers(PLAYABLE_CHARACTERS_CATEGORY);
}

export async function scrapeCharacter(characterName: string): Promise<string | null> {
    return await fetchWikitext(characterName);
}

function splitWikitextSections(wikitext: string): Record<string, string> {
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

export async function scrapCharacters(): Promise<void> {
    const charactersNames: string[] = await getCharactersName();

    for (const name of charactersNames) {
        const wikitext = await scrapeCharacter(name);
        if (wikitext) console.log(splitWikitextSections(wikitext));
    }
}

//scrapCharacters()
scrapeCharacter("Amber").then((response) => {
    console.log(response)
    response ? console.log(splitWikitextSections(response)) : null;
})