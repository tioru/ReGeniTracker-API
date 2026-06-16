import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";

export interface AscensionTalentOut {
    unlock: UnlockTypes | null;
    name: string;
    descriptions: DescriptionOut[];
}