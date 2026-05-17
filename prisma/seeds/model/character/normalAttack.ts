import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";

export interface NormalAttackData {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionData[];
    upgrades: {
        name: string;
        values: string[];
    }[];
}