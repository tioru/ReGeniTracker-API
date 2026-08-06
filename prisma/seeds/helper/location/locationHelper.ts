import { PrismaClient } from "@prisma/client";
import { LocationData } from "../../../../src/model/data/location/location";

export interface LocationHelper {
  loadJson(filePath: string): LocationData;
  upsertLocation(prisma: PrismaClient, enData: LocationData): Promise<{ id: number }>;
  upsertLocationTranslations(prisma: PrismaClient, locationId: number, translations: { language: string; locationData: LocationData }[]): Promise<void>;
  seedLocation(prisma: PrismaClient, translations: { language: string; locationData: LocationData }[]): Promise<{ id: number }>;
  linkParent(prisma: PrismaClient, enLocationData: LocationData): Promise<void>;
}
