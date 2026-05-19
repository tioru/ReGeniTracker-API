import { ObtainingTypes } from '@prisma/client';
import { LevelOut } from './level';
import { AscensionMaterialOut } from './ascensionMaterial';

export type CharacterOut = {
    name: string;
    rarity: number;
    vision: string;
    weapon: string;
    nation: string;
    birthday: string;
    releaseDate: string;
    specialDish: string;
    obtaining: ObtainingTypes[];
    title: string;
    description: string;
    affiliation: string;
    constellation: string;
    levels: Record<string, LevelOut>;
    ascensionMaterials: AscensionMaterialOut[];
}