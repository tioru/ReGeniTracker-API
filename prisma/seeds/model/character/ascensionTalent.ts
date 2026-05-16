import { UnlockTypes } from "@prisma/client";

export interface AscensionTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
}