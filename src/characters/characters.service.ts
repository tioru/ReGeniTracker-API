import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string) {
    const characters = await this.prisma.character.findMany({
      select: {
        name: true,
      },
    });
    return characters.map(c => c.name);
  }

  findOne(name: string, lang: string) {
    return this.prisma.character.findUnique({
      where: { name },
      include: {
        translations: {
          where: { lang },
        },
        ascensionMaterials: true,
        skillTalents: true,
        passiveTalents: true,
        constellations: true,
      },
    });
  }
}