import * as fs from 'node:fs';
import { EnemyHelper } from "./enemyHelper";
import { BossEnemyData, EnemyData, EnemyEncounterType, isBossEnemyData } from "../../../../src/model/data/enemy/enemy";
import { EnemyPhaseData } from "../../../../src/model/data/enemy/enemyPhase";
import { EnemyType, PrismaClient } from "@prisma/client";
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

const ENEMY_TYPE_MAP: Record<EnemyEncounterType, EnemyType> = {
    "Common Enemy": EnemyType.COMMON_ENEMY,
    "Elite Enemy": EnemyType.ELITE_ENEMY,
    "Normal Boss": EnemyType.NORMAL_BOSS,
    "Weekly Boss": EnemyType.WEEKLY_BOSS,
};

function toPhases(enemyData: EnemyData): EnemyPhaseData[] {
    if (isBossEnemyData(enemyData)) {
        return enemyData.phases;
    }

    return [{
        phase: 1,
        name: enemyData.name,
        damageTypes: [],
        hasWeakPoint: enemyData.hasWeakPoint,
        abilities: enemyData.abilities,
        stats: enemyData.stats,
    }];
}

export class EnemyHelperImpl implements EnemyHelper {
    public loadJson(fullPath: string): EnemyData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as EnemyData;
    }

    public async upsertEnemy(prisma: PrismaClient, enemyData: EnemyData): Promise<{ id: number }> {
        const dropPool = isBossEnemyData(enemyData) ? enemyData.bossRewards.poolRewards : enemyData.drops;
        const location = isBossEnemyData(enemyData) ? enemyData.location : null;

        return prisma.enemy.upsert({
            where: { name: enemyData.name },
            update: {
              enemyType: ENEMY_TYPE_MAP[enemyData.enemyType],
              region: location?.region || null,
              area: location?.area || null,
              subArea: location?.subArea || null,
              domain: location?.domain || null,
              dropMaterials: dropPool.materials,
              dropArtefacts: dropPool.artefacts,
              releaseVersion: enemyData.releaseVersion || null,
            },
            create: {
              name: enemyData.name,
              enemyType: ENEMY_TYPE_MAP[enemyData.enemyType],
              region: location?.region || null,
              area: location?.area || null,
              subArea: location?.subArea || null,
              domain: location?.domain || null,
              dropMaterials: dropPool.materials,
              dropArtefacts: dropPool.artefacts,
              releaseVersion: enemyData.releaseVersion || null,
            },
        });
    }

    public async upsertEnemyTranslations(prisma: PrismaClient, enemyId: number, translations: { language: string; enemyData: EnemyData }[]): Promise<void> {
        for (const { language, enemyData } of translations) {
          await prisma.enemyTranslation.upsert({
            where: { enemyId_language: { enemyId: enemyId, language: language } },
            update: {
              name: enemyData.name,
              family: enemyData.family || null,
              group: enemyData.group || null,
              title: isBossEnemyData(enemyData) ? (enemyData.title || null) : null,
            },
            create: {
              enemyId,
              language: language,
              name: enemyData.name,
              family: enemyData.family || null,
              group: enemyData.group || null,
              title: isBossEnemyData(enemyData) ? (enemyData.title || null) : null,
            },
          });
        }
    }

    public async phasesRecreate(prisma: PrismaClient, enemyId: number, translations: { language: string; enemyData: EnemyData }[]): Promise<void> {
        const existingPhases = await prisma.enemyPhase.findMany({
            where: { enemyId },
            select: { id: true },
        });
        const phaseIds = existingPhases.map((phase) => phase.id);

        if (phaseIds.length > 0) {
            await prisma.enemyPhaseLevelStat.deleteMany({ where: { phaseId: { in: phaseIds } } });
            await prisma.enemyPhaseResistance.deleteMany({ where: { phaseId: { in: phaseIds } } });
            await prisma.enemyPhaseTranslation.deleteMany({ where: { phaseId: { in: phaseIds } } });
            await prisma.enemyPhase.deleteMany({ where: { id: { in: phaseIds } } });
        }

        const enPhases = toPhases(translations[ENGLISH_INDEX].enemyData);
        const phasesByLanguage = translations.map(({ language, enemyData }) => ({ language, phases: toPhases(enemyData) }));

        for (let phaseIndex = 0; phaseIndex < enPhases.length; phaseIndex++) {
            const enPhase = enPhases[phaseIndex];

            const createdPhase = await prisma.enemyPhase.create({
                data: {
                    enemyId,
                    phase: enPhase.phase,
                    hasWeakPoint: enPhase.hasWeakPoint,
                    abilities: enPhase.abilities,
                    damageTypes: enPhase.damageTypes,
                },
            });

            for (const { language, phases } of phasesByLanguage) {
                const name = phases[phaseIndex]?.name ?? enPhase.name;
                await prisma.enemyPhaseTranslation.create({
                    data: { phaseId: createdPhase.id, language: language, name },
                });
            }

            for (const [level, levelStats] of Object.entries(enPhase.stats.levels)) {
                await prisma.enemyPhaseLevelStat.create({
                    data: {
                        phaseId: createdPhase.id,
                        level: Number(level),
                        hp: levelStats.hp,
                        atk: levelStats.atk,
                        def: levelStats.def,
                    },
                });
            }

            await prisma.enemyPhaseResistance.create({
                data: { phaseId: createdPhase.id, ...enPhase.stats.resistance },
            });
        }
    }

    public async basicRewardsRecreate(prisma: PrismaClient, enemyId: number, translations: { language: string; enemyData: EnemyData }[]): Promise<void> {
        const existingRewards = await prisma.enemyBasicReward.findMany({
            where: { enemyId },
            select: { id: true },
        });
        const rewardIds = existingRewards.map((reward) => reward.id);

        if (rewardIds.length > 0) {
            const existingItems = await prisma.enemyBasicRewardItem.findMany({
                where: { basicRewardId: { in: rewardIds } },
                select: { id: true },
            });
            const itemIds = existingItems.map((item) => item.id);

            if (itemIds.length > 0) {
                await prisma.enemyBasicRewardItemTranslation.deleteMany({ where: { rewardItemId: { in: itemIds } } });
                await prisma.enemyBasicRewardItem.deleteMany({ where: { id: { in: itemIds } } });
            }
            await prisma.enemyBasicReward.deleteMany({ where: { id: { in: rewardIds } } });
        }

        const enEnemyData = translations[ENGLISH_INDEX].enemyData;

        if (!isBossEnemyData(enEnemyData)) {
            return;
        }

        const rewardsByLanguage = translations
            .filter((translation): translation is { language: string; enemyData: BossEnemyData } => isBossEnemyData(translation.enemyData))
            .map(({ language, enemyData }) => ({ language, basicRewards: enemyData.bossRewards.basicRewards }));

        const enBasicRewards = enEnemyData.bossRewards.basicRewards;

        for (let rewardIndex = 0; rewardIndex < enBasicRewards.length; rewardIndex++) {
            const enReward = enBasicRewards[rewardIndex];

            const createdReward = await prisma.enemyBasicReward.create({
                data: {
                    enemyId,
                    domainLevel: enReward.domainLevel ?? null,
                    worldLevel: enReward.worldLevel ?? null,
                    bossLevel: enReward.bossLevel,
                },
            });

            for (let itemIndex = 0; itemIndex < enReward.rewards.length; itemIndex++) {
                const enItem = enReward.rewards[itemIndex];

                const createdItem = await prisma.enemyBasicRewardItem.create({
                    data: { basicRewardId: createdReward.id, quantity: enItem.quantity },
                });

                for (const { language, basicRewards } of rewardsByLanguage) {
                    const name = basicRewards[rewardIndex]?.rewards[itemIndex]?.name ?? enItem.name;
                    await prisma.enemyBasicRewardItemTranslation.create({
                        data: { rewardItemId: createdItem.id, language: language, name },
                    });
                }
            }
        }
    }

    public async seedEnemy(prisma: PrismaClient, translations: { language: string; enemyData: EnemyData }[]): Promise<void> {
        const enemy = await this.upsertEnemy(prisma, translations[ENGLISH_INDEX].enemyData);
        console.log(`Enemy upserted (id: ${enemy.id})`);

        await this.upsertEnemyTranslations(prisma, enemy.id, translations);
        console.log(`EnemyTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        await this.phasesRecreate(prisma, enemy.id, translations);
        console.log(`Phases recreated`);

        await this.basicRewardsRecreate(prisma, enemy.id, translations);
        console.log(`Basic rewards recreated`);
    }
}
