import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CharacterOut } from '../model/out/character/character';
import { CHARACTER_INCLUDE, CharacterWithRelations } from '../model/withRelations/character';
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
    const normalizedName = name.replace(/_/g, ' ');

    const character : CharacterWithRelations | null = await this.prisma.character.findFirst({
      where: {
        name: { equals: normalizedName, mode: 'insensitive' },
      },
      include: CHARACTER_INCLUDE,
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