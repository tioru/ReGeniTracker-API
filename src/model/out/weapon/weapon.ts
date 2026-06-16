import { WeaponTypes } from '@prisma/client';
import { WeaponSellerOut } from './seller';
import { WeaponLevelOut } from './level';
import { WeaponAscensionMaterialOut } from './ascensionMaterial';

export interface WeaponOut {
  name: string;
  type: WeaponTypes;
  rarity: number;
  releaseDate: Date | null;
  description: string | null;
  history: string | null;
  levels: Record<string, WeaponLevelOut>;
  ascensionMaterials: WeaponAscensionMaterialOut[];
  sellers: WeaponSellerOut[];
}