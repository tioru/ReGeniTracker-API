import { FeaturedRoles } from "@prisma/client";
import { WeaponRaritySplitOut } from "../../model/out/banner/weaponRaritySplit";
import { BannerWeaponWithRelations, emptyWeaponSplit, rarityKey, weaponName } from "./banner";

export function mapWeaponSplit(entries: BannerWeaponWithRelations[], role: FeaturedRoles, language: string): WeaponRaritySplitOut {
    const split = emptyWeaponSplit();

    for (const entry of entries) {
        if (entry.role !== role) continue;
        const key = rarityKey(entry.rarity);
        if (!key) continue;
        split[key].push(weaponName(entry, language));
    }

    return split;
}