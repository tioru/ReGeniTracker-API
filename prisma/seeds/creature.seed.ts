import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { CreatureHelperImpl } from "./helper/creature/creatureHelperImpl";
import { CreatureData } from "../../src/model/data/creature/creature";
import { CreatureHelper } from "./helper/creature/creatureHelper";
import { DEFAULT_LANG } from "../../constants";

const CREATURES_DIR = "../data/creatures";

export async function seedCreatures(prisma: PrismaClient): Promise<void> {
  const creatureHelper: CreatureHelper = new CreatureHelperImpl();

  const creaturesDir = path.resolve(__dirname, CREATURES_DIR);
  const creatureNames: string[] = fs.readdirSync(path.resolve(creaturesDir, DEFAULT_LANG))
    .filter((file: string) => file.endsWith(".json"))
    .map((file: string) => path.basename(file, ".json"));

  for (const creatureName of creatureNames) {
    const enCreatureData: CreatureData = creatureHelper.loadJson(path.resolve(creaturesDir, DEFAULT_LANG, `${creatureName}.json`));
    const translations: { language: string; creatureData: CreatureData }[] = [{ language: DEFAULT_LANG, creatureData: enCreatureData }];
    const languages = fs.readdirSync(creaturesDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const fullPath = path.resolve(creaturesDir, language, `${creatureName}.json`);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, creatureData: creatureHelper.loadJson(fullPath) });
      }
    }

    console.log(`\n→ Seeding creature: ${enCreatureData.name}`);

    await creatureHelper.seedCreature(prisma, translations);
  }

  console.log("\n✅ Creatures seeded.");
}
