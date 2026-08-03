import { CharacterRaritySplitOut } from './characterRaritySplit';
import { WeaponRaritySplitOut } from './weaponRaritySplit';

export interface BannerOut {
  name: string;
  type: 'character' | 'weapon' | 'novice' | 'standard' | 'chronicled';
  releaseDate: Date;
  endDate: Date | null; // null pour les bannières permanentes (novice/standard)
  mechanic?: 'chronicled' | 'lightrace';

  boostedCharacters?: CharacterRaritySplitOut;
  otherCharacters?: CharacterRaritySplitOut;
  weapons?: WeaponRaritySplitOut;

  boostedWeapons?: WeaponRaritySplitOut;
  otherWeapons?: WeaponRaritySplitOut;
  characters?: CharacterRaritySplitOut;
}
