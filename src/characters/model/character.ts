import { ObtainingTypes } from '@prisma/client';
import { LevelOut } from './level';
import { AscensionMaterialOut } from './ascensionMaterial';
import { NormalAttackOut } from './normalAttack';
import { ElementalSkillOut } from './elementalSkill';
import { ElementalBurstOut } from './elementalBurst';
import { PassiveTalentOut } from './passiveTalent';
import { AdditionalTalentOut } from './additionalTalent';
import { AscensionTalentOut } from './ascensionTalent';
import { ConstellationOut } from './constellation';

export type CharacterOut = {
    name: string;
    rarity: number;
    vision: string;
    weapon: string;
    nation: string;
    birthday: Date | null;
    releaseDate: Date | null;
    specialDish: string | null;
    obtaining: ObtainingTypes[];
    title: string | null;
    description: string | null;
    affiliation: string | null;
    constellation: string | null;
    levels: Record<string, LevelOut>;
    ascensionMaterials: AscensionMaterialOut[];
    normalAttacks: NormalAttackOut[];
    elementalSkills: ElementalSkillOut[];
    elementalBursts: ElementalBurstOut[];
    passiveTalents: PassiveTalentOut[];
    ascensionTalents: AscensionTalentOut[];
    additionalTalents: AdditionalTalentOut[];
    constellations: ConstellationOut[];
}