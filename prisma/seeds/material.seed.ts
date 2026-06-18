import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { MaterialHelperImpl } from "./helper/material/materialHelperImpl";
import { MaterialData } from "../../src/model/data/material/material";
import { MaterialHelper } from "./helper/material/materialHelper";

const DEFAULT_LANG = "en";
const MATERIALS_DIR = "../data/materials";

export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  const materialHelper : MaterialHelper = new MaterialHelperImpl();

  const materialsDir = path.resolve(__dirname, MATERIALS_DIR);
  const materialNames: string[] = fs.readdirSync(path.resolve(materialsDir, DEFAULT_LANG)).map((file: string) => 
    path.basename(file, ".json")
);

  for (const materialName of materialNames) {
    const enMaterialData: MaterialData = materialHelper.loadJson(path.resolve(materialsDir, DEFAULT_LANG, `${materialName}.json`));
    const translations: { language: string; materialData: MaterialData }[] = [{ language: DEFAULT_LANG, materialData: enMaterialData },];
    const languages = fs.readdirSync(materialsDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `${MATERIALS_DIR}/${language}/${materialName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, materialData: materialHelper.loadJson(path.resolve(materialsDir, language, `${materialName}.json`)) });
      }
    }

    console.log(`\n→ Seeding material: ${enMaterialData.name}`);

    await materialHelper.seedMaterial(prisma, translations);
  }

  console.log("\n✅ Materials seeded.");
}