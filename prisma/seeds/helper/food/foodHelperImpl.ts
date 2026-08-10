import * as fs from 'node:fs';
import { FoodHelper } from "./foodHelper";
import { FoodData } from "../../../../src/model/data/food/food";
import { PrismaClient } from "@prisma/client";
import { BUFFER_ENCODING, DEFAULT_LANG, ENGLISH_INDEX } from '../../../../constants';

export class FoodHelperImpl implements FoodHelper {
    public loadJson(fullPath: string): FoodData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as FoodData;
    }

    public async upsertFood(prisma: PrismaClient, foodData: FoodData): Promise<{ id: number }> {
        return prisma.food.upsert({
            where: { pageTitle: foodData.pageTitle },
            update: {
              rarity: foodData.rarity,
              category: foodData.category,
              effectType: foodData.effectType || null,
              region: foodData.region,
              recipeSubtype: foodData.recipeSubtype,
              imgNormal: foodData.assets.NORMAL,
              imgDelicious: foodData.assets.DELICIOUS,
              imgSuspicious: foodData.assets.SUSPICIOUS,
            },
            create: {
              pageTitle: foodData.pageTitle,
              rarity: foodData.rarity,
              category: foodData.category,
              effectType: foodData.effectType || null,
              region: foodData.region,
              recipeSubtype: foodData.recipeSubtype,
              imgNormal: foodData.assets.NORMAL,
              imgDelicious: foodData.assets.DELICIOUS,
              imgSuspicious: foodData.assets.SUSPICIOUS,
            },
        });
    }

    public async upsertFoodTranslations(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void> {
        for (const { language, foodData } of translations) {
          await prisma.foodTranslation.upsert({
            where: { foodId_language: { foodId: foodId, language: language } },
            update: {
              name: foodData.name,
              descriptionNormal: foodData.descriptions.normal,
              descriptionSuspicious: foodData.descriptions.suspicious,
              descriptionDelicious: foodData.descriptions.delicious,
              effectTextNormal: foodData.effectTexts.normal,
              effectTextSuspicious: foodData.effectTexts.suspicious,
              effectTextDelicious: foodData.effectTexts.delicious,
              recipeHint: foodData.recipeHint,
              sources: foodData.sources,
            },
            create: {
              foodId,
              language: language,
              name: foodData.name,
              descriptionNormal: foodData.descriptions.normal,
              descriptionSuspicious: foodData.descriptions.suspicious,
              descriptionDelicious: foodData.descriptions.delicious,
              effectTextNormal: foodData.effectTexts.normal,
              effectTextSuspicious: foodData.effectTexts.suspicious,
              effectTextDelicious: foodData.effectTexts.delicious,
              recipeHint: foodData.recipeHint,
              sources: foodData.sources,
            },
          });
        }
    }

    public async ingredientsRecreate(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void> {
        const existingIngredients = await prisma.foodIngredient.findMany({
            where: { foodId },
            select: { id: true },
        });
        const ingredientIds = existingIngredients.map((ingredient) => ingredient.id);

        if (ingredientIds.length > 0) {
            await prisma.foodIngredientTranslation.deleteMany({
                where: { ingredientId: { in: ingredientIds } },
            });
            await prisma.foodIngredient.deleteMany({ where: { id: { in: ingredientIds } } });
        }

        const enIngredients = translations[ENGLISH_INDEX].foodData.ingredients;

        for (let ingredientIndex = 0; ingredientIndex < enIngredients.length; ingredientIndex++) {
            const enIngredient = enIngredients[ingredientIndex];

            const createdIngredient = await prisma.foodIngredient.create({
                data: { foodId, quantity: enIngredient.quantity },
            });

            for (const { language, foodData } of translations) {
                const item = foodData.ingredients[ingredientIndex]?.item ?? enIngredient.item;
                await prisma.foodIngredientTranslation.create({
                    data: { ingredientId: createdIngredient.id, language: language, item },
                });
            }
        }
    }

    public async sellersRecreate(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void> {
        const existingSellers = await prisma.foodSeller.findMany({
            where: { foodId },
            select: { id: true },
        });
        const sellerIds = existingSellers.map((seller) => seller.id);

        if (sellerIds.length > 0) {
            await prisma.foodSellerTranslation.deleteMany({
                where: { sellerId: { in: sellerIds } },
            });
            await prisma.foodSeller.deleteMany({ where: { id: { in: sellerIds } } });
        }

        const enFoodData = translations[ENGLISH_INDEX].foodData;

        for (let sellerIndex = 0; sellerIndex < enFoodData.sellers.length; sellerIndex++) {
            const enSeller = enFoodData.sellers[sellerIndex];

            const createdSeller = await prisma.foodSeller.create({
                data: {
                    foodId,
                    cost: enSeller.cost,
                    stock: enSeller.stock,
                    restock: enSeller.restock,
                },
            });

            for (const { language, foodData } of translations) {
                const seller = foodData.sellers[sellerIndex] ?? enSeller;
                await prisma.foodSellerTranslation.create({
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

    public async effectVariablesRecreate(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void> {
        await prisma.foodEffectVariable.deleteMany({ where: { foodId } });

        const enVariables = translations[ENGLISH_INDEX].foodData.effectVariables;

        for (const enVariable of enVariables) {
            await prisma.foodEffectVariable.create({
                data: {
                    foodId,
                    label: enVariable.label,
                    suspicious: enVariable.values.suspicious,
                    normal: enVariable.values.normal,
                    delicious: enVariable.values.delicious,
                },
            });
        }
    }

    public async seedFood(prisma: PrismaClient, translations: { language: string; foodData: FoodData }[]): Promise<{ id: number }> {
        const food = await this.upsertFood(prisma, translations[ENGLISH_INDEX].foodData);
        console.log(`Food upserted (id: ${food.id})`);

        await this.upsertFoodTranslations(prisma, food.id, translations);
        console.log(`FoodTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        await this.ingredientsRecreate(prisma, food.id, translations);
        console.log(`Ingredients recreated`);

        await this.sellersRecreate(prisma, food.id, translations);
        console.log(`Sellers recreated`);

        await this.effectVariablesRecreate(prisma, food.id, translations);
        console.log(`Effect variables recreated`);

        return food;
    }

    // 2e passe (cf. NOTE en tête de prisma/schema/food.prisma) : résout
    // baseDishId/characterId une fois que TOUS les plats existent en base,
    // car l'ordre alphabétique des fichiers ne garantit pas que le plat de
    // base d'une variante spéciale ait déjà été seedé (ex: "Hearty
    // Indulgence" avant "Northern Smoked Chicken").
    public async linkFoodRelations(prisma: PrismaClient, enFoodData: FoodData): Promise<void> {
        const updateData: { baseDishId?: number; characterId?: number } = {};

        if (enFoodData.baseDish) {
            const baseDish = await prisma.foodTranslation.findFirst({
                where: { language: DEFAULT_LANG, name: enFoodData.baseDish },
                select: { foodId: true },
            });
            if (baseDish) {
                updateData.baseDishId = baseDish.foodId;
            } else {
                console.warn(`⚠️  Plat de base introuvable : "${enFoodData.baseDish}" (pour "${enFoodData.name}")`);
            }
        }

        if (enFoodData.character) {
            const character = await prisma.character.findUnique({
                where: { name: enFoodData.character },
                select: { id: true },
            });
            if (character) {
                updateData.characterId = character.id;
            } else {
                console.warn(`⚠️  Personnage introuvable : "${enFoodData.character}" (pour "${enFoodData.name}")`);
            }
        }

        if (Object.keys(updateData).length > 0) {
            await prisma.food.update({
                where: { pageTitle: enFoodData.pageTitle },
                data: updateData,
            });
        }
    }
}
