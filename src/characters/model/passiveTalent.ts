import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";
import { AttributeItemOut } from "./attributeItem";

export interface PassiveTalentOut {
    unlock: UnlockTypes| null;
    name: string;
    descriptions: DescriptionOut[];
    attributes: AttributeItemOut[];
}