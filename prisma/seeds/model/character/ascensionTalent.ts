import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";

export interface AscensionTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionData[];
}