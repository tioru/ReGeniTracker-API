import { UnlockTypes } from "@prisma/client";

export interface AscensionTalent {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
}