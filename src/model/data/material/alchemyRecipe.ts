import { AlchemySubTypes } from "@prisma/client";
import { IngredientData } from "./ingredient";

export interface AlchemyRecipeData {
    subtype: AlchemySubTypes;
    resultQuantity: number;
    ingredients: IngredientData[];
}