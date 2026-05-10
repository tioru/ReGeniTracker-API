import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'node:fs';
import * as path from 'node:path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const dataDir = path.join(__dirname, 'data/characters');
const DEFAULT_LANG = 'en';

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getLangs(): string[] {
  return fs.readdirSync(dataDir).filter(f =>
    fs.statSync(path.join(dataDir, f)).isDirectory()
  );
}

async function main() {
  console.log('Start seeding...');

  const langs = getLangs();
  const defaultDir = path.join(dataDir, DEFAULT_LANG);
  const characterFiles = fs.readdirSync(defaultDir).filter(f => f.endsWith('.json'));

  for (const file of characterFiles) {
    const baseData = readJson(path.join(defaultDir, file));

    const translations = langs
      .filter(lang => fs.existsSync(path.join(dataDir, lang, file)))
      .map(lang => {
        const langData = readJson(path.join(dataDir, lang, file));
        return {
          lang,
          title: langData.title,
          description: langData.description,
          affiliation: langData.affiliation,
          constellation: langData.constellation,
        };
      });

    await prisma.character.upsert({
      where: { name: baseData.name },
      update: {},
      create: {
        name: baseData.name,
        rarity: baseData.rarity,
        vision: baseData.vision,
        weapon: baseData.weapon,
        nation: baseData.nation,
        birthday: baseData.birthday ? new Date(baseData.birthday) : null,
        releaseDate: baseData.releaseDate ? new Date(baseData.releaseDate) : null,
        translations: { create: translations },
        passiveTalents: {
          create: baseData.passiveTalents.map((pt: any, i: number) => ({
            unlock: pt.unlock,
            translations: {
              create: langs
                .filter(lang => fs.existsSync(path.join(dataDir, lang, file)))
                .map(lang => {
                  const langData = readJson(path.join(dataDir, lang, file));
                  return {
                    lang,
                    name: langData.passiveTalents[i].name,
                    description: langData.passiveTalents[i].description,
                  };
                }),
            },
          })),
        },
        constellations: {
          create: baseData.constellations.map((c: any, i: number) => ({
            level: c.level,
            translations: {
              create: langs
                .filter(lang => fs.existsSync(path.join(dataDir, lang, file)))
                .map(lang => {
                  const langData = readJson(path.join(dataDir, lang, file));
                  return {
                    lang,
                    name: langData.constellations[i].name,
                    description: langData.constellations[i].description,
                  };
                }),
            },
          })),
        },
      },
    });

    console.log(`Seeded: ${baseData.name}`);
  }

  console.log('Seeding finished.');
}

main().then(async () => await prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});