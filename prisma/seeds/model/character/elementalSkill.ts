import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";

export interface ElementalSkillData {
    unlock: UnlockTypes;
    name: string;
    note: string;
    descriptions: DescriptionData[];
    upgrades: {
        name: string;
        values: string[];
    }[];
}