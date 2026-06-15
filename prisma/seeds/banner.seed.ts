import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BannerHelper } from './helper/banner/bannerHelper';
import { BannerHelperImpl } from './helper/banner/bannerHelperImpl';

export const DEFAULT_LANG = 'en';
const BANNERS_DIR = "../data/banners";

export async function seedBanners(prisma: PrismaClient) : Promise<void> {
  const bannerHelper : BannerHelper = new BannerHelperImpl();

  const bannersDir = path.resolve(__dirname, BANNERS_DIR);
  const bannerNames : string[] = fs.readdirSync(path.resolve(bannersDir, DEFAULT_LANG)).map((file : string) =>
    path.basename(file, '.json'),
  );

  for (const bannerName of bannerNames) {
    const enBannerData = bannerHelper.loadJson(path.resolve(bannersDir, DEFAULT_LANG, `${bannerName}.json`));
    const translations: { language: string; bannerData: BannerData }[] = [{ language: DEFAULT_LANG, bannerData: enBannerData }];
    const languages = fs.readdirSync(bannersDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `${BANNERS_DIR}/${language}/${bannerName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, bannerData: bannerHelper.loadJson(path.resolve(bannersDir, language, `${bannerName}.json`)) });
      }
    }

    console.log(`\n→ Seeding banner: ${translations[0].bannerData.name}`);
    
    await bannerHelper.seedBanner(prisma, translations);
  }

  console.log('\n✅ Banners seeded.');
}