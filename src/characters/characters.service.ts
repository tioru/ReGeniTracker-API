import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CharacterOut } from '../model/out/character/character';
import { CharacterWithRelations } from '../model/withRelations/characters';
import { mapCharacter } from './mapper/character';

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