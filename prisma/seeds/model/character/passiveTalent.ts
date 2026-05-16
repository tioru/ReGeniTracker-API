import { UnlockTypes } from "@prisma/client";

export interface PassiveTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
    attributes: {
        name: string;
        value: string;
    }[];
}