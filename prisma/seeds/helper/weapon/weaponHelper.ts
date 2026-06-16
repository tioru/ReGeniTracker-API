import { PrismaClient } from "@prisma/client";

export interface WeaponHelper {
    loadJson(filePath: string): WeaponData;
    upsertWeapon();
    upsertWeaponTranslations();
    levelsRecreate();
    ascensionMaterialsRecreate();
    sellersRecreate();
    seedWeapon(prisma: PrismaClient, translations: { language: string; weaponData: WeaponData }[]): Promise<void>;
}