import { NotFoundException } from "@nestjs/common";
import { pickTranslation } from "../../common";
import { CharacterOut } from "../../model/out/character/character";
import { CharacterWithRelations } from "../../model/withRelations/characters";
import { mapLevels } from "./level";
import { UnlockTypes } from "@prisma/client";
import { mapAdditionalTalent } from "./additionalTalent";
import { mapAscensionMaterials } from "./ascensionMaterial";
import { mapAscensionTalent } from "./ascensionTalent";
import { mapElementalBurst } from "./elementalBurst";
import { mapElementalSkill } from "./elementalSkill";
import { mapNormalAttack } from "./normalAttack";
import { mapPassiveTalent } from "./passiveTalent";
import { mapConstellation } from "./constellation";

export type NormalAttackWithRelations = CharacterWithRelations["normalAttacks"][number];
export type ElementalSkillWithRelations = CharacterWithRelations["elementalSkills"][number];
export type ElementalBurstWithRelations = CharacterWithRelations["elementalBursts"][number];
export type PassiveTalentWithRelations = CharacterWithRelations["passiveTalents"][number];
export type AscensionTalentWithRelations = CharacterWithRelations["ascensionTalents"][number];
export type AdditionalTalentWithRelations = CharacterWithRelations["additionalTalents"][number];
export type ConstellationWithRelations = CharacterWithRelations["constellations"][number];

export function mapDescriptions(items: { title: string | null; description: string }[]) {
  return items.map(description => ({ title: description.title, description: description.description }));
}

export function mapUnlockType(unlockType: string | null): UnlockTypes | null {
  if (!unlockType) return null;
  return unlockType as UnlockTypes;
}

export function mapCharacter(characterWithRelations: CharacterWithRelations, language: string) : CharacterOut {
  const pickedTranslation = pickTranslation(characterWithRelations.translations, language);

  if (!pickedTranslation) {
    throw new NotFoundException(`Language not found for "${characterWithRelations.name}"`);
  }

  return {
    name:         characterWithRelations.name,
    rarity:       characterWithRelations.rarity,
    vision:       characterWithRelations.vision,
    weapon:       characterWithRelations.weapon,
    nation:       characterWithRelations.nation,
    birthday:     characterWithRelations.birthday,
    releaseDate:  characterWithRelations.releaseDate,
    obtaining:    characterWithRelations.obtaining,
    // Champs traduits
    title:        pickedTranslation.title,
    description:  pickedTranslation.description,
    affiliation:  pickedTranslation.affiliation,
    constellation: pickedTranslation.constellation,
    specialDish: pickedTranslation.specialDish,
    // Relations
    levels:              mapLevels(characterWithRelations.levels),
    ascensionMaterials:  mapAscensionMaterials(characterWithRelations.ascensionMaterials, language),
    normalAttacks:       characterWithRelations.normalAttacks.map((normalAttackWithRelations: NormalAttackWithRelations) => mapNormalAttack(normalAttackWithRelations, language)),
    elementalSkills:     characterWithRelations.elementalSkills.map((elementalSkill: ElementalSkillWithRelations) => mapElementalSkill(elementalSkill, language)),
    elementalBursts:     characterWithRelations.elementalBursts.map((elementalBurst: ElementalBurstWithRelations) => mapElementalBurst(elementalBurst, language)),
    passiveTalents:      characterWithRelations.passiveTalents.map((passiveTalent: PassiveTalentWithRelations) => mapPassiveTalent(passiveTalent, language)),
    ascensionTalents:    characterWithRelations.ascensionTalents.map((ascensionTalent: AscensionTalentWithRelations) => mapAscensionTalent(ascensionTalent, language)),
    additionalTalents:   characterWithRelations.additionalTalents.map((additionalTalent: AdditionalTalentWithRelations) => mapAdditionalTalent(additionalTalent, language)),
    constellations:      characterWithRelations.constellations.map((constellation: ConstellationWithRelations) => mapConstellation(constellation, language)),
  };
}