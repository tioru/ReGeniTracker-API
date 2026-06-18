import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BannerHelper } from './helper/banner/bannerHelper';
import { BannerHelperImpl } from './helper/banner/bannerHelperImpl';
import { BannerData } from '../../src/model/data/banner/banner';
import { DEFAULT_LANG } from '../../constants';

const BANNERS_DIR = "../data/banners";
const BANNER_SUBDIRS = ['characters', 'weapons'];

export async function seedBanners(prisma: PrismaClient) : Promise<void> {
  const bannerHelper : BannerHelper = new BannerHelperImpl();

  const bannersDir = path.resolve(__dirname, BANNERS_DIR);
  for (const subdir of BANNER_SUBDIRS) {
    const enSubdirPath = path.resolve(bannersDir, DEFAULT_LANG, subdir);

    if (!fs.existsSync(enSubdirPath)) {
      continue;
    }

    const bannerNames: string[] = fs
      .readdirSync(enSubdirPath)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'));

    for (const bannerName of bannerNames) {
      const enBannerData = bannerHelper.loadJson(path.resolve(enSubdirPath, `${bannerName}.json`));
      const translations: { language: string; bannerData: BannerData }[] = [
        { language: DEFAULT_LANG, bannerData: enBannerData },
      ];

      const languages = fs.readdirSync(bannersDir).filter((language: string) => language !== DEFAULT_LANG);

      for (const language of languages) {
        const filePath = `${BANNERS_DIR}/${language}/${subdir}/${bannerName}.json`;
        const fullPath = path.resolve(__dirname, filePath);
        if (fs.existsSync(fullPath)) {
          translations.push({
            language,
            bannerData: bannerHelper.loadJson(fullPath),
          });
        }
      }

      console.log(`\n→ Seeding banner: ${translations[0].bannerData.name}`);

      await bannerHelper.seedBanner(prisma, translations);
    }
  }

  console.log('\n✅ Banners seeded.');
}