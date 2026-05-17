import { PrismaClient } from "@prisma/client";
import { MaterialData } from "../../model/material/material";

export interface MaterialHelper {
  loadJson(filePath: string): MaterialData;
  upsertMaterial(prisma: PrismaClient, enData: MaterialData): Promise<{ id: number }>;
  upsertMaterialTranslations(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void>;
  deleteSourcesForMaterial(prisma: PrismaClient, materialId: number): Promise<void>;
  sourcesRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void>;
  sellersRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void>;
  usedInRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void>;
  characterUsesRecreate(prisma: PrismaClient, materialId: number, translations: { language: string; materialData: MaterialData }[]): Promise<void>;
  seedMaterial(prisma: PrismaClient, translations: { language: string; materialData: MaterialData }[]): Promise<void>;
}