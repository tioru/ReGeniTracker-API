import * as fs from 'node:fs';
import { PrismaClient, ArtifactSourceTypes, ArtifactPieceSlot } from "@prisma/client";
import { ArtifactHelper } from "./artifactHelper";
import { ArtifactData } from "../../../../src/model/data/artifact/artifact";
import { ArtifactPieceData } from "../../../../src/model/data/artifact/artifactPiece";
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

const PIECE_SLOT_BY_KEY: Record<'flowerOfLife' | 'plumeOfDeath' | 'sandsOfEon' | 'gobletOfEonothem' | 'circletOfLogos', ArtifactPieceSlot> = {
    flowerOfLife: 'FLOWER_OF_LIFE',
    plumeOfDeath: 'PLUME_OF_DEATH',
    sandsOfEon: 'SANDS_OF_EON',
    gobletOfEonothem: 'GOBLET_OF_EONOTHEM',
    circletOfLogos: 'CIRCLET_OF_LOGOS',
};

export class ArtifactHelperImpl implements ArtifactHelper {
    loadJson(fullPath: string): ArtifactData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as ArtifactData;
    }

    public async upsertArtifactSet(prisma: PrismaClient, artifactData: ArtifactData): Promise<{ id: number; name: string }> {
        const effects = (artifactData.setBonuses.effects as string[]) ?? [];

        return prisma.artifactSet.upsert({
            where: { name: artifactData.name },
            update: {
                releaseVersion: artifactData.releaseVersion,
                effects,
            },
            create: {
                name: artifactData.name,
                releaseVersion: artifactData.releaseVersion,
                effects,
            },
        });
    }

    public async upsertArtifactSetTranslations(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void> {
        for (const { language, artifactData } of translations) {
            await prisma.artifactSetTranslation.upsert({
                where: { artifactSetId_language: { artifactSetId, language } },
                update: { name: artifactData.name },
                create: { artifactSetId, language, name: artifactData.name },
            });
        }
    }

    public async obtainingRecreate(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void> {
        const existingTiers = await prisma.artifactObtainingTier.findMany({
            where: { artifactSetId },
            select: { id: true },
        });
        const tierIds = existingTiers.map((tier) => tier.id);

        if (tierIds.length > 0) {
            const existingSources = await prisma.artifactSource.findMany({
                where: { tierId: { in: tierIds } },
                select: { id: true },
            });
            const sourceIds = existingSources.map((source) => source.id);

            if (sourceIds.length > 0) {
                await prisma.artifactSourceTranslation.deleteMany({ where: { sourceId: { in: sourceIds } } });
                await prisma.artifactSource.deleteMany({ where: { id: { in: sourceIds } } });
            }
            await prisma.artifactObtainingTier.deleteMany({ where: { id: { in: tierIds } } });
        }

        const enObtaining = translations[ENGLISH_INDEX].artifactData.obtaining;

        for (const enTier of enObtaining) {
            const createdTier = await prisma.artifactObtainingTier.create({
                data: { artifactSetId, rarity: enTier.rarity },
            });

            for (let sourceIndex = 0; sourceIndex < enTier.sources.length; sourceIndex++) {
                const [type, enName] = Object.entries(enTier.sources[sourceIndex])[0] as [ArtifactSourceTypes, string];

                const createdSource = await prisma.artifactSource.create({
                    data: { tierId: createdTier.id, type },
                });

                for (const { language, artifactData } of translations) {
                    const tier = artifactData.obtaining.find((t) => t.rarity === enTier.rarity);
                    const sourceEntry = tier?.sources[sourceIndex];
                    const name = sourceEntry ? Object.values(sourceEntry)[0] : enName;

                    await prisma.artifactSourceTranslation.create({
                        data: { sourceId: createdSource.id, language, name },
                    });
                }
            }
        }
    }

    public async piecesRecreate(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void> {
        const existingPieces = await prisma.artifactPiece.findMany({
            where: { artifactSetId },
            select: { id: true },
        });
        const pieceIds = existingPieces.map((piece) => piece.id);

        if (pieceIds.length > 0) {
            await prisma.artifactPieceTranslation.deleteMany({ where: { pieceId: { in: pieceIds } } });
            await prisma.artifactPiece.deleteMany({ where: { id: { in: pieceIds } } });
        }

        for (const key of Object.keys(PIECE_SLOT_BY_KEY) as (keyof typeof PIECE_SLOT_BY_KEY)[]) {
            const slot = PIECE_SLOT_BY_KEY[key];
            const createdPiece = await prisma.artifactPiece.create({ data: { artifactSetId, slot } });

            for (const { language, artifactData } of translations) {
                const piece = artifactData[key] as ArtifactPieceData;
                await prisma.artifactPieceTranslation.create({
                    data: {
                        pieceId: createdPiece.id,
                        language,
                        name: piece.name,
                        description: piece.description,
                    },
                });
            }
        }
    }

    public async bonusesRecreate(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void> {
        const existingBonuses = await prisma.artifactSetBonus.findMany({
            where: { artifactSetId },
            select: { id: true },
        });
        const bonusIds = existingBonuses.map((bonus) => bonus.id);

        if (bonusIds.length > 0) {
            await prisma.artifactSetBonusTranslation.deleteMany({ where: { bonusId: { in: bonusIds } } });
            await prisma.artifactSetBonus.deleteMany({ where: { id: { in: bonusIds } } });
        }

        const enBonuses = translations[ENGLISH_INDEX].artifactData.setBonuses;
        const piecesCounts = Object.keys(enBonuses)
            .filter((key) => key !== 'effects')
            .map((key) => parseInt(key, 10));

        for (const pieces of piecesCounts) {
            const createdBonus = await prisma.artifactSetBonus.create({ data: { artifactSetId, pieces } });
            const enEffect = enBonuses[`${pieces}pieces`] as string;

            for (const { language, artifactData } of translations) {
                const effect = (artifactData.setBonuses[`${pieces}pieces`] as string) ?? enEffect;
                await prisma.artifactSetBonusTranslation.create({
                    data: { bonusId: createdBonus.id, language, effect },
                });
            }
        }
    }

    public async seedArtifactSet(prisma: PrismaClient, translations: { language: string; artifactData: ArtifactData }[]): Promise<void> {
        const artifactSet = await this.upsertArtifactSet(prisma, translations[ENGLISH_INDEX].artifactData);
        console.log(`ArtifactSet upserted (id: ${artifactSet.id})`);

        await this.upsertArtifactSetTranslations(prisma, artifactSet.id, translations);
        console.log(`ArtifactSetTranslations upserted (${translations.map((t) => t.language).join(', ')})`);

        await this.obtainingRecreate(prisma, artifactSet.id, translations);
        console.log(`Obtaining tiers recreated`);

        await this.piecesRecreate(prisma, artifactSet.id, translations);
        console.log(`Pieces recreated`);

        await this.bonusesRecreate(prisma, artifactSet.id, translations);
        console.log(`Set bonuses recreated`);
    }
}
