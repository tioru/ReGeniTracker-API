import { CharacterRaritySplitData } from "./characterRaritySplit";
import { WeaponRaritySplitData } from "./weaponRaritySplit";

export interface BannerData {
    name: string;
    type: 'character' | 'weapon';
    releaseDate: string;
    endDate: string;

    boostedCharacters?: CharacterRaritySplitData;
    otherCharacters?: CharacterRaritySplitData;
    weapons?: WeaponRaritySplitData;

    boostedWeapons?: WeaponRaritySplitData;
    otherWeapons?: WeaponRaritySplitData;
    characters?: CharacterRaritySplitData;
}