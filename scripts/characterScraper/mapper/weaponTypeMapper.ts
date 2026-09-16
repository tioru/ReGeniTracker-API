import { WeaponType } from "../models/weaponType";

export function mapWeaponType(rawWeaponType: string): WeaponType {
    switch (rawWeaponType.toLowerCase()) {
        case "bow": return WeaponType.BOW;
        case "catalyst": return WeaponType.CATALYST;
        case "claymore": return WeaponType.CLAYMORE;
        case "polearm": return WeaponType.POLEARM;
        case "sword": return WeaponType.SWORD;
        default: throw new Error(`Unknown weapon type: ${rawWeaponType}`);
    }
}