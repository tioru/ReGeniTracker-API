import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Types de sortie (miroir du JSON source)
// ---------------------------------------------------------------------------

type RecipeIngredientOut = {
  item: string;
  quantity: number;
};

type AlchemyRecipeOut = {
  subtype: string;
  resultQuantity: number;
  ingredients: RecipeIngredientOut[];
};

type MaterialSourceOut = {
  type: string;
  minimumLevel?: number | null;
  names?: string[];
  recipes?: AlchemyRecipeOut[];
};

type MaterialSellerOut = {
  name: string;
  currency: string;
  cost: number;
  stock: number;
  restock: string;
};

type MaterialOut = {
  name: string;
  rarity: number | null;
  categories: string[];
  description: string | null;
  sources: MaterialSourceOut[];
  usedIn: string[];
  usedByCharacters: {
    ascension: string[];
    talent: string[];
  };
  sellers: MaterialSellerOut[];
};

// ---------------------------------------------------------------------------
// Include Prisma
// ---------------------------------------------------------------------------

const MATERIAL_INCLUDE = {
  translations: true,
  sources: {
    include: {
      translations: true,
      recipes: {
        include: {
          ingredients: {
            include: {
              translations: true,
            },
          },
        },
      },
    },
  },
  sellers: {
    include: {
      translations: true,
    },
  },
  usedIn: {
    include: {
      translations: true,
    },
  },
  usedByCharacters: {
    include: {
      character: {
        include: {
          translations: true,
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickLanguage<T extends { language: string }>(
  items: T[],
  language: string,
): any {
  return items.find((t) => t.language === language) ?? items[0];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapMaterial(material: any, language: string): MaterialOut {
  const translation = pickLanguage(material.translations, language);

  return {
    name: translation?.name ?? material.name,
    rarity: material.rarity,
    categories: material.categories,
    description: translation?.description ?? null,
    sources: material.sources.map((source: any) => mapSource(source, language)),
    usedIn: material.usedIn.map((use: any) => {
      const t = pickLanguage(use.translations, language);
      return t?.itemName ?? '';
    }),
    usedByCharacters: {
      ascension: material.usedByCharacters
        .filter((u: any) => u.type === 'ASCENSION')
        .map((u: any) => {
          const t = pickLanguage(u.character.translations, language);
          return t?.name ?? u.character.name;
        }),
      talent: material.usedByCharacters
        .filter((u: any) => u.type === 'TALENT')
        .map((u: any) => {
          const t = pickLanguage(u.character.translations, language);
          return t?.name ?? u.character.name;
        }),
    },
    sellers: material.sellers.map((seller: any) => {
      const t = pickLanguage(seller.translations, language);
      return {
        name: t?.name ?? '',
        currency: t?.currency ?? '',
        cost: seller.cost,
        stock: seller.stock,
        restock: seller.restock,
      };
    }),
  };
}

function mapSource(source: any, language: string): MaterialSourceOut {
  if (source.type === 'ALCHEMY') {
    return {
      type: source.type,
      minimumLevel: source.minimumLevel,
      recipes: source.recipes.map((recipe: any) => ({
        subtype: recipe.subtype,
        resultQuantity: recipe.resultQuantity,
        ingredients: recipe.ingredients.map((ing: any) => {
          const t = pickLanguage(ing.translations, language);
          return {
            item: t?.item ?? '',
            quantity: ing.quantity,
          };
        }),
      })),
    };
  }

  const t = pickLanguage(source.translations, language);
  return {
    type: source.type,
    minimumLevel: source.minimumLevel,
    names: t?.names ?? [],
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(language: string): Promise<MaterialOut[]> {
    const materials = await this.prisma.material.findMany({
      include: MATERIAL_INCLUDE,
    });

    return materials.map((m) => mapMaterial(m, language));
  }

  async findOne(name: string, language: string): Promise<MaterialOut | null> {
    const normalizedName = name.replace(/_/g, ' ');
    
    const material = await this.prisma.material.findFirst({
      where: {
        name: { equals: normalizedName , mode: 'insensitive' },
      },
      include: MATERIAL_INCLUDE,
    });

    if (!material) return null;

    return mapMaterial(material, language);
  }
}