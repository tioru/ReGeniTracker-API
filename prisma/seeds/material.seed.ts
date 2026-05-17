import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from 'node:url';
import { PrismaClient } from "@prisma/client";
import { MaterialHelperImpl } from "./helper/material/materialHelperImpl";
import { MaterialData } from "./model/material/material";

const DEFAULT_LANG = "en";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  const materialHelperImpl = new MaterialHelperImpl();

  const materialsDir = path.resolve(__dirname, "../data/materials");
  const materialNames: string[] = fs.readdirSync(path.resolve(materialsDir, DEFAULT_LANG)).map((file: string) => 
    path.basename(file, ".json")
);

  for (const materialName of materialNames) {
    const enMaterialData: MaterialData = materialHelperImpl.loadJson(`../data/materials/${DEFAULT_LANG}/${materialName}.json`,);
    const translations: { language: string; materialData: MaterialData }[] = [{ language: DEFAULT_LANG, materialData: enMaterialData },];
    const languages = fs.readdirSync(materialsDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `../data/materials/${language}/${materialName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, materialData: materialHelperImpl.loadJson(filePath) });
      }
    }

    console.log(`\n→ Seeding material: ${enMaterialData.name}`);

    await materialHelperImpl.seedMaterial(prisma, translations);
  }

  console.log("\n✅ Materials seedés.");
}