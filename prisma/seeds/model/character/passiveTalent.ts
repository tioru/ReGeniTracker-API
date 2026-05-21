import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";
import { AttributeItemData } from "./attributeItem";

export interface PassiveTalentData {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionData[];
    attributes: AttributeItemData[];
}