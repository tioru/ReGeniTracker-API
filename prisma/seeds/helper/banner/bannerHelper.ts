import { PrismaClient } from "@prisma/client";
import { BannerData } from "../../model/banner/banner";
import { NormalizedBannerData } from "../../model/banner/normalizedBanner";

export interface BannerHelper {  
    loadJson(filePath: string): BannerData;
    normalize(bannerData: BannerData): NormalizedBannerData;
    verifyConsistency(reference: NormalizedBannerData, other: NormalizedBannerData, language: string): void;
    seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData }[]): Promise<void>;
}