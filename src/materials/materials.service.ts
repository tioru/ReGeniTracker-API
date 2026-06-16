import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CharacterMaterialType, Prisma } from '@prisma/client';
import { MaterialOut } from '../model/out/material/material';
import { MaterialSourceOut } from '../model/out/material/materialSource';
import { MaterialSellerOut } from '../model/out/material/seller';

type MaterialWithRelations = Prisma.MaterialGetPayload<{
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
  };
}>;

type SourceWithRelations = MaterialWithRelations['sources'][number];
type SellerWithRelations = MaterialWithRelations['sellers'][number];
type UsedInWithRelations = MaterialWithRelations['usedIn'][number];
type UsedByCharacterWithRelations = MaterialWithRelations['usedByCharacters'][number];

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTranslation(translations: any[], language: string): any {
  return translations.find((translation: any) => translation.language === language) ?? null;
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapMaterial(materialWithRelations: MaterialWithRelations, language: string): MaterialOut {
  const pickedTranslation = pickTranslation(materialWithRelations.translations, language);

  if (!pickedTranslation) {
    throw new NotFoundException(`Language not found for "${materialWithRelations.name}"`);
  }

  return {
    name: materialWithRelations.name,
    rarity: materialWithRelations.rarity,
    categories: materialWithRelations.categories,
    description: pickedTranslation.description,
    sources: materialWithRelations.sources.map((source: SourceWithRelations) => mapSource(source, language)),
    usedIn: materialWithRelations.usedIn.map((use: UsedInWithRelations) => {
      const translation = pickTranslation(use.translations, language);
      return translation?.itemName ?? '';
    }),
    usedByCharacters: {
      ascension: materialWithRelations.usedByCharacters
        .filter((use: UsedByCharacterWithRelations) => use.type === CharacterMaterialType.ASCENSION)
        .map((use: UsedByCharacterWithRelations) => {
          const translation = pickTranslation(use.character.translations, language);
          return translation?.name ?? use.character.name;
        }),
      talent: materialWithRelations.usedByCharacters
        .filter((use: UsedByCharacterWithRelations) => use.type === CharacterMaterialType.TALENT)
        .map((use: UsedByCharacterWithRelations) => {
          const translation = pickTranslation(use.character.translations, language);
          return translation?.name ?? use.character.name;
        }),
    },
    sellers: materialWithRelations.sellers.map((seller: SellerWithRelations) => mapSeller(seller, language)),
  };
}

function mapSource(sourceWithRelations: SourceWithRelations, language: string): MaterialSourceOut {
  if (sourceWithRelations.type === 'ALCHEMY') {
    return {
      type: sourceWithRelations.type,
      minimumLevel: sourceWithRelations.minimumLevel,
      recipes: sourceWithRelations.recipes.map((recipe) => ({
        subtype: recipe.subtype,
        resultQuantity: recipe.resultQuantity,
        ingredients: recipe.ingredients.map((ingredient) => {
          const translation = pickTranslation(ingredient.translations, language);
          return {
            item: translation?.item ?? '',
            quantity: ingredient.quantity,
          };
        }),
      })),
    } satisfies MaterialSourceOut;
  }

  const translation = pickTranslation(sourceWithRelations.translations, language);
  return {
    type: sourceWithRelations.type,
    minimumLevel: sourceWithRelations.minimumLevel,
    names: translation?.names ?? [],
  } satisfies MaterialSourceOut;
}

function mapSeller(sellerWithRelations: SellerWithRelations, language: string): MaterialSellerOut {
  const translation = pickTranslation(sellerWithRelations.translations, language);
  return {
    name: translation?.name ?? '',
    currency: translation?.currency ?? '',
    cost: sellerWithRelations.cost,
    stock: sellerWithRelations.stock,
    restock: sellerWithRelations.restock,
  } satisfies MaterialSellerOut;
}

// ── Service ────────────────────────────────────────────────────────────────────

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