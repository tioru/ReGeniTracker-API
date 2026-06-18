import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CharacterHelperImpl } from './helper/character/characterHelperImpl';
import { CharacterData } from '../../src/model/data/character/character';
import { CharacterHelper } from './helper/character/characterHelper';

export const DEFAULT_LANG = 'en';
const CHARACTERS_DIR = "../data/characters";

export async function seedCharacters(prisma: PrismaClient) : Promise<void> {
  const characterHelper : CharacterHelper = new CharacterHelperImpl();

  const charactersDir = path.resolve(__dirname, CHARACTERS_DIR);
  const characterNames : string[] = fs.readdirSync(path.resolve(charactersDir, DEFAULT_LANG)).map((file : string) =>
    path.basename(file, '.json'),
  );

  for (const characterName of characterNames) {
    const enCharacterData = characterHelper.loadJson(path.resolve(charactersDir, DEFAULT_LANG, `${characterName}.json`));
    const translations: { language: string; characterData: CharacterData }[] = [{ language: DEFAULT_LANG, characterData: enCharacterData }];
    const languages = fs.readdirSync(charactersDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const filePath = `${CHARACTERS_DIR}/${language}/${characterName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, characterData: characterHelper.loadJson(path.resolve(charactersDir, language, `${characterName}.json`)) });
      }
    }

    console.log(`\n→ Seeding character: ${translations[0].characterData.name}`);
    
    await characterHelper.seedCharacter(prisma, translations);
  }

  console.log('\n✅ Characters seeded.');
}