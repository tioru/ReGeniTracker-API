import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";

export interface PassiveTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionData[];
    attributes: {
        name: string;
        value: string;
    }[];
}