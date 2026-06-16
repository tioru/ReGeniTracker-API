import { WeaponTypes } from '@prisma/client';
import { WeaponLevelData } from './weaponLevel';
import { WeaponAscensionMaterialData } from './weaponAscensionMaterial';
import { WeaponSellerData } from './weaponSeller';

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
}