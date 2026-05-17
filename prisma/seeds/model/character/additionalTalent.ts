import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";

export interface AdditionalTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionData[];
}