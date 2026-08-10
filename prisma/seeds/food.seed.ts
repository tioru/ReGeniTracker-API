import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { FoodHelperImpl } from "./helper/food/foodHelperImpl";
import { FoodData } from "../../src/model/data/food/food";
import { FoodHelper } from "./helper/food/foodHelper";
import { DEFAULT_LANG } from "../../constants";

const FOOD_DIR = "../data/foods";

export async function seedFood(prisma: PrismaClient): Promise<void> {
  const foodHelper: FoodHelper = new FoodHelperImpl();

  const foodDir = path.resolve(__dirname, FOOD_DIR);
  const foodFileNames: string[] = fs.readdirSync(path.resolve(foodDir, DEFAULT_LANG))
    .filter((file: string) => file.endsWith(".json"))
    .map((file: string) => path.basename(file, ".json"));

  const enFoodDataList: FoodData[] = [];

  for (const foodFileName of foodFileNames) {
    const enFoodData: FoodData = foodHelper.loadJson(path.resolve(foodDir, DEFAULT_LANG, `${foodFileName}.json`));
    const translations: { language: string; foodData: FoodData }[] = [{ language: DEFAULT_LANG, foodData: enFoodData }];
    const languages = fs.readdirSync(foodDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const fullPath = path.resolve(foodDir, language, `${foodFileName}.json`);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, foodData: foodHelper.loadJson(fullPath) });
      }
    }

    console.log(`\n→ Seeding food: ${enFoodData.name}`);

    await foodHelper.seedFood(prisma, translations);
    enFoodDataList.push(enFoodData);
  }

  // 2e passe : les plats "de base" et personnages référencés par baseDish/
  // character ne sont pas forcément tous seedés au moment où on traite un
  // plat spécial donné (cf. NOTE en tête de prisma/schema/food.prisma) — on
  // ne les résout qu'une fois que TOUS les plats existent en base.
  for (const enFoodData of enFoodDataList) {
    if (enFoodData.baseDish || enFoodData.character) {
      await foodHelper.linkFoodRelations(prisma, enFoodData);
    }
  }

  console.log("\n✅ Food seeded.");
}
