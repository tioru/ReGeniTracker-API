import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CharacterHelperImpl } from './helper/character/characterHelperImpl';
import { CharacterData } from './model/character/character';

export const DEFAULT_LANG = 'en';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedCharacters(prisma: PrismaClient) : Promise<void> {
  const characterHelperImpl = new CharacterHelperImpl();

  const charactersDir = path.resolve(__dirname, '../data/characters');
  const characterNames : string[] = fs.readdirSync(path.resolve(charactersDir, DEFAULT_LANG)).map((file : string) =>
    path.basename(file, '.json'),
  );

  for (const characterName of characterNames) {
    const enCharacterData = characterHelperImpl.loadJson(`../data/characters/${DEFAULT_LANG}/${characterName}.json`);
    const translations: { language: string; characterData: CharacterData }[] = [{ language: DEFAULT_LANG, characterData: enCharacterData }];
    const languages = fs.readdirSync(charactersDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `../data/characters/${language}/${characterName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, characterData: characterHelperImpl.loadJson(filePath) });
      }
    }

    console.log(`\n→ Seeding character: ${translations[0].characterData.name}`);
    
    await characterHelperImpl.seedCharacter(prisma, translations);
  }

  console.log('\n✅ Characters seedés.');
}