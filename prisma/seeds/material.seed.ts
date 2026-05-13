import fs from "fs";
import path from "path";
import {
  PrismaClient,
  MaterialCategories,
  MaterialSourceTypes,
  AlchemySubTypes,
  RestockType,
  CharacterMaterialType,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Types miroir du JSON source
// ---------------------------------------------------------------------------

interface RecipeIngredientJson {
  item: string;
  quantity: number;
}

interface AlchemyRecipeJson {
  subtype: string;
  resultQuantity: number;
  ingredients: RecipeIngredientJson[];
}

interface MaterialSourceJson {
  type: string;
  minimumLevel?: number;
  names?: string[];
  recipes?: AlchemyRecipeJson[];
}

interface MaterialSellerJson {
  name: string;
  currency: string;
  cost: number;
  stock: number;
  restock: string;
}

interface MaterialJson {
  name: string;
  rarity: number;
  categories: string[];
  description: string;
  sources: MaterialSourceJson[];
  usedIn: string[];
  usedByCharacters: {
    ascension: string[];
    talent: string[];
  };
  usedByWeapons: string[];
  sellers: MaterialSellerJson[];
}

// ---------------------------------------------------------------------------
// Chargement des fichiers
// Structure attendue :
//   data/materials/
//     nagadus_emerald_chunk/
//       en.json
//       fr.json   (optionnel)
//     ...
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, "../data/materials");

function loadAllMaterials(): { en: MaterialJson; fr?: MaterialJson }[] {
  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`⚠️  Dossier introuvable : ${DATA_DIR}`);
    return [];
  }

  return fs
    .readdirSync(DATA_DIR)
    .filter((entry) =>
      fs.statSync(path.join(DATA_DIR, entry)).isDirectory()
    )
    .map((dir) => {
      const enPath = path.join(DATA_DIR, dir, "en.json");
      const frPath = path.join(DATA_DIR, dir, "fr.json");

      if (!fs.existsSync(enPath)) {
        console.warn(`⚠️  Fichier EN manquant pour : ${dir}`);
        return null;
      }

      return {
        en: JSON.parse(fs.readFileSync(enPath, "utf-8")) as MaterialJson,
        fr: fs.existsSync(frPath)
          ? (JSON.parse(fs.readFileSync(frPath, "utf-8")) as MaterialJson)
          : undefined,
      };
    })
    .filter((m): m is { en: MaterialJson; fr: MaterialJson | undefined } => m !== null);
}

// ---------------------------------------------------------------------------
// Suppression en cascade des sources (ingrédients → recettes → sources)
// ---------------------------------------------------------------------------

async function deleteSourcesForMaterial(
  prisma: PrismaClient,
  materialId: number,
): Promise<void> {
  const alchemySources = await prisma.materialSource.findMany({
    where: { materialId, type: "ALCHEMY" as MaterialSourceTypes },
    include: { recipes: { select: { id: true } } },
  });

  const recipeIds = alchemySources.flatMap((s) => s.recipes.map((r) => r.id));

  if (recipeIds.length > 0) {
    await prisma.recipeIngredient.deleteMany({
      where: { recipeId: { in: recipeIds } },
    });
    await prisma.alchemyRecipe.deleteMany({
      where: { id: { in: recipeIds } },
    });
  }

  await prisma.materialSource.deleteMany({
    where: { materialId },
  });
}

// ---------------------------------------------------------------------------
// Seeder principal
// ---------------------------------------------------------------------------

export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  const materials = loadAllMaterials();

  if (materials.length === 0) {
    console.log("ℹ️  Aucun matériau trouvé, seed ignoré.");
    return;
  }

  console.log(`🌱 Seeding ${materials.length} material(s)…`);

  for (const { en: enData, fr: frData } of materials) {
    console.log(`  → ${enData.name}`);

    // ------------------------------------------------------------------
    // 1. Upsert du Material racine (données canoniques depuis EN)
    // ------------------------------------------------------------------
    const material = await prisma.material.upsert({
      where: { name: enData.name },
      update: {
        rarity: enData.rarity,
        categories: enData.categories as MaterialCategories[],
      },
      create: {
        name: enData.name,
        rarity: enData.rarity,
        categories: enData.categories as MaterialCategories[],
      },
    });

    // ------------------------------------------------------------------
    // 2. Traductions (upsert par lang)
    // ------------------------------------------------------------------
    await prisma.materialTranslation.upsert({
      where: { materialId_lang: { materialId: material.id, lang: "en" } },
      update: {
        name: enData.name,
        description: enData.description ?? null,
      },
      create: {
        materialId: material.id,
        lang: "en",
        name: enData.name,
        description: enData.description ?? null,
      },
    });

    if (frData) {
      await prisma.materialTranslation.upsert({
        where: { materialId_lang: { materialId: material.id, lang: "fr" } },
        update: {
          name: frData.name,
          description: frData.description ?? null,
        },
        create: {
          materialId: material.id,
          lang: "fr",
          name: frData.name,
          description: frData.description ?? null,
        },
      });
    }

    // ------------------------------------------------------------------
    // 3. Sources (suppression en cascade + recreate)
    // ------------------------------------------------------------------
    await deleteSourcesForMaterial(prisma, material.id);

    for (const source of enData.sources) {
      if (source.type === "ALCHEMY") {
        const createdSource = await prisma.materialSource.create({
          data: {
            materialId: material.id,
            type: source.type as MaterialSourceTypes,
            minimumLevel: source.minimumLevel ?? null,
            names: [],
          },
        });

        for (const recipe of source.recipes ?? []) {
          await prisma.alchemyRecipe.create({
            data: {
              sourceId: createdSource.id,
              subtype: recipe.subtype as AlchemySubTypes,
              resultQuantity: recipe.resultQuantity,
              ingredients: {
                create: recipe.ingredients.map((ing) => ({
                  item: ing.item,
                  quantity: ing.quantity,
                })),
              },
            },
          });
        }
      } else {
        await prisma.materialSource.create({
          data: {
            materialId: material.id,
            type: source.type as MaterialSourceTypes,
            minimumLevel: source.minimumLevel ?? null,
            names: source.names ?? [],
          },
        });
      }
    }

    // ------------------------------------------------------------------
    // 4. Sellers (delete + recreate)
    // ------------------------------------------------------------------
    await prisma.materialSeller.deleteMany({
      where: { materialId: material.id },
    });

    for (const seller of enData.sellers) {
      await prisma.materialSeller.create({
        data: {
          materialId: material.id,
          name: seller.name,
          currency: seller.currency,
          cost: seller.cost,
          stock: seller.stock,
          restock: seller.restock as RestockType,
        },
      });
    }

    // ------------------------------------------------------------------
    // 5. MaterialUse (delete + recreate)
    // ------------------------------------------------------------------
    await prisma.materialUse.deleteMany({
      where: { materialId: material.id },
    });

    for (const itemName of enData.usedIn) {
      await prisma.materialUse.create({
        data: { materialId: material.id, itemName },
      });
    }

    // ------------------------------------------------------------------
    // 6. CharacterMaterialUse (delete + recreate)
    // ------------------------------------------------------------------
    await prisma.characterMaterialUse.deleteMany({
      where: { materialId: material.id },
    });

    for (const characterName of enData.usedByCharacters.ascension) {
      await prisma.characterMaterialUse.create({
        data: {
          materialId: material.id,
          characterName,
          type: "ASCENSION" as CharacterMaterialType,
        },
      });
    }

    for (const characterName of enData.usedByCharacters.talent) {
      await prisma.characterMaterialUse.create({
        data: {
          materialId: material.id,
          characterName,
          type: "TALENT" as CharacterMaterialType,
        },
      });
    }
  }

  console.log("✅ Materials seedés avec succès.");
}