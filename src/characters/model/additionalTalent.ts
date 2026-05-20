import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";

export interface AdditionalTalentOut {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionOut[];
}