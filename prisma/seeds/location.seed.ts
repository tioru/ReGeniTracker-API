import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { LocationHelperImpl } from "./helper/location/locationHelperImpl";
import { LocationData } from "../../src/model/data/location/location";
import { LocationHelper } from "./helper/location/locationHelper";
import { DEFAULT_LANG } from "../../constants";

const LOCATIONS_DIR = "../data/locations";

export async function seedLocations(prisma: PrismaClient): Promise<void> {
  const locationHelper: LocationHelper = new LocationHelperImpl();

  const locationsDir = path.resolve(__dirname, LOCATIONS_DIR);
  const locationFileNames: string[] = fs.readdirSync(path.resolve(locationsDir, DEFAULT_LANG))
    .filter((file: string) => file.endsWith(".json"))
    .map((file: string) => path.basename(file, ".json"));

  const enLocationDataList: LocationData[] = [];

  for (const locationFileName of locationFileNames) {
    const enLocationData: LocationData = locationHelper.loadJson(path.resolve(locationsDir, DEFAULT_LANG, `${locationFileName}.json`));
    const translations: { language: string; locationData: LocationData }[] = [{ language: DEFAULT_LANG, locationData: enLocationData }];
    const languages = fs.readdirSync(locationsDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const fullPath = path.resolve(locationsDir, language, `${locationFileName}.json`);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, locationData: locationHelper.loadJson(fullPath) });
      }
    }

    console.log(`\n→ Seeding location: ${enLocationData.name}`);

    await locationHelper.seedLocation(prisma, translations);
    enLocationDataList.push(enLocationData);
  }

  // 2e passe : les localisations parentes référencées par "parent" ne sont
  // pas forcément toutes seedées au moment où on traite une localisation
  // donnée (cf. NOTE en tête de prisma/schema/location.prisma) — on ne
  // résout la hiérarchie qu'une fois que TOUTES les localisations existent
  // en base.
  for (const enLocationData of enLocationDataList) {
    if (enLocationData.parent) {
      await locationHelper.linkParent(prisma, enLocationData);
    }
  }

  console.log("\n✅ Locations seeded.");
}
