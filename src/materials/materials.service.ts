import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialOut } from '../model/out/material/material';
import { MaterialWithRelations } from '../model/withRelations/material';
import { mapMaterial } from './mapper/material';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<string[]> {
    const materials = await this.prisma.material.findMany({
      select: { name: true },
    });
    return materials.map((material) => material.name).sort((a: string, b: string) => a.localeCompare(b));
  }

  async findOne(name: string, language: string): Promise<MaterialOut | undefined> {
    const material: MaterialWithRelations | null = await this.prisma.material.findUnique({
      where: { name },
      include: {
        translations: true,
        sources: {
          include: {
            translations: true,
            recipes: {
              include: {
                ingredients: {
                  include: { translations: true },
                },
              },
            },
          },
        },
        sellers: {
          include: { translations: true },
        },
        usedIn: {
          include: { translations: true },
        },
        usedByCharacters: {
          include: {
            character: {
              include: { translations: true },
            },
          },
        },
      },
    });

    if (!material) {
      throw new NotFoundException(`"${name}" not found`);
    }

    try {
      return mapMaterial(material, language);
    } catch (error: any) {
      console.error(error);
    }
  }
}