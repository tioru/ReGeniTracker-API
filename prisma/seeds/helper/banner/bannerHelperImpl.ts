import { PrismaClient } from "@prisma/client";
import { BannerHelper } from "./bannerHelper";

export const BUFFER_ENCODING = 'utf-8';
const ENGLISH_INDEX = 0;

export class BannerHelperImpl implements BannerHelper {
    loadJson(filePath: string) {
        throw new Error("Method not implemented.");
    }
    seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData; }[]): Promise<void> {
        throw new Error("Method not implemented.");
    }

}