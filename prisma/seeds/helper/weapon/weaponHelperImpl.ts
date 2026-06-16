import { PrismaClient } from "@prisma/client";
import { WeaponHelper } from "./weaponHelper";
import { WeaponData } from "../../model/weapon/weapon";

export const BUFFER_ENCODING = 'utf-8';
const ENGLISH_INDEX = 0;

export class WeaponHelperImpl implements WeaponHelper {
    loadJson(filePath: string) {
        throw new Error("Method not implemented.");
    }

    public async seedWeapon( prisma: PrismaClient, translations: { language: string; weaponData: WeaponData }[]): Promise<void> {
        const weapon = await this.upsertWeapon(prisma, translations[ENGLISH_INDEX].weaponData);
        console.log(`Weapon upserted (id: ${weapon.id})`);
        
        await this.upsertWeaponTranslations(prisma, weapon.id, translations);
        console.log(`WeaponTranslations upserted (${translations.map((t) => t.language).join(', ')})`);
        
        await this.levelsRecreate(prisma, weapon.id, translations[ENGLISH_INDEX].weaponData);
        console.log(`Levels recreated`);
        
        await this.ascensionMaterialsRecreate(prisma, weapon.id, translations);
        console.log(`AscensionMaterials recreated`);
        
        await this.sellersRecreate(prisma, weapon.id, translations);
        console.log(`Sellers recreated`);
    }
}