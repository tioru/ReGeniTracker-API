import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CharacterTranslation, ConstellationTranslation, Prisma } from '@prisma/client';

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
  return items.map(d => ({ title: d.title, description: d.description }));
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapCharacter(characterWithRelations: CharacterWithRelations, language: string) : CharacterWithRelations {
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
    normalAttacks:       characterWithRelations.normalAttacks.map((x: any) => mapTalentWithUpgrades(x, language)),
    elementalSkills:     characterWithRelations.elementalSkills.map((x: any) => mapTalentWithUpgrades(x, language)),
    elementalBursts:     characterWithRelations.elementalBursts.map((x: any) => mapTalentWithUpgrades(x, language)),
    passiveTalents:      characterWithRelations.passiveTalents.map((x: any) => mapPassiveTalent(x, language)),
    ascensionTalents:    characterWithRelations.ascensionTalents.map((x: any) => mapSimpleTalent(x, language)),
    additionalTalents:   characterWithRelations.additionalTalents.map((x: any) => mapSimpleTalent(x, language)),
    constellations:      characterWithRelations.constellations.map((x: any) => mapConstellation(x, language)),
  };
}

function mapLevels(levels: CharacterWithRelations["levels"]) {
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

function mapAscensionMaterials(ascensionMaterials: CharacterWithRelations["ascensionMaterials"]) {
  return ascensionMaterials.map(ascensionMaterial => ({
    level:     ascensionMaterial.level,
    materials: ascensionMaterial.items.map((item: any) => ({
      name:  item.material.name,
      quantity: item.quantity,
    })),
  }));
}

function mapTalentWithUpgrades(talent: any, language: string) {
  const t = pickTranslation(talent.translations, language);
  return {
    unlock:       talent.unlock ?? null,
    name:         t?.name ?? null,
    note:         t?.note ?? null,
    descriptions: mapDescriptions(t?.descriptions ?? []),
    upgrades:     (talent.upgrades ?? []).map((u: any) => ({
      name:   u.name,
      values: u.values,
    })),
  };
}

function mapPassiveTalent(talent: any, language: string) {
  const t = pickTranslation(talent.translations, language);
  return {
    unlock:       talent.unlock ?? null,
    name:         t?.name ?? null,
    note:         t?.note ?? null,
    descriptions: mapDescriptions(t?.descriptions ?? []),
    attributes:   (talent.attributes ?? []).map((a: any) => ({
      name:  a.name,
      value: a.value,
    })),
  };
}

function mapSimpleTalent(talent: any, language: string) {
  const t = pickTranslation(talent.translations, language);
  return {
    unlock:       talent.unlock ?? null,
    name:         t?.name ?? null,
    descriptions: mapDescriptions(t?.descriptions ?? []),
  };
}

function mapConstellation(constellation: any, language: string) {
  const t = pickTranslation(constellation.translations, language);
  return {
    level:                  constellation.level,
    name:                   t?.name ?? null,
    descriptions:           mapDescriptions(t?.descriptions ?? []),
    hexereiBuffDescriptions: mapDescriptions(t?.hexereiBuffDescriptions ?? []),
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<string[]> {
    const characters = await this.prisma.character.findMany({
      select: { name: true },
    });
    return characters.map(character => character.name).sort((a, b) => a.localeCompare(b));
  }

  async findOne(name: string, language: string) {
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