import { FeaturedRoles } from "@prisma/client";
import { CharacterRaritySplitOut } from "../../model/out/banner/characterRaritySplit";
import { BannerCharacterWithRelations, characterName, emptyCharacterSplit, rarityKey } from "./banner";

export function mapCharacterSplit(entries: BannerCharacterWithRelations[], role: FeaturedRoles, language: string): CharacterRaritySplitOut {
    const split = emptyCharacterSplit();

    for (const entry of entries) {
        if (entry.role !== role) continue;
        const key = rarityKey(entry.rarity);
        if (!key) continue;
        split[key].push(characterName(entry, language));
    }

    return split;
}