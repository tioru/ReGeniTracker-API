import * as fs from 'node:fs';
import { PrismaClient } from "@prisma/client";
import { BookHelper } from "./bookHelper";
import { BookData } from "../../../../src/model/data/book/book";
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

export class BookHelperImpl implements BookHelper {
    public loadJson(fullPath: string): BookData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as BookData;
    }

    public async upsertBook(prisma: PrismaClient, bookData: BookData): Promise<{ id: number; name: string }> {
        return prisma.book.upsert({
            where: { name: bookData.name },
            update: {
                category: bookData.category,
                rarity: bookData.rarity,
                region: bookData.region,
            },
            create: {
                name: bookData.name,
                category: bookData.category,
                rarity: bookData.rarity,
                region: bookData.region,
            },
        });
    }

    public async upsertBookTranslations(prisma: PrismaClient, bookId: number, translations: { language: string; bookData: BookData }[]): Promise<void> {
        for (const { language, bookData } of translations) {
            await prisma.bookTranslation.upsert({
                where: { bookId_language: { bookId, language } },
                update: {
                    name: bookData.name,
                    author: bookData.author,
                    publisher: bookData.publisher,
                    illustrator: bookData.illustrator,
                    description: bookData.description,
                    source: bookData.source,
                },
                create: {
                    bookId,
                    language,
                    name: bookData.name,
                    author: bookData.author,
                    publisher: bookData.publisher,
                    illustrator: bookData.illustrator,
                    description: bookData.description,
                    source: bookData.source,
                },
            });
        }
    }

    public async volumesRecreate(prisma: PrismaClient, bookId: number, translations: { language: string; bookData: BookData }[]): Promise<void> {
        const existingVolumes = await prisma.bookVolume.findMany({
            where: { bookId },
            select: { id: true },
        });
        const volumeIds = existingVolumes.map((volume) => volume.id);

        if (volumeIds.length > 0) {
            await prisma.bookVolumeTranslation.deleteMany({ where: { volumeId: { in: volumeIds } } });
            await prisma.bookVolume.deleteMany({ where: { id: { in: volumeIds } } });
        }

        const enVolumes = translations[ENGLISH_INDEX].bookData.volumes;

        for (let volumeIndex = 0; volumeIndex < enVolumes.length; volumeIndex++) {
            const enVolume = enVolumes[volumeIndex];

            const createdVolume = await prisma.bookVolume.create({
                data: { bookId, number: enVolume.number },
            });

            for (const { language, bookData } of translations) {
                const location = bookData.volumes[volumeIndex]?.location ?? enVolume.location;
                await prisma.bookVolumeTranslation.create({
                    data: { volumeId: createdVolume.id, language, location },
                });
            }
        }
    }

    public async seedBook(prisma: PrismaClient, translations: { language: string; bookData: BookData }[]): Promise<void> {
        const book = await this.upsertBook(prisma, translations[ENGLISH_INDEX].bookData);
        console.log(`Book upserted (id: ${book.id})`);

        await this.upsertBookTranslations(prisma, book.id, translations);
        console.log(`BookTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        await this.volumesRecreate(prisma, book.id, translations);
        console.log(`Volumes recreated`);
    }
}
