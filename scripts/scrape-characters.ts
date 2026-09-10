import { fetchOrWarn, fetchPageRevision } from "./lib/wiki-fetch";

const CHARACTERS_LIST_NAME_LINK = "https://genshin-impact.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Playable_Characters&cmlimit=500&format=json&formatversion=2"

export function getCharactersName() : string[] {
    return fetchOrWarn(`Fetch characters list names`, null, async () => {
        const page = await fetchPageRevision(CHARACTERS_LIST_NAME_LINK, "characters list names");
        return page?.revisions?.[0]?.slots?.main?.content ?? null;
    });
}

export function scrapeCharacter(characterName : string) : void {
    
}