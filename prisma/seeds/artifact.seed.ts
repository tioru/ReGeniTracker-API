import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArtifactHelper } from './helper/artifact/artifactHelper';
import { ArtifactHelperImpl } from './helper/artifact/artifactHelperImpl';
import { ArtifactData } from '../../src/model/data/artifact/artifact';
import { DEFAULT_LANG } from '../../constants';

const ARTIFACTS_DIR = "../data/artifacts";

export async function seedArtifacts(prisma: PrismaClient) : Promise<void> {
  const artifactHelper : ArtifactHelper = new ArtifactHelperImpl();

  const artifactsDir = path.resolve(__dirname, ARTIFACTS_DIR);
  const artifactNames : string[] = fs.readdirSync(path.resolve(artifactsDir, DEFAULT_LANG)).map((file : string) =>
    path.basename(file, '.json'),
  );

  for (const artifactName of artifactNames) {
    const enArtifactData = artifactHelper.loadJson(path.resolve(artifactsDir, DEFAULT_LANG, `${artifactName}.json`));
    const translations: { language: string; artifactData: ArtifactData }[] = [{ language: DEFAULT_LANG, artifactData: enArtifactData }];
    const languages = fs.readdirSync(artifactsDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `${ARTIFACTS_DIR}/${language}/${artifactName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, artifactData: artifactHelper.loadJson(path.resolve(artifactsDir, language, `${artifactName}.json`)) });
      }
    }

    console.log(`\n→ Seeding artifact set: ${translations[0].artifactData.name}`);

    await artifactHelper.seedArtifactSet(prisma, translations);
  }

  console.log('\n✅ Artifacts seeded.');
}
