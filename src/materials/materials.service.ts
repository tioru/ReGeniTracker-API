import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Material, MaterialSource, AlchemyRecipe, RecipeIngredient, MaterialSeller, MaterialTranslation, MaterialUse, CharacterMaterialUse,
} from '@prisma/client';

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
// Types Prisma avec includes
// ---------------------------------------------------------------------------

type MaterialSourceWithRecipes = MaterialSource & {
  recipes: (AlchemyRecipe & {
    ingredients: RecipeIngredient[];
  })[];
};

type MaterialFull = Material & {
  translations: MaterialTranslation[];
  sources: MaterialSourceWithRecipes[];
  sellers: MaterialSeller[];
  usedIn: MaterialUse[];
  usedByCharacters: CharacterMaterialUse[];
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function pickTranslation(
  translations: MaterialTranslation[],
  lang: string,
): MaterialTranslation | undefined {
  return translations.find((t) => t.lang === lang) ?? translations[0];
}

function mapSource(source: MaterialSourceWithRecipes): MaterialSourceOut {
  if (source.type === 'ALCHEMY') {
    return {
      type: source.type,
      minimumLevel: source.minimumLevel,
      recipes: source.recipes.map((recipe) => ({
        subtype: recipe.subtype,
        resultQuantity: recipe.resultQuantity,
        ingredients: recipe.ingredients.map((ing) => ({
          item: ing.item,
          quantity: ing.quantity,
        })),
      })),
    };
  }

  return {
    type: source.type,
    minimumLevel: source.minimumLevel,
    names: source.names,
  };
}

function mapMaterial(material: MaterialFull, lang: string): MaterialOut {
  const translation = pickTranslation(material.translations, lang);

  return {
    name: translation?.name ?? material.name,
    rarity: material.rarity,
    categories: material.categories,
    description: translation?.description ?? null,
    sources: material.sources.map(mapSource),
    usedIn: material.usedIn.map((u) => u.itemName),
    usedByCharacters: {
      ascension: material.usedByCharacters
        .filter((u) => u.type === 'ASCENSION')
        .map((u) => u.characterName),
      talent: material.usedByCharacters
        .filter((u) => u.type === 'TALENT')
        .map((u) => u.characterName),
    },
    sellers: material.sellers.map((s) => ({
      name: s.name,
      currency: s.currency,
      cost: s.cost,
      stock: s.stock,
      restock: s.restock,
    })),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const MATERIAL_INCLUDE = {
  translations: true,
  sources: {
    include: {
      recipes: {
        include: {
          ingredients: true,
        },
      },
    },
  },
  sellers: true,
  usedIn: true,
  usedByCharacters: true,
} as const;

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string): Promise<string[]> {
    const materials = await this.prisma.material.findMany({
      select: { name: true },
    });
    return materials.map((m) => m.name).sort((a, b) => a.localeCompare(b));
  }

  async findOne(name: string, lang: string): Promise<MaterialOut | null> {
    const material = await this.prisma.material.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
      include: MATERIAL_INCLUDE,
    });
  
    if (!material) return null;
  
    return mapMaterial(material as MaterialFull, lang);
  }
}