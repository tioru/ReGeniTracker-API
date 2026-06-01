import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";

export interface AdditionalTalentOut {
    unlock: UnlockTypes | null;
    name: string;
    descriptions: DescriptionOut[];
}