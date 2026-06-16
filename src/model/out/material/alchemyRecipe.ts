import { RecipeIngredientOut } from "./recipeIngredient";

export interface AlchemyRecipeOut {
    subtype: string;
    resultQuantity: number;
    ingredients: RecipeIngredientOut[];
}