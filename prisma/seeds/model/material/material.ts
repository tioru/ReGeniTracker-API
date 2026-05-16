import { MaterialCategories } from "@prisma/client";
import { MaterialSourceData } from "./materialSource";

export interface MaterialData {
    name: string;
    rarity: number;
    categories: MaterialCategories[];
    description: string;
    sources: MaterialSourceData[];
}