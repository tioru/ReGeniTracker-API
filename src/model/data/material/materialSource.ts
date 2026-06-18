import { MaterialSourceTypes } from "@prisma/client";
import { AlchemyRecipeData } from "./alchemyRecipe";
import { CharacterMaterialUseData } from "./characterMaterialUse";
import { MaterialSellerData } from "./materialSeller";

export interface MaterialSourceData {
    type: MaterialSourceTypes;
    minimumLevel?: number;
    names?: string[];
    recipes?: AlchemyRecipeData[];
    usedIn: string[];
    usedByCharacters: CharacterMaterialUseData;
    usedByWeapons: string[];
    sellers: MaterialSellerData[];
}