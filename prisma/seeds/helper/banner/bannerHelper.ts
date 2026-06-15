import { PrismaClient } from "@prisma/client";

export interface BannerHelper {
    loadJson(filePath: string): BannerData;
    seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData }[]): Promise<void>;
}