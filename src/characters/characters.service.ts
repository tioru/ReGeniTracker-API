import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UnlockTypes } from '@prisma/client';
import { CharacterOut } from '../model/out/character/character';
import { NormalAttackOut } from '../model/out/character/normalAttack';
import { ElementalSkillOut } from '../model/out/character/elementalSkill';
import { ElementalBurstOut } from '../model/out/character/elementalBurst';
import { PassiveTalentOut } from '../model/out/character/passiveTalent';
import { AscensionMaterialOut } from '../model/out/character/ascensionMaterial';
import { AscensionTalentOut } from '../model/out/character/ascensionTalent';
import { AdditionalTalentOut } from '../model/out/character/additionalTalent';
import { ConstellationOut } from '../model/out/character/constellation';
import { pickTranslation } from '../common';
import { ENGLISH_INDEX } from '../../constants';



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

function mapAscensionMaterials(ascensionMaterialsWithRelations: AscensionMaterialWithRelations[], language: string) : AscensionMaterialOut[] {
  return ascensionMaterialsWithRelations.map((ascensionMaterialWithRelations : AscensionMaterialWithRelations) => ({
    level:     ascensionMaterialWithRelations.level,
    materials: ascensionMaterialWithRelations.items.map((item: AscensionMaterialWithRelationsItem) => {
      const translation = pickTranslation(item.material.translations, language);
      return {
        name: translation?.name ?? item.material.name,
        quantity: item.quantity,
      };
    }),
  }));
}

function mapNormalAttack(normalAttackWithRelations: NormalAttackWithRelations, language: string) : NormalAttackOut {
  const pickedTranslation = pickTranslation(normalAttackWithRelations.translations, language);

  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for normal attack ${normalAttackWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(normalAttackWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    upgrades: normalAttackWithRelations.upgrades.map((upgrade) => {
      const translation = pickTranslation(upgrade.translations, language);
      return {
        name: translation?.name ?? '',
        values: upgrade.values,
      };
    }),
  } satisfies NormalAttackOut;
}

function mapElementalSkill(elementalSkillWithRelations: ElementalSkillWithRelations, language: string) : ElementalSkillOut {
  const pickedTranslation = pickTranslation(elementalSkillWithRelations.translations, language);

  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for elemental skill ${elementalSkillWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(elementalSkillWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    note: pickedTranslation?.note ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    upgrades: elementalSkillWithRelations.upgrades.map((upgrade) => {
      const translation = pickTranslation(upgrade.translations, language);
      return {
        name: translation?.name ?? '',
        values: upgrade.values,
      };
    }),
  } satisfies ElementalSkillOut;
}

function mapElementalBurst(elementalBurstWithRelations: ElementalBurstWithRelations, language: string) : ElementalBurstOut {
  const pickedTranslation = pickTranslation(elementalBurstWithRelations.translations, language);

  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for elemental burst ${elementalBurstWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(elementalBurstWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    note: pickedTranslation?.note ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    upgrades: elementalBurstWithRelations.upgrades.map((upgrade) => {
      const translation = pickTranslation(upgrade.translations, language);
      return {
        name: translation?.name ?? '',
        values: upgrade.values,
      };
    }),
  } satisfies ElementalBurstOut;
}

function mapPassiveTalent(passiveTalentWithRelations: PassiveTalentWithRelations, language: string) : PassiveTalentOut {
  const pickedTranslation = pickTranslation(passiveTalentWithRelations.translations, language);

  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for passive talent ${passiveTalentWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(passiveTalentWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    attributes: passiveTalentWithRelations.attributes.map((attribute) => {
      const translation = pickTranslation(attribute.translations, language);
      return {
        name: translation?.name ?? '',
        value: translation?.value ?? '',
      };
    }),
  } satisfies PassiveTalentOut;
}

function mapAscensionTalent(ascensionTalentWithRelations: AscensionTalentWithRelations, language: string) : AscensionTalentOut {
  const pickedTranslation = pickTranslation(ascensionTalentWithRelations.translations, language);
  
  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for ascension talent ${ascensionTalentWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(ascensionTalentWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
  } satisfies AscensionTalentOut;
}

function mapAdditionalTalent(additionalTalentWithRelations: AdditionalTalentWithRelations, language: string) : AdditionalTalentOut {
  const pickedTranslation = pickTranslation(additionalTalentWithRelations.translations, language);
  
  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for additional talent ${additionalTalentWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(additionalTalentWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
  } satisfies AdditionalTalentOut;
}

function mapConstellation(constellationWithRelations: ConstellationWithRelations, language: string) : ConstellationOut {
  const pickedTranslation = pickTranslation(constellationWithRelations.translations, language);

  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for constellation ${constellationWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    level: constellationWithRelations.level,
    name: pickedTranslation?.name ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    hexereiBuffDescriptions: mapDescriptions(pickedTranslation?.hexereiBuffDescriptions ?? []),
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
            items: { 
              include: { 
                material: {
                  include: {
                    translations: true
                  },
                },
              },
            },
          },
        },
        normalAttacks: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: {
              include: { translations: true },
            },
          },
        },
        elementalSkills: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: {
              include: { translations: true },
            },
          },
        },
        elementalBursts: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: {
              include: { translations: true },
            },
          },
        },
        passiveTalents: {
          include: {
            translations: { include: { descriptions: true } },
            attributes: {
              include: { translations: true },
            },
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
    } catch (error: any) {
      console.error(error);
    }
  }
}