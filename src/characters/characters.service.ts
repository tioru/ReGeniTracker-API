import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UnlockTypes } from '@prisma/client';
import { CharacterOut } from './model/character';
import { NormalAttackOut } from './model/normalAttack';
import { UpgradeItemOut } from './model/upgradeItem';
import { ElementalSkillOut } from './model/elementalSkill';
import { ElementalBurstOut } from './model/elementalBurst';
import { PassiveTalentOut } from './model/passiveTalent';
import { AttributeItemOut } from './model/attributeItem';
import { AscensionMaterialOut } from './model/ascensionMaterial';
import { AscensionTalentOut } from './model/ascensionTalent';
import { AdditionalTalentOut } from './model/additionalTalent';
import { ConstellationOut } from './model/constellation';

type CharacterWithRelations = Prisma.CharacterGetPayload<{
  include: {
    translations: true,
    levels: true,
    ascensionMaterials: {
      include: {
        items: { include: { material: true } },
      },
    },
    normalAttacks: {
      include: {
        translations: { include: { descriptions: true } },
        upgrades: true,
      },
    },
    elementalSkills: {
      include: {
        translations: { include: { descriptions: true } },
        upgrades: true,
      },
    },
    elementalBursts: {
      include: {
        translations: { include: { descriptions: true } },
        upgrades: true,
      },
    },
    passiveTalents: {
      include: {
        translations: { include: { descriptions: true } },
        attributes: true,
      },
    },
    ascensionTalents: {
      include: {
        translations: { include: { descriptions: true } },
      },
    },
    additionalTalents: {
      include: {
        translations: { include: { descriptions: true } },
      },
    },
    constellations: {
      include: {
        translations: {
          include: {
            descriptions: true,
            hexereiBuffDescriptions: true,
          },
        },
      },
    },
  }
}>;

type AscensionMaterialWithRelations = CharacterWithRelations['ascensionMaterials'][number];
type AscensionMaterialWithRelationsItem = AscensionMaterialWithRelations['items'][number];
type NormalAttackWithRelations = CharacterWithRelations["normalAttacks"][number];
type LevelsWithRelations = CharacterWithRelations["levels"];
type ElementalSkillWithRelations = CharacterWithRelations["elementalSkills"][number];
type ElementalBurstWithRelations = CharacterWithRelations["elementalBursts"][number];
type PassiveTalentWithRelations = CharacterWithRelations["passiveTalents"][number];
type AscensionTalentWithRelations = CharacterWithRelations["ascensionTalents"][number];
type AdditionalTalentWithRelations = CharacterWithRelations["additionalTalents"][number];
type ConstellationWithRelations = CharacterWithRelations["constellations"][number];

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTranslation(translations: any[], language: string): any {
  return translations.find((translation: any) => translation.language === language) ?? null;
}

function mapDescriptions(items: { title: string | null; description: string }[]) {
  return items.map(description => ({ title: description.title, description: description.description }));
}

function mapUnlockType(unlockType: string | null): UnlockTypes | null {
  if (!unlockType) return null;
  return unlockType as UnlockTypes;
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapCharacter(characterWithRelations: CharacterWithRelations, language: string) : CharacterOut {
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
    ascensionMaterials:  mapAscensionMaterials(characterWithRelations.ascensionMaterials),
    normalAttacks:       characterWithRelations.normalAttacks.map((normalAttackWithRelations: NormalAttackWithRelations) => mapNormalAttack(normalAttackWithRelations, language)),
    elementalSkills:     characterWithRelations.elementalSkills.map((elementalSkill: ElementalSkillWithRelations) => mapElementalSkill(elementalSkill, language)),
    elementalBursts:     characterWithRelations.elementalBursts.map((elementalBurst: ElementalBurstWithRelations) => mapElementalBurst(elementalBurst, language)),
    passiveTalents:      characterWithRelations.passiveTalents.map((passiveTalent: PassiveTalentWithRelations) => mapPassiveTalent(passiveTalent, language)),
    ascensionTalents:    characterWithRelations.ascensionTalents.map((ascensionTalent: AscensionTalentWithRelations) => mapAscensionTalent(ascensionTalent, language)),
    additionalTalents:   characterWithRelations.additionalTalents.map((additionalTalent: AdditionalTalentWithRelations) => mapAdditionalTalent(additionalTalent, language)),
    constellations:      characterWithRelations.constellations.map((constellation: ConstellationWithRelations) => mapConstellation(constellation, language)),
  };
}

function mapLevels(levels: LevelsWithRelations) : CharacterOut["levels"] {
  return Object.fromEntries(
    levels.map(level => 
      [ level.level, 
        {
          baseHp:        level.baseHp,
          baseDef:       level.baseDef,
          baseAtk:       level.baseAtk,
          energyRecharge: level.energyRecharge,
        }
      ]
    )
  );
}

function mapAscensionMaterials(ascensionMaterialsWithRelations: AscensionMaterialWithRelations[]) : AscensionMaterialOut[] {
  return ascensionMaterialsWithRelations.map((ascensionMaterialWithRelations : AscensionMaterialWithRelations) => ({
    level:     ascensionMaterialWithRelations.level,
    materials: ascensionMaterialWithRelations.items.map((item: AscensionMaterialWithRelationsItem) => ({
      name: item.material.name,
      quantity: item.quantity
    })),
  }));
}

function mapNormalAttack(normalAttackWithRelations: NormalAttackWithRelations, language: string) : NormalAttackOut {
  const pickedTranslation = pickTranslation(normalAttackWithRelations.translations, language);

  return {
    unlock: mapUnlockType(normalAttackWithRelations.unlock),
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    upgrades: normalAttackWithRelations.upgrades.map((upgrade : UpgradeItemOut) => ({
      name:   upgrade.name,
      values: upgrade.values,
    }))
  } satisfies NormalAttackOut;
}

function mapElementalSkill(elementalSkillWithRelations: ElementalSkillWithRelations, language: string) : ElementalSkillOut {
  const pickedTranslation = pickTranslation(elementalSkillWithRelations.translations, language);

  return {
    unlock: mapUnlockType(elementalSkillWithRelations.unlock),
    name: pickedTranslation.name,
    note: pickedTranslation.note,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    upgrades: elementalSkillWithRelations.upgrades.map((upgrade : UpgradeItemOut) => ({
      name:   upgrade.name,
      values: upgrade.values,
    }))
  } satisfies ElementalSkillOut;
}

function mapElementalBurst(elementalBurstWithRelations: ElementalBurstWithRelations, language: string) : ElementalBurstOut {
  const pickedTranslation = pickTranslation(elementalBurstWithRelations.translations, language);

  return {
    unlock: mapUnlockType(elementalBurstWithRelations.unlock),
    name: pickedTranslation.name,
    note: pickedTranslation.note,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    upgrades: elementalBurstWithRelations.upgrades.map((upgrade : UpgradeItemOut) => ({
      name:   upgrade.name,
      values: upgrade.values,
    }))
  } satisfies ElementalBurstOut;
}

function mapPassiveTalent(passiveTalentWithRelations: PassiveTalentWithRelations, language: string) : PassiveTalentOut {
  const pickedTranslation = pickTranslation(passiveTalentWithRelations.translations, language);

  return {
    unlock: mapUnlockType(passiveTalentWithRelations.unlock),
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    attributes: passiveTalentWithRelations.attributes.map((attribute : AttributeItemOut) => ({
      name:   attribute.name,
      value: attribute.value,
    }))
  } satisfies PassiveTalentOut;
}

function mapAscensionTalent(ascensionTalentWithRelations: AscensionTalentWithRelations, language: string) : AscensionTalentOut {
  const pickedTranslation = pickTranslation(ascensionTalentWithRelations.translations, language);
  
  return {
    unlock: mapUnlockType(ascensionTalentWithRelations.unlock),
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
  } satisfies AscensionTalentOut;
}

function mapAdditionalTalent(additionalTalentWithRelations: AdditionalTalentWithRelations, language: string) : AdditionalTalentOut {
  const pickedTranslation = pickTranslation(additionalTalentWithRelations.translations, language);
  
  return {
    unlock: mapUnlockType(additionalTalentWithRelations.unlock),
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
  } satisfies AdditionalTalentOut;
}

function mapConstellation(constellationWithRelations: ConstellationWithRelations, language: string) : ConstellationOut {
  const pickedTranslation = pickTranslation(constellationWithRelations.translations, language);

  return {
    level: constellationWithRelations.level,
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    hexereiBuffDescriptions: mapDescriptions(pickedTranslation.hexereiBuffDescriptions),
  } satisfies ConstellationOut;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<string[]> {
    const characters = await this.prisma.character.findMany({
      select: { name: true },
    });
    return characters.map(character => character.name).sort((a : string, b : string) => a.localeCompare(b));
  }

  async findOne(name: string, language: string) : Promise<CharacterOut | undefined> {
    const character : CharacterWithRelations | null = await this.prisma.character.findUnique({
      where: { name },
      include: {
        translations: true,
        levels: true,
        ascensionMaterials: {
          include: {
            items: { include: { material: true } },
          },
        },
        normalAttacks: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: true,
          },
        },
        elementalSkills: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: true,
          },
        },
        elementalBursts: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: true,
          },
        },
        passiveTalents: {
          include: {
            translations: { include: { descriptions: true } },
            attributes: true,
          },
        },
        ascensionTalents: {
          include: {
            translations: { include: { descriptions: true } },
          },
        },
        additionalTalents: {
          include: {
            translations: { include: { descriptions: true } },
          },
        },
        constellations: {
          include: {
            translations: {
              include: {
                descriptions: true,
                hexereiBuffDescriptions: true,
              },
            },
          },
        },
      },
    });

    if (!character) {
      throw new NotFoundException(`"${name}" not found`);
    }

    try {
      return mapCharacter(character, language);
    } catch (e: any) {
      console.error(e)
    }
  }
}