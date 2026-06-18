import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WeaponHelper } from './helper/weapon/weaponHelper';
import { WeaponHelperImpl } from './helper/weapon/weaponHelperImpl';
import { WeaponData } from '../../src/model/data/weapon/weapon';
import { DEFAULT_LANG } from '../../constants';

const WEAPONS_DIR = "../data/weapons";

export async function seedWeapons(prisma: PrismaClient) : Promise<void> {
  const weaponHelper : WeaponHelper = new WeaponHelperImpl();

  const weaponsDir = path.resolve(__dirname, WEAPONS_DIR);
  const weaponNames : string[] = fs.readdirSync(path.resolve(weaponsDir, DEFAULT_LANG)).map((file : string) =>
    path.basename(file, '.json'),
  );

  for (const weaponName of weaponNames) {
    const enWeaponData = weaponHelper.loadJson(path.resolve(weaponsDir, DEFAULT_LANG, `${weaponName}.json`));
    const translations: { language: string; weaponData: WeaponData }[] = [{ language: DEFAULT_LANG, weaponData: enWeaponData }];
    const languages = fs.readdirSync(weaponsDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `${WEAPONS_DIR}/${language}/${weaponName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, weaponData: weaponHelper.loadJson(path.resolve(weaponsDir, language, `${weaponName}.json`)) });
      }
    }

    console.log(`\n→ Seeding weapon: ${translations[0].weaponData.name}`);
    
    await weaponHelper.seedWeapon(prisma, translations);
  }

  console.log('\n✅ Weapons seeded.');
}