import { PrismaClient } from "@prisma/client";
import { CreatureData } from "../../../../src/model/data/creature/creature";

export interface CreatureHelper {
  loadJson(filePath: string): CreatureData;
  upsertCreature(prisma: PrismaClient, enData: CreatureData): Promise<{ id: number }>;
  upsertCreatureTranslations(prisma: PrismaClient, creatureId: number, translations: { language: string; creatureData: CreatureData }[]): Promise<void>;
  dropsRecreate(prisma: PrismaClient, creatureId: number, translations: { language: string; creatureData: CreatureData }[]): Promise<void>;
  seedCreature(prisma: PrismaClient, translations: { language: string; creatureData: CreatureData }[]): Promise<void>;
}
