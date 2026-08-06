import { PrismaClient } from "@prisma/client";
import { EnemyData } from "../../../../src/model/data/enemy/enemy";

export interface EnemyHelper {
  loadJson(filePath: string): EnemyData;
  upsertEnemy(prisma: PrismaClient, enData: EnemyData): Promise<{ id: number }>;
  upsertEnemyTranslations(prisma: PrismaClient, enemyId: number, translations: { language: string; enemyData: EnemyData }[]): Promise<void>;
  phasesRecreate(prisma: PrismaClient, enemyId: number, translations: { language: string; enemyData: EnemyData }[]): Promise<void>;
  basicRewardsRecreate(prisma: PrismaClient, enemyId: number, translations: { language: string; enemyData: EnemyData }[]): Promise<void>;
  seedEnemy(prisma: PrismaClient, translations: { language: string; enemyData: EnemyData }[]): Promise<void>;
}
