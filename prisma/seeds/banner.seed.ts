import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BannerHelper } from './helper/banner/bannerHelper';
import { BannerHelperImpl } from './helper/banner/bannerHelperImpl';
import { BannerData } from '../../src/model/data/banner/banner';
import { DEFAULT_LANG } from '../../constants';

const BANNERS_DIR = "../data/banners";
const BANNER_SUBDIRS = ['characters', 'weapons', 'standard', 'unusual'];

export async function seedBanners(prisma: PrismaClient) : Promise<void> {
  const bannerHelper : BannerHelper = new BannerHelperImpl();
  const weaponFrNameMap = await bannerHelper.buildWeaponFrNameMap(prisma);

  const bannersDir = path.resolve(__dirname, BANNERS_DIR);
  const languages = fs.readdirSync(bannersDir).filter((language: string) => language !== DEFAULT_LANG);

  for (const subdir of BANNER_SUBDIRS) {
    const enSubdirPath = path.resolve(bannersDir, DEFAULT_LANG, subdir);

    if (!fs.existsSync(enSubdirPath)) {
      continue;
    }

    const bannerNames: string[] = fs
      .readdirSync(enSubdirPath)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'));

    // Les noms de fichiers sont traduits (ex. EN "adrift_in_the_harbor..." / FR
    // "doute_passager..."), donc inutilisables pour retrouver l'équivalent FR
    // d'un fichier EN. On indexe une fois par sous-dossier chaque fichier
    // traduit par son empreinte de contenu (cf. bannerHelper.computeFingerprint),
    // langue-invariante une fois les noms d'armes retraduits vers l'EN.
    const bannerDataByFingerprint = new Map<string, Map<string, BannerData>>(); // language -> (fingerprint -> bannerData)
    for (const language of languages) {
      const langSubdirPath = path.resolve(bannersDir, language, subdir);
      if (!fs.existsSync(langSubdirPath)) continue;

      const index = new Map<string, BannerData>();
      for (const file of fs.readdirSync(langSubdirPath).filter((f) => f.endsWith('.json'))) {
        const data = bannerHelper.loadJson(path.resolve(langSubdirPath, file));
        index.set(bannerHelper.computeFingerprint(data, weaponFrNameMap), data);
      }
      bannerDataByFingerprint.set(language, index);
    }

    for (const bannerName of bannerNames) {
      const enBannerData = bannerHelper.loadJson(path.resolve(enSubdirPath, `${bannerName}.json`));
      const fingerprint = bannerHelper.computeFingerprint(enBannerData, weaponFrNameMap);

      const translations: { language: string; bannerData: BannerData }[] = [
        { language: DEFAULT_LANG, bannerData: enBannerData },
      ];

      for (const language of languages) {
        const matched = bannerDataByFingerprint.get(language)?.get(fingerprint);
        if (!matched) {
          console.warn(
            `⚠️  [${language}] Aucune traduction trouvée pour "${enBannerData.name}" (${subdir}/${bannerName}.json) — empreinte "${fingerprint}" absente.`,
          );
          continue;
        }
        translations.push({ language, bannerData: matched });
      }

      console.log(`\n→ Seeding banner: ${translations[0].bannerData.name}`);

      await bannerHelper.seedBanner(prisma, translations);
    }
  }

  console.log('\n✅ Banners seeded.');
}
