import { NotFoundException } from "@nestjs/common";
import { pickTranslation } from "../../common";
import { BannerOut } from "../../model/out/banner/banner";
import { BannerWithRelations } from "../../model/withRelations/banner";
import { CharacterRaritySplitOut } from "../../model/out/banner/characterRaritySplit";
import { WeaponRaritySplitOut } from "../../model/out/banner/weaponRaritySplit";
import { mapCharacterSplit } from "./characterSplit";
import { mapWeaponSplit } from "./weaponSplit";

export type BannerCharacterWithRelations = BannerWithRelations['characters'][number];
export type BannerWeaponWithRelations = BannerWithRelations['weapons'][number];

export function emptyCharacterSplit(): CharacterRaritySplitOut {
    return { featured5Star: [], featured4Star: [], featured3Star: [] };
}

export function emptyWeaponSplit(): WeaponRaritySplitOut {
    return { featured5Star: [], featured4Star: [], featured3Star: [] };
}

export function rarityKey(rarity: number): 'featured5Star' | 'featured4Star' | 'featured3Star' | null {
    if (rarity === 5) return 'featured5Star';
    if (rarity === 4) return 'featured4Star';
    if (rarity === 3) return 'featured3Star';
    return null;
}

export function characterName(entry: BannerCharacterWithRelations, language: string): string {
    const translation = pickTranslation(entry.character.translations, language);
    return translation?.name ?? entry.character.name;
}

export function weaponName(entry: BannerWeaponWithRelations, language: string): string {
    const translation = pickTranslation(entry.weapon.translations, language);
    return translation?.name ?? entry.weapon.name;
}

export function mapBanner(bannerWithRelations: BannerWithRelations, language: string): BannerOut {
    const pickedTranslation = pickTranslation(bannerWithRelations.translations, language);

    if (!pickedTranslation) {
        throw new NotFoundException(`Language not found for "${bannerWithRelations.name}"`);
    }

    const base = {
        name: pickedTranslation.name,
        type: bannerWithRelations.type === 'CHARACTER' ? ('character' as const) : ('weapon' as const),
        releaseDate: bannerWithRelations.releaseDate,
        endDate: bannerWithRelations.endDate,
    };

    if (bannerWithRelations.type === 'CHARACTER') {
        return {
            ...base,
            boostedCharacters: mapCharacterSplit(bannerWithRelations.characters, 'BOOSTED', language),
            otherCharacters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
            weapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
        };
    }

    return {
        ...base,
        boostedWeapons: mapWeaponSplit(bannerWithRelations.weapons, 'BOOSTED', language),
        otherWeapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
        characters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
    };
}