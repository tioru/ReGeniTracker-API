import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from 'node:url';

export const DEFAULT_LANG = 'en';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadAllMaterials(prisma: PrismaClient) : Promise<void> {
  const materialHelperImpl = new MaterialHelperImpl();
  
  const charactersDir = path.resolve(__dirname, '../data/characters');
  const characterNames : string[] = fs.readdirSync(path.resolve(charactersDir, DEFAULT_LANG)).map((file : string) =>
    path.basename(file, '.json'),
  );

  return fs
    .readdirSync(DATA_DIR)
    .filter((entry) => fs.statSync(path.join(DATA_DIR, entry)).isDirectory())
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
// Suppression en cascade des sources
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
    await prisma.recipeIngredientTranslation.deleteMany({
      where: { ingredient: { recipeId: { in: recipeIds } } },
    });
    await prisma.recipeIngredient.deleteMany({
      where: { recipeId: { in: recipeIds } },
    });
    await prisma.alchemyRecipe.deleteMany({
      where: { id: { in: recipeIds } },
    });
  }

  await prisma.materialSourceTranslation.deleteMany({
    where: { source: { materialId } },
  });
  await prisma.materialSource.deleteMany({ where: { materialId } });
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
    // 1. Upsert Material racine (données canoniques EN)
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
    // 2. MaterialTranslation (name + description)
    // ------------------------------------------------------------------
    for (const lang of LANGS) {
      const t = getLang(enData, frData, lang);
      await prisma.materialTranslation.upsert({
        where: { materialId_lang: { materialId: material.id, lang } },
        update: { name: t.name, description: t.description ?? null },
        create: {
          materialId: material.id,
          lang,
          name: t.name,
          description: t.description ?? null,
        },
      });
    }

    // ------------------------------------------------------------------
    // 3. Sources + traductions (suppression en cascade + recreate)
    // ------------------------------------------------------------------
    await deleteSourcesForMaterial(prisma, material.id);

    for (let si = 0; si < enData.sources.length; si++) {
      const enSource = enData.sources[si];
      const frSource = frData?.sources[si];

      if (enSource.type === "ALCHEMY") {
        const createdSource = await prisma.materialSource.create({
          data: {
            materialId: material.id,
            type: enSource.type as MaterialSourceTypes,
            minimumLevel: enSource.minimumLevel ?? null,
          },
        });

        // Pas de traduction pour ALCHEMY (pas de names)

        for (let ri = 0; ri < (enSource.recipes ?? []).length; ri++) {
          const enRecipe = enSource.recipes![ri];

          const createdRecipe = await prisma.alchemyRecipe.create({
            data: {
              sourceId: createdSource.id,
              subtype: enRecipe.subtype as AlchemySubTypes,
              resultQuantity: enRecipe.resultQuantity,
            },
          });

          for (let ii = 0; ii < enRecipe.ingredients.length; ii++) {
            const enIng = enRecipe.ingredients[ii];
            const frIng = frData?.sources[si]?.recipes?.[ri]?.ingredients[ii];

            const createdIngredient = await prisma.recipeIngredient.create({
              data: {
                recipeId: createdRecipe.id,
                quantity: enIng.quantity,
              },
            });

            for (const lang of LANGS) {
              const item = lang === "fr" && frIng ? frIng.item : enIng.item;
              await prisma.recipeIngredientTranslation.create({
                data: {
                  ingredientId: createdIngredient.id,
                  lang,
                  item,
                },
              });
            }
          }
        }
      } else {
        // BOSS / WEEKLY_BOSS
        const createdSource = await prisma.materialSource.create({
          data: {
            materialId: material.id,
            type: enSource.type as MaterialSourceTypes,
            minimumLevel: enSource.minimumLevel ?? null,
          },
        });

        for (const lang of LANGS) {
          const names =
            lang === "fr" && frSource?.names
              ? frSource.names
              : (enSource.names ?? []);

          await prisma.materialSourceTranslation.create({
            data: {
              sourceId: createdSource.id,
              lang,
              names,
            },
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. Sellers + traductions
    // ------------------------------------------------------------------
    const existingSellers = await prisma.materialSeller.findMany({
      where: { materialId: material.id },
      select: { id: true },
    });
    const sellerIds = existingSellers.map((s) => s.id);
    if (sellerIds.length > 0) {
      await prisma.materialSellerTranslation.deleteMany({
        where: { sellerId: { in: sellerIds } },
      });
      await prisma.materialSeller.deleteMany({
        where: { id: { in: sellerIds } },
      });
    }

    for (let si = 0; si < enData.sellers.length; si++) {
      const enSeller = enData.sellers[si];
      const frSeller = frData?.sellers[si];

      const createdSeller = await prisma.materialSeller.create({
        data: {
          materialId: material.id,
          cost: enSeller.cost,
          stock: enSeller.stock,
          restock: enSeller.restock as RestockType,
        },
      });

      for (const lang of LANGS) {
        const s = lang === "fr" && frSeller ? frSeller : enSeller;
        await prisma.materialSellerTranslation.create({
          data: {
            sellerId: createdSeller.id,
            lang,
            name: s.name,
            currency: s.currency,
          },
        });
      }
    }

    // ------------------------------------------------------------------
    // 5. MaterialUse + traductions
    // ------------------------------------------------------------------
    const existingUses = await prisma.materialUse.findMany({
      where: { materialId: material.id },
      select: { id: true },
    });
    const useIds = existingUses.map((u) => u.id);
    if (useIds.length > 0) {
      await prisma.materialUseTranslation.deleteMany({
        where: { useId: { in: useIds } },
      });
      await prisma.materialUse.deleteMany({
        where: { id: { in: useIds } },
      });
    }

    for (let ui = 0; ui < enData.usedIn.length; ui++) {
      const enItem = enData.usedIn[ui];
      const frItem = frData?.usedIn[ui];

      const createdUse = await prisma.materialUse.create({
        data: { materialId: material.id },
      });

      for (const lang of LANGS) {
        const itemName = lang === "fr" && frItem ? frItem : enItem;
        await prisma.materialUseTranslation.create({
          data: { useId: createdUse.id, lang, itemName },
        });
      }
    }

    // ------------------------------------------------------------------
    // 6. CharacterMaterialUse (FK vers Character)
    // ------------------------------------------------------------------
    await prisma.characterMaterialUse.deleteMany({
      where: { materialId: material.id },
    });

    const allCharacterNames = [
      ...enData.usedByCharacters.ascension.map((n) => ({ name: n, type: "ASCENSION" as CharacterMaterialType })),
      ...enData.usedByCharacters.talent.map((n) => ({ name: n, type: "TALENT" as CharacterMaterialType })),
    ];

    for (const { name, type } of allCharacterNames) {
      const character = await prisma.character.findUnique({
        where: { name },
        select: { id: true },
      });

      if (!character) {
        console.warn(`    ⚠️  Personnage introuvable : ${name}`);
        continue;
      }

      await prisma.characterMaterialUse.create({
        data: {
          materialId: material.id,
          characterId: character.id,
          type,
        },
      });
    }
  }

  console.log("✅ Materials seedés avec succès.");
}