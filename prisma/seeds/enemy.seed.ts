import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { EnemyHelperImpl } from "./helper/enemy/enemyHelperImpl";
import { EnemyData } from "../../src/model/data/enemy/enemy";
import { EnemyHelper } from "./helper/enemy/enemyHelper";
import { DEFAULT_LANG } from "../../constants";

const ENEMIES_DIR = "../data/enemies";

export async function seedEnemies(prisma: PrismaClient): Promise<void> {
  const enemyHelper: EnemyHelper = new EnemyHelperImpl();

  const enemiesDir = path.resolve(__dirname, ENEMIES_DIR);
  const enemyNames: string[] = fs.readdirSync(path.resolve(enemiesDir, DEFAULT_LANG))
    .filter((file: string) => file.endsWith(".json"))
    .map((file: string) => path.basename(file, ".json"));

  for (const enemyName of enemyNames) {
    const enEnemyData: EnemyData = enemyHelper.loadJson(path.resolve(enemiesDir, DEFAULT_LANG, `${enemyName}.json`));
    const translations: { language: string; enemyData: EnemyData }[] = [{ language: DEFAULT_LANG, enemyData: enEnemyData }];
    const languages = fs.readdirSync(enemiesDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const fullPath = path.resolve(enemiesDir, language, `${enemyName}.json`);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, enemyData: enemyHelper.loadJson(fullPath) });
      }
    }

    console.log(`\n→ Seeding enemy: ${enEnemyData.name}`);

    await enemyHelper.seedEnemy(prisma, translations);
  }

  console.log("\n✅ Enemies seeded.");
}
