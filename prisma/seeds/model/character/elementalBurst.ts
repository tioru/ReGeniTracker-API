import { UnlockTypes } from "@prisma/client";
import { DescriptionData } from "./description";
import { UpgradeItemData } from "./upgradeItem";

export interface ElementalBurstData {
    unlock: UnlockTypes;
    name: string;
    note: string;
    descriptions: DescriptionData[];
    upgrades: UpgradeItemData[];
}