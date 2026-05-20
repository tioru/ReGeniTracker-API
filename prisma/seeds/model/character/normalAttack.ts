import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";
import { UpgradeItemData } from "./upgradeItem";

export interface NormalAttackData {
    unlock: UnlockTypes;
    name: string;
    descriptions: DescriptionData[];
    upgrades: UpgradeItemData[];
}