import { WeaponAscensionMaterialItemData } from './weaponAscensionMaterialItem';

export interface WeaponRefinementRankData {
  title: string;
  descriptions: string[];
  upgradeCost: WeaponAscensionMaterialItemData[];
}
