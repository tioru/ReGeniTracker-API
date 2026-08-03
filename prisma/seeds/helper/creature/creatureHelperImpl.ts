import * as fs from 'node:fs';
import { CreatureHelper } from "./creatureHelper";
import { CreatureData } from "../../../../src/model/data/creature/creature";
import { PrismaClient } from "@prisma/client";
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

export class CreatureHelperImpl implements CreatureHelper {
    public loadJson(fullPath: string): CreatureData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as CreatureData;
    }

    public async upsertCreature(prisma: PrismaClient, creatureData: CreatureData): Promise<{ id: number; name: string; releaseVersion: string | null }> {
        return prisma.creature.upsert({
            where: { name: creatureData.name },
            update: {
              releaseVersion: creatureData.releaseVersion || null,
            },
            create: {
              name: creatureData.name,
              releaseVersion: creatureData.releaseVersion || null,
            },
        });
    }

    public async upsertCreatureTranslations(prisma: PrismaClient, creatureId: number, translations: { language: string; creatureData: CreatureData }[]): Promise<void> {
        for (const { language, creatureData } of translations) {
          await prisma.creatureTranslation.upsert({
            where: { creatureId_language: { creatureId: creatureId, language: language } },
            update: {
              name: creatureData.name,
              family: creatureData.family || null,
              group: creatureData.group || null,
              location: creatureData.location || null,
              description: creatureData.description || null,
              image: creatureData.image,
              bait: creatureData.bait ?? null,
            },
            create: {
              creatureId,
              language: language,
              name: creatureData.name,
              family: creatureData.family || null,
              group: creatureData.group || null,
              location: creatureData.location || null,
              description: creatureData.description || null,
              image: creatureData.image,
              bait: creatureData.bait ?? null,
            },
          });
        }
    }

    public async dropsRecreate(prisma: PrismaClient, creatureId: number, translations: { language: string; creatureData: CreatureData }[]): Promise<void> {
        const existingDrops = await prisma.creatureDrop.findMany({
            where: { creatureId },
            select: { id: true },
        });
        const dropIds = existingDrops.map((drop) => drop.id);

        if (dropIds.length > 0) {
            await prisma.creatureDropTranslation.deleteMany({
                where: { dropId: { in: dropIds } },
            });
            await prisma.creatureDrop.deleteMany({ where: { id: { in: dropIds } } });
        }

        const enDrops = translations[ENGLISH_INDEX].creatureData.drops;

        for (let dropIndex = 0; dropIndex < enDrops.length; dropIndex++) {
            const enDrop = enDrops[dropIndex];

            const createdDrop = await prisma.creatureDrop.create({
                data: { creatureId, quantity: enDrop.quantity },
            });

            for (const { language, creatureData } of translations) {
                const itemName = creatureData.drops[dropIndex]?.name ?? enDrop.name;
                await prisma.creatureDropTranslation.create({
                    data: { dropId: createdDrop.id, language: language, itemName },
                });
            }
        }
    }

    public async seedCreature(prisma: PrismaClient, translations: { language: string; creatureData: CreatureData }[]): Promise<void> {
        const creature = await this.upsertCreature(prisma, translations[ENGLISH_INDEX].creatureData);
        console.log(`Creature upserted (id: ${creature.id})`);

        await this.upsertCreatureTranslations(prisma, creature.id, translations);
        console.log(`CreatureTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        await this.dropsRecreate(prisma, creature.id, translations);
        console.log(`Drops recreated`);
    }
}
