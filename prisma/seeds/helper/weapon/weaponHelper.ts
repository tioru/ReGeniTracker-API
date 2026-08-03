import { PrismaClient, WeaponTypes } from "@prisma/client";
import { WeaponData } from "../../../../src/model/data/weapon/weapon";

export interface WeaponHelper {
    loadJson(filePath: string): WeaponData;
    upsertWeapon(prisma: PrismaClient, weaponData: WeaponData): Promise<{ id: number; name: string; rarity: number; type: WeaponTypes }>;
    upsertWeaponTranslations(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void>;
    levelsRecreate(prisma: PrismaClient, weaponId: number, weaponData: WeaponData): Promise<void>;
    ascensionMaterialsRecreate(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void>;
    sellersRecreate(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void>;
    refinementsRecreate(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void>;
    seedWeapon(prisma: PrismaClient, translations: { language: string; weaponData: WeaponData }[]): Promise<void>;
}