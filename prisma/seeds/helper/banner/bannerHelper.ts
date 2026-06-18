import { PrismaClient } from "@prisma/client";
import { BannerData } from "../../../../src/model/data/banner/banner";
import { NormalizedBannerData } from "../../../../src/model/data/banner/normalizedBanner";

export interface BannerHelper {  
    loadJson(filePath: string): BannerData;
    normalize(bannerData: BannerData): NormalizedBannerData;
    verifyConsistency(reference: NormalizedBannerData, other: NormalizedBannerData, language: string): void;
    seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData }[]): Promise<void>;
}