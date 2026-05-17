import * as fs from 'node:fs';
import { MaterialHelper } from "./materialHelper";
import { MaterialData } from "../../model/material/material";
import { CharacterMaterialType, MaterialCategories, MaterialSourceTypes, PrismaClient } from "@prisma/client";

const BUFFER_ENCODING = 'utf-8';
const ENGLISH_INDEX = 0;

export class MaterialHelperImpl implements MaterialHelper {
    public loadJson(fullPath: string): MaterialData {
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

    public async sellersRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void> {
        const existingSellers = await prisma.materialSeller.findMany({
            where: { materialId },
            select: { id: true },
        });
        const sellerIds = existingSellers.map((seller) => seller.id);
    
        if (sellerIds.length > 0) {
            await prisma.materialSellerTranslation.deleteMany({
                where: { sellerId: { in: sellerIds } },
            });
            await prisma.materialSeller.deleteMany({ where: { id: { in: sellerIds } } });
        }
    
        const enMaterialData = translations[ENGLISH_INDEX].materialData;
    
        for (let sellerIndex = 0; sellerIndex < enMaterialData.sellers.length; sellerIndex++) {
            const enSeller = enMaterialData.sellers[sellerIndex];
        
            const createdSeller = await prisma.materialSeller.create({
                data: {
                    materialId,
                    cost: enSeller.cost,
                    stock: enSeller.stock,
                    restock: enSeller.restock,
                },
            });
      
            for (const { language, materialData } of translations) {
                const seller = materialData.sellers[sellerIndex] ?? enSeller;
                await prisma.materialSellerTranslation.create({
                    data: {
                        sellerId: createdSeller.id,
                        language: language,
                        name: seller.name,
                        currency: seller.currency,
                    },
                });
            }
        }
    }

    public async usedInRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void> {
        const existingUses = await prisma.materialUse.findMany({
            where: { materialId },
            select: { id: true },
        });
        const useIds = existingUses.map((use) => use.id);
    
        if (useIds.length > 0) {
            await prisma.materialUseTranslation.deleteMany({
                where: { useId: { in: useIds } },
            });
            await prisma.materialUse.deleteMany({ where: { id: { in: useIds } } });
        }
    
        const enMaterialData = translations[ENGLISH_INDEX].materialData;
    
        for (let usedInIndex = 0; usedInIndex < enMaterialData.usedIn.length; usedInIndex++) {
            const createdUse = await prisma.materialUse.create({
                data: { materialId },
            });
          
            for (const { language, materialData } of translations) {
                const itemName = materialData.usedIn[usedInIndex] ?? enMaterialData.usedIn[usedInIndex];
                await prisma.materialUseTranslation.create({
                    data: { useId: createdUse.id, language: language, itemName },
                });
            }
        }
    }

    public async characterUsesRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void> {
        await prisma.characterMaterialUse.deleteMany({ where: { materialId } });
        
        const allUses = [
            ...translations[ENGLISH_INDEX].materialData.usedByCharacters.ascension.map((name) => ({
                name,
                type: CharacterMaterialType.ASCENSION,
            })),
            ...translations[ENGLISH_INDEX].materialData.usedByCharacters.talent.map((name) => ({
                name,
                type: CharacterMaterialType.TALENT,
            })),
        ];
 
        for (const { name, type } of allUses) {
            const character = await prisma.character.findUnique({
                where: { name },
                select: { id: true },
            });
          
            if (!character) {
                console.warn(`⚠️  Personnage introuvable : ${name}`);
                continue;
            }
      
            await prisma.characterMaterialUse.create({
                data: { materialId, characterId: character.id, type },
            });
        }
    }

    public async seedMaterial(prisma: PrismaClient, translations: { language: string; materialData: MaterialData }[]): Promise<void> {
        const material = await this.upsertMaterial(prisma, translations[ENGLISH_INDEX].materialData);
        console.log(`Material upserted (id: ${material.id})`);

        await this.upsertMaterialTranslations(prisma, material.id , translations);
        console.log(`MaterialTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        await this.sourcesRecreate(prisma, material.id, translations);
        console.log(`Sources recreated (${translations.map((translation) => translation.language).join(', ')})`);
        
        await this.sellersRecreate(prisma, material.id, translations);
        console.log(`Sellers recreated`);

        await this.usedInRecreate(prisma, material.id, translations);
        console.log(`UsedIn recreated`);

        await this.characterUsesRecreate(prisma, material.id, translations);
        console.log(`Character uses recreated`);
    }
}