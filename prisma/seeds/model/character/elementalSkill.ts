import { UnlockTypes } from "@prisma/client";

export interface ElementalSkillData {
    unlock: UnlockTypes;
    name: string;
    note: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
    upgrades: {
        name: string;
        values: string[];
    }[];
}