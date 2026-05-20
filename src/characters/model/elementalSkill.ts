import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";
import { UpgradeItemOut } from "./upgradeItem";

export interface ElementalSkillOut {
    unlock: UnlockTypes;
    name: string;
    note: string;
    descriptions: DescriptionOut[];
    upgrades: UpgradeItemOut[];
}