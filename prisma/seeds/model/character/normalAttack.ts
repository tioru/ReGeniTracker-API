import { UnlockTypes } from "@prisma/client";

export interface NormalAttackData {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string;
        description: string;
    }[];
    upgrades: {
        name: string;
        values: string[];
    }[];
}