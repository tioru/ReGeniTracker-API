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

function pickLang<T extends { lang: string }>(
  items: T[],
  lang: string,
): any {
  return items.find((t) => t.lang === lang) ?? items[0];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapMaterial(material: any, lang: string): MaterialOut {
  const translation = pickLang(material.translations, lang);

  return {
    name: translation?.name ?? material.name,
    rarity: material.rarity,
    categories: material.categories,
    description: translation?.description ?? null,
    sources: material.sources.map((source: any) => mapSource(source, lang)),
    usedIn: material.usedIn.map((use: any) => {
      const t = pickLang(use.translations, lang);
      return t?.itemName ?? '';
    }),
    usedByCharacters: {
      ascension: material.usedByCharacters
        .filter((u: any) => u.type === 'ASCENSION')
        .map((u: any) => {
          const t = pickLang(u.character.translations, lang);
          return t?.name ?? u.character.name;
        }),
      talent: material.usedByCharacters
        .filter((u: any) => u.type === 'TALENT')
        .map((u: any) => {
          const t = pickLang(u.character.translations, lang);
          return t?.name ?? u.character.name;
        }),
    },
    sellers: material.sellers.map((seller: any) => {
      const t = pickLang(seller.translations, lang);
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

function mapSource(source: any, lang: string): MaterialSourceOut {
  if (source.type === 'ALCHEMY') {
    return {
      type: source.type,
      minimumLevel: source.minimumLevel,
      recipes: source.recipes.map((recipe: any) => ({
        subtype: recipe.subtype,
        resultQuantity: recipe.resultQuantity,
        ingredients: recipe.ingredients.map((ing: any) => {
          const t = pickLang(ing.translations, lang);
          return {
            item: t?.item ?? '',
            quantity: ing.quantity,
          };
        }),
      })),
    };
  }

  const t = pickLang(source.translations, lang);
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

  async findAll(lang: string): Promise<MaterialOut[]> {
    const materials = await this.prisma.material.findMany({
      include: MATERIAL_INCLUDE,
    });

    return materials.map((m) => mapMaterial(m, lang));
  }

  async findOne(name: string, lang: string): Promise<MaterialOut | null> {
    const material = await this.prisma.material.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
      },
      include: MATERIAL_INCLUDE,
    });

    if (!material) return null;

    return mapMaterial(material, lang);
  }
}