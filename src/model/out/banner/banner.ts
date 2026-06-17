import { CharacterRaritySplitOut } from './characterRaritySplit';
import { WeaponRaritySplitOut } from './weaponRaritySplit';

export interface BannerOut {
  name: string;
  type: 'character' | 'weapon';
  releaseDate: Date;
  endDate: Date;

  boostedCharacters?: CharacterRaritySplitOut;
  otherCharacters?: CharacterRaritySplitOut;
  weapons?: WeaponRaritySplitOut;

  boostedWeapons?: WeaponRaritySplitOut;
  otherWeapons?: WeaponRaritySplitOut;
  characters?: CharacterRaritySplitOut;
}