import { CharacterRaritySplitData } from "./characterRaritySplit";
import { WeaponRaritySplitData } from "./weaponRaritySplit";

export interface BannerData {
    name: string;
    type: 'character' | 'weapon' | 'novice' | 'standard' | 'chronicled';
    releaseDate: string;
    endDate?: string; // absent pour les bannières permanentes (novice/standard)
    mechanic?: 'chronicled' | 'lightrace'; // uniquement pour type "chronicled"

    boostedCharacters?: CharacterRaritySplitData;
    otherCharacters?: CharacterRaritySplitData;
    weapons?: WeaponRaritySplitData;

    boostedWeapons?: WeaponRaritySplitData;
    otherWeapons?: WeaponRaritySplitData;
    characters?: CharacterRaritySplitData;
}
