import { UnlockTypes } from "@prisma/client";

export interface AdditionalTalent {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
}