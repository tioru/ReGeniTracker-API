import { AlchemyRecipeOut } from "./alchemyRecipe";

export interface MaterialSourceOut {
    type: string;
    minimumLevel?: number | null;
    names?: string[];
    recipes?: AlchemyRecipeOut[];
}