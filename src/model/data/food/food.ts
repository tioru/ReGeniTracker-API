import { FoodCategory, FoodRecipeType } from "@prisma/client";
import { FoodTieredTextData } from "./foodTieredText";
import { FoodEffectVariableData } from "./foodEffectVariable";
import { FoodIngredientData } from "./foodIngredient";
import { FoodSellerData } from "./foodSeller";
import { FoodSpecialDishData } from "./foodSpecialDish";

export interface FoodData {
    pageTitle: string;
    name: string;
    rarity: number;
    category: FoodCategory;
    effectType: string;
    descriptions: FoodTieredTextData;
    effectTexts: FoodTieredTextData;
    effectVariables: FoodEffectVariableData[];
    region: string | null;
    recipeHint: string | null;
    recipeSubtype: FoodRecipeType | null;
    ingredients: FoodIngredientData[];
    sources: string[];
    sellers: FoodSellerData[];
    specialDish: FoodSpecialDishData | null;
    character: string | null;
    baseDish: string | null;
}
