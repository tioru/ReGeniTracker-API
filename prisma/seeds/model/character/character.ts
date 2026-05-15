import { ObtainingTypes } from '@prisma/client';
import { AscensionMaterialData } from './ascensionMaterial';
import { NormalAttackData } from './normalAttack';
import { ElementalSkill as ElementalSkillData } from './elementalSkill';
import { ElementalBurst as ElementalBurstData } from './elementalBurst';
import { PassiveTalent as PassiveTalentData } from './passiveTalent';
import { AscensionTalent as AscensionTalentData } from './ascensionTalent';
import { AdditionalTalent as AdditionalTalentData } from './additionalTalent';
import { Constellation as ConstellationData } from './constellation';
import { LevelData } from './level';

export interface CharacterData {
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
  levels: Record<string, LevelData>;
  ascensionMaterials: AscensionMaterialData[];
  normalAttacks: NormalAttackData[];
  elementalSkills: ElementalSkillData[];
  elementalBursts: ElementalBurstData[];
  passiveTalents: PassiveTalentData[];
  ascensionTalents: AscensionTalentData[];
  additionalTalents: AdditionalTalentData[];
  constellations: ConstellationData[];
}