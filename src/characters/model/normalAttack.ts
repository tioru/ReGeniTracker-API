import { UnlockTypes } from "@prisma/client";
import { DescriptionOut } from "./description";
import { UpgradeItemOut } from "./upgradeItem";

export interface NormalAttackOut {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionOut[];
    upgrades: UpgradeItemOut[];
}