import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";

export interface AscensionTalentOut {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionOut[];
}