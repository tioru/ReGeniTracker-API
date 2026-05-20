import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";

export interface PassiveTalentOut {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionOut[];
    attributes: {
        name: string;
        value: string;
    }[];
}