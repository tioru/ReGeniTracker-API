import { MaterialCategories } from "@prisma/client";
import { MaterialSourceData } from "./materialSource";
import { CharacterMaterialUseData } from "./characterMaterialUse";
import { MaterialSellerData } from "./materialSeller";

export interface MaterialData {
    name: string;
    rarity: number;
    categories: MaterialCategories[];
    description: string;
    sources: MaterialSourceData[];
    usedIn: string;
    usedByCharacters: CharacterMaterialUseData;
    usedByWeapons: string[];
    sellers: MaterialSellerData[];
}