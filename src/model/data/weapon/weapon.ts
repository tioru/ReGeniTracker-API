import { WeaponTypes } from '@prisma/client';
import { WeaponLevelData } from './weaponLevel';
import { WeaponAscensionMaterialData } from './weaponAscensionMaterial';
import { WeaponSellerData } from './weaponSeller';
import { WeaponSecondaryAttributeData } from './weaponSecondaryAttribute';
import { WeaponRefinementRankData } from './weaponRefinementRank';

export interface WeaponData {
  name: string;
  type: WeaponTypes;
  rarity: number;
  releaseDate: string;
  description: string;
  history: string;
  sellers: WeaponSellerData[];
  ascensionMaterials: WeaponAscensionMaterialData[];
  levels: Record<string, WeaponLevelData>;
  secondaryAttribute?: WeaponSecondaryAttributeData;
  effects?: string[];
  weaponRefinementLevel?: Record<string, WeaponRefinementRankData>;
}