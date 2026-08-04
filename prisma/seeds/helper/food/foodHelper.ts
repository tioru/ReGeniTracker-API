import { PrismaClient } from "@prisma/client";
import { FoodData } from "../../../../src/model/data/food/food";

export interface FoodHelper {
  loadJson(filePath: string): FoodData;
  upsertFood(prisma: PrismaClient, foodData: FoodData): Promise<{ id: number }>;
  upsertFoodTranslations(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void>;
  ingredientsRecreate(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void>;
  sellersRecreate(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void>;
  effectVariablesRecreate(prisma: PrismaClient, foodId: number, translations: { language: string; foodData: FoodData }[]): Promise<void>;
  seedFood(prisma: PrismaClient, translations: { language: string; foodData: FoodData }[]): Promise<{ id: number }>;
  linkFoodRelations(prisma: PrismaClient, enFoodData: FoodData): Promise<void>;
}
