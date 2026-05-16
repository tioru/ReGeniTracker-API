import { UnlockTypes } from "@prisma/client";

export interface AdditionalTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
}