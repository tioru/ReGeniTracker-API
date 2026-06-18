import { ObtainingTypes } from '@prisma/client';
import { CharacterAscensionMaterialData } from './characterAscensionMaterial';
import { NormalAttackData } from './normalAttack';
import { ElementalSkillData } from './elementalSkill';
import { ElementalBurstData } from './elementalBurst';
import { PassiveTalentData } from './passiveTalent';
import { AscensionTalentData } from './ascensionTalent';
import { AdditionalTalentData } from './additionalTalent';
import { ConstellationData } from './constellation';
import { CharacterLevelData } from './level';

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
  levels: Record<string, CharacterLevelData>;
  ascensionMaterials: CharacterAscensionMaterialData[];
  normalAttacks: NormalAttackData[];
  elementalSkills: ElementalSkillData[];
  elementalBursts: ElementalBurstData[];
  passiveTalents: PassiveTalentData[];
  ascensionTalents: AscensionTalentData[];
  additionalTalents: AdditionalTalentData[];
  constellations: ConstellationData[];
}