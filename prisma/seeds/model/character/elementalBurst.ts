import { UnlockTypes } from "@prisma/client";

export interface ElementalBurst {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
    upgrades: {
        name: string;
        values: string[];
    }[];
}