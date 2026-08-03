import { PrismaClient } from "@prisma/client";
import { BannerData } from "../../../../src/model/data/banner/banner";
import { NormalizedBannerData } from "../../../../src/model/data/banner/normalizedBanner";

export interface BannerHelper {
    loadJson(filePath: string): BannerData;
    normalize(bannerData: BannerData): NormalizedBannerData;
    verifyConsistency(reference: NormalizedBannerData, other: NormalizedBannerData, language: string): void;
    seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData }[]): Promise<void>;

    // Les noms de fichiers sont traduits (ex. EN "adrift_in_the_harbor..." / FR
    // "doute_passager..."), donc inutilisables pour associer un fichier EN à son
    // équivalent FR : l'association se fait par empreinte de contenu à la place.
    buildWeaponFrNameMap(prisma: PrismaClient): Promise<Map<string, string>>;
    computeFingerprint(bannerData: BannerData, weaponFrNameMap: Map<string, string>): string;
}