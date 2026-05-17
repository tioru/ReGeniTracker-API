import * as fs from 'node:fs';
import * as path from 'node:path';
import { MaterialHelper } from "./materialHelper";
import { MaterialData } from "../../model/material/material";
import { MaterialCategories, MaterialSourceTypes, PrismaClient } from "@prisma/client";

const BUFFER_ENCODING = 'utf-8';
const ENGLISH_INDEX = 0;

export class MaterialHelperImpl implements MaterialHelper {
    public loadJson(filePath: string): MaterialData {
        const fullPath = path.resolve(__dirname, filePath);
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as MaterialData;
    }

    public async upsertMaterial(prisma: PrismaClient, materialData: MaterialData) : Promise<{id: number; name: string; rarity: number | null; categories: MaterialCategories[];}>{
        return prisma.material.upsert({
            where: { name: materialData.name },
            update: {
              rarity: materialData.rarity,
              categories: materialData.categories,
            },
            create: {
              name: materialData.name,
              rarity: materialData.rarity,
              categories: materialData.categories,
            },
        });
    }

    public async upsertMaterialTranslations(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[],): Promise<void> {
        for (const { language, materialData } of translations) {
          await prisma.materialTranslation.upsert({
            where: { materialId_language: { materialId: materialId, language: language } },
            update: {
              name: materialData.name,
              description: materialData.description ?? null,
            },
            create: {
              materialId,
              language: language,
              name: materialData.name,
              description: materialData.description ?? null,
            },
          });
        }
    }

    public async deleteSourcesForMaterial(prisma: PrismaClient, materialId: number): Promise<void> {
        const alchemySources = await prisma.materialSource.findMany({
            where: { materialId, type: MaterialSourceTypes.ALCHEMY },
            include: { recipes: { select: { id: true } } },
        });
    
        const recipeIds = alchemySources.flatMap((source) => source.recipes.map((recipe) => recipe.id));
    
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

    public async sourcesRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void> {
        await this.deleteSourcesForMaterial(prisma, materialId);

        const enSources = translations[ENGLISH_INDEX].materialData.sources;
        
        for (let sourceIndex = 0; sourceIndex < enSources.length; sourceIndex++) {
            const enSource = enSources[sourceIndex];

            const createdSource = await prisma.materialSource.create({
                data: {
                    materialId,
                    type: enSource.type,
                    minimumLevel: enSource.minimumLevel,
                },
            });
        
            if (enSource.type === MaterialSourceTypes.ALCHEMY) {
                // If type === ALCHEMY, recipes are obligatory
                if (!enSource.recipes) {
                    throw new Error(`Alchemy source on object ${translations[ENGLISH_INDEX].materialData.name}, at index ${sourceIndex} must have recipes`);
                }

                const enRecipes = enSource.recipes;

                for (let recipeIndex = 0; recipeIndex < enRecipes.length; recipeIndex++) {
                    const enRecipe = enRecipes[recipeIndex];

                    const createdRecipe = await prisma.alchemyRecipe.create({
                      data: {
                        sourceId: createdSource.id,
                        subtype: enRecipe.subtype,
                        resultQuantity: enRecipe.resultQuantity,
                      },
                    });
                
                    for (let ingredientIndex = 0; ingredientIndex < enRecipe.ingredients.length; ingredientIndex++) {
                        const enIngredient = enRecipe.ingredients[ingredientIndex];
                        
                        const createdIngredient = await prisma.recipeIngredient.create({
                            data: {
                                recipeId: createdRecipe.id,
                                quantity: enIngredient.quantity,
                            },
                        });
                      
                        for (const { language, materialData } of translations) {
                            const item = materialData.sources[sourceIndex]?.recipes?.[recipeIndex]?.ingredients[ingredientIndex]?.item ?? enIngredient.item;
                            await prisma.recipeIngredientTranslation.create({
                                data: { ingredientId: createdIngredient.id, language: language, item },
                            });
                        }
                    }
                }
            } else {
                for (const { language, materialData } of translations) {
                    const names = materialData.sources[sourceIndex]?.names ?? enSource.names ?? [];
                    await prisma.materialSourceTranslation.create({
                        data: { sourceId: createdSource.id, language: language, names },
                    });
                }
            }
        }
    }

    public async seedMaterial(prisma: PrismaClient, translations: { language: string; materialData: MaterialData }[]): Promise<void> {
        const material = await this.upsertMaterial(prisma, translations[0].materialData);
        console.log(`Material upserted (id: ${material.id})`);

        await this.upsertMaterialTranslations(prisma, material.id , translations);
        console.log(`MaterialTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        await this.sourcesRecreate(prisma, material.id, translations);
        console.log(`Sources recreated (${translations.map((translation) => translation.language).join(', ')})`);
        
    }
}