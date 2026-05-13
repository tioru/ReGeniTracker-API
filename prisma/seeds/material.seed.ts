import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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
  type: "BOSS" | "WEEKLY_BOSS" | "ALCHEMY";
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
// Helpers
// ---------------------------------------------------------------------------

const MATERIALS_DIR = path.resolve(__dirname, "../data/materials");

function loadMaterialFiles(): MaterialJson[] {
  if (!fs.existsSync(MATERIALS_DIR)) {
    console.warn(`⚠️  Dossier introuvable : ${MATERIALS_DIR}`);
    return [];
  }

  return fs
    .readdirSync(MATERIALS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(MATERIALS_DIR, f), "utf-8");
      return JSON.parse(raw) as MaterialJson;
    });
}

// ---------------------------------------------------------------------------
// Seeder principal
// ---------------------------------------------------------------------------

export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  const materials = loadMaterialFiles();

  if (materials.length === 0) {
    console.log("ℹ️  Aucun fichier material trouvé, seed ignoré.");
    return;
  }

  console.log(`🌱 Seeding ${materials.length} material(s)…`);

  for (const mat of materials) {
    console.log(`  → ${mat.name}`);

    // ------------------------------------------------------------------
    // 1. Upsert du Material racine
    // ------------------------------------------------------------------
    await prisma.material.upsert({
      where: { name: mat.name },
      update: {
        rarity: mat.rarity,
        categories: mat.categories,
        description: mat.description,
      },
      create: {
        name: mat.name,
        rarity: mat.rarity,
        categories: mat.categories,
        description: mat.description,
      },
    });

    // ------------------------------------------------------------------
    // 2. Sources  (delete + recreate pour rester idempotent)
    // ------------------------------------------------------------------
    await prisma.materialSource.deleteMany({
      where: { materialName: mat.name },
    });

    for (const source of mat.sources) {
      if (source.type === "ALCHEMY") {
        // Source alchimie : on crée la source puis ses recettes
        const createdSource = await prisma.materialSource.create({
          data: {
            materialName: mat.name,
            type: source.type,
            minimumLevel: source.minimumLevel ?? null,
            names: [],
          },
        });

        for (const recipe of source.recipes ?? []) {
          await prisma.alchemyRecipe.create({
            data: {
              sourceId: createdSource.id,
              subtype: recipe.subtype,
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
        // Source BOSS / WEEKLY_BOSS
        await prisma.materialSource.create({
          data: {
            materialName: mat.name,
            type: source.type,
            minimumLevel: source.minimumLevel ?? null,
            names: source.names ?? [],
          },
        });
      }
    }

    // ------------------------------------------------------------------
    // 3. Sellers  (delete + recreate)
    // ------------------------------------------------------------------
    await prisma.materialSeller.deleteMany({
      where: { materialName: mat.name },
    });

    for (const seller of mat.sellers) {
      await prisma.materialSeller.create({
        data: {
          materialName: mat.name,
          name: seller.name,
          currency: seller.currency,
          cost: seller.cost,
          stock: seller.stock,
          restock: seller.restock,
        },
      });
    }

    // ------------------------------------------------------------------
    // 4. MaterialUse – objets craftés à partir de ce matériau
    //    (référence par itemName, pas de FK)
    // ------------------------------------------------------------------
    await prisma.materialUse.deleteMany({
      where: { materialName: mat.name },
    });

    for (const itemName of mat.usedIn) {
      await prisma.materialUse.create({
        data: {
          materialName: mat.name,
          itemName,
        },
      });
    }

    // ------------------------------------------------------------------
    // 5. CharacterMaterialUse – personnages utilisant ce matériau
    // ------------------------------------------------------------------
    await prisma.characterMaterialUse.deleteMany({
      where: { materialName: mat.name },
    });

    for (const characterName of mat.usedByCharacters.ascension) {
      await prisma.characterMaterialUse.create({
        data: {
          materialName: mat.name,
          characterName,
          type: "ASCENSION",
        },
      });
    }

    for (const characterName of mat.usedByCharacters.talent) {
      await prisma.characterMaterialUse.create({
        data: {
          materialName: mat.name,
          characterName,
          type: "TALENT",
        },
      });
    }
  }

  console.log("✅ Materials seedés avec succès.");
}