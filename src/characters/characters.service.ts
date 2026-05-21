import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AscensionMaterial, NormalAttack, ElementalSkill, ElementalBurst, PassiveTalent, AscensionTalent, AdditionalTalent, Constellation } from '@prisma/client';
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTranslation(translations: any[], language: string): any {
  return translations.find((translation: any) => translation.language === language) ?? null;
}

function mapDescriptions(items: { title: string | null; description: string }[]) {
  return items.map(description => ({ title: description.title, description: description.description }));
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
    normalAttacks:       characterWithRelations.normalAttacks.map((normalAttack: NormalAttack) => mapNormalAttack(normalAttack, language)),
    elementalSkills:     characterWithRelations.elementalSkills.map((elementalSkill: ElementalSkill) => mapElementalSkill(elementalSkill, language)),
    elementalBursts:     characterWithRelations.elementalBursts.map((elementalBurst: ElementalBurst) => mapElementalBurst(elementalBurst, language)),
    passiveTalents:      characterWithRelations.passiveTalents.map((passiveTalent: PassiveTalent) => mapPassiveTalent(passiveTalent, language)),
    ascensionTalents:    characterWithRelations.ascensionTalents.map((ascensionTalent: AscensionTalent) => mapAscensionTalent(ascensionTalent, language)),
    additionalTalents:   characterWithRelations.additionalTalents.map((additionalTalent: AdditionalTalent) => mapAdditionalTalent(additionalTalent, language)),
    constellations:      characterWithRelations.constellations.map((constellation: Constellation) => mapConstellation(constellation, language)),
  };
}

function mapLevels(levels: CharacterWithRelations["levels"]) : CharacterOut["levels"] {
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

function mapAscensionMaterials(ascensionMaterials: AscensionMaterial[]) : AscensionMaterialOut[] {
  type AscensionMaterialItem = CharacterWithRelations['ascensionMaterials'][number]['items'][number];

  return ascensionMaterials.map((ascensionMaterial : AscensionMaterial) => ({
    level:     ascensionMaterial.level,
    materials: ascensionMaterial.materials.map((material: {name: string, quantity: number}) => ({
      name: material.name,
      quantity: material.quantity
    })),
  }));
}

function mapNormalAttack(normalAttack: NormalAttack, language: string) : NormalAttackOut {
  const pickedTranslation = pickTranslation(normalAttack.translations, language);

  return {
    unlock: normalAttack.unlock,
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    upgrades: normalAttack.upgrades.map((upgrade : UpgradeItemOut) => ({
      name:   upgrade.name,
      values: upgrade.values,
    }))
  } as NormalAttackOut;
}

function mapElementalSkill(elementalSkill: ElementalSkill, language: string) : ElementalSkillOut {
  const pickedTranslation = pickTranslation(elementalSkill.translations, language);

  return {
    unlock: elementalSkill.unlock,
    name: pickedTranslation.name,
    note: pickedTranslation.note,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    upgrades: elementalSkill.upgrades.map((upgrade : UpgradeItemOut) => ({
      name:   upgrade.name,
      values: upgrade.values,
    }))
  } as ElementalSkillOut;
}

function mapElementalBurst(elementalBurst: ElementalBurst, language: string) : ElementalBurstOut {
  const pickedTranslation = pickTranslation(elementalBurst.translations, language);

  return {
    unlock: elementalBurst.unlock,
    name: pickedTranslation.name,
    note: pickedTranslation.note,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    upgrades: elementalBurst.upgrades.map((upgrade : UpgradeItemOut) => ({
      name:   upgrade.name,
      values: upgrade.values,
    }))
  } as ElementalBurstOut;
}

function mapPassiveTalent(passiveTalent: PassiveTalent, language: string) : PassiveTalentOut {
  const pickedTranslation = pickTranslation(passiveTalent.translations, language);

  return {
    unlock: passiveTalent.unlock,
    name: pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
    attributes: passiveTalent.attributes.map((attribute : AttributeItemOut) => ({
      name:   attribute.name,
      value: attribute.value,
    }))
  } as PassiveTalentOut;
}

function mapAscensionTalent(ascensionTalent: AscensionTalent, language: string) : AscensionTalentOut {
  const pickedTranslation = pickTranslation(ascensionTalent.translations, language);
  
  return {
    unlock:       ascensionTalent.unlock,
    name:         pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
  } as AscensionTalentOut;
}

function mapAdditionalTalent(additionalTalent: AdditionalTalent, language: string) : AdditionalTalentOut {
  const pickedTranslation = pickTranslation(additionalTalent.translations, language);
  
  return {
    unlock:       additionalTalent.unlock,
    name:         pickedTranslation.name,
    descriptions: mapDescriptions(pickedTranslation.descriptions),
  } as AdditionalTalentOut;
}

function mapConstellation(constellation: Constellation, language: string) : ConstellationOut {
  const pickedTranslation = pickTranslation(constellation.translations, language);

  return {
    level:                  constellation.level,
    name:                   pickedTranslation.name,
    descriptions:           mapDescriptions(pickedTranslation.descriptions),
    hexereiBuffDescriptions: mapDescriptions(pickedTranslation.hexereiBuffDescriptions),
  } as ConstellationOut;
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