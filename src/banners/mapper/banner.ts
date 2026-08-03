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

const TYPE_OUT_MAP: Record<BannerWithRelations['type'], BannerOut['type']> = {
    CHARACTER: 'character',
    WEAPON: 'weapon',
    NOVICE: 'novice',
    STANDARD: 'standard',
    CHRONICLED: 'chronicled',
};

const MECHANIC_OUT_MAP: Record<NonNullable<BannerWithRelations['mechanic']>, NonNullable<BannerOut['mechanic']>> = {
    CHRONICLED: 'chronicled',
    LIGHTRACE: 'lightrace',
};

export function mapBanner(bannerWithRelations: BannerWithRelations, language: string): BannerOut {
    const pickedTranslation = pickTranslation(bannerWithRelations.translations, language);

    if (!pickedTranslation) {
        throw new NotFoundException(`Language not found for "${bannerWithRelations.name}"`);
    }

    const base = {
        name: pickedTranslation.name,
        type: TYPE_OUT_MAP[bannerWithRelations.type],
        releaseDate: bannerWithRelations.releaseDate,
        endDate: bannerWithRelations.endDate,
        ...(bannerWithRelations.mechanic ? { mechanic: MECHANIC_OUT_MAP[bannerWithRelations.mechanic] } : {}),
    };

    switch (bannerWithRelations.type) {
        case 'CHARACTER':
            return {
                ...base,
                boostedCharacters: mapCharacterSplit(bannerWithRelations.characters, 'BOOSTED', language),
                otherCharacters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
                weapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
            };
        case 'WEAPON':
            return {
                ...base,
                boostedWeapons: mapWeaponSplit(bannerWithRelations.weapons, 'BOOSTED', language),
                otherWeapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
                characters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
            };
        case 'NOVICE':
        case 'STANDARD':
            // Bannières permanentes : un seul pool à odds de base, pas de rate-up
            // (cf. bannerHelperImpl.normalize, role toujours "OTHER" pour ces types).
            return {
                ...base,
                characters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
                weapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
            };
        case 'CHRONICLED':
            // Groupe restreint mis en avant à égalité, sans rate-up individuel
            // (role toujours "BOOSTED" pour ce type, cf. bannerHelperImpl.normalize).
            return {
                ...base,
                characters: mapCharacterSplit(bannerWithRelations.characters, 'BOOSTED', language),
                weapons: mapWeaponSplit(bannerWithRelations.weapons, 'BOOSTED', language),
            };
    }
}