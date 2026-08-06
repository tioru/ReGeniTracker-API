import { PrismaClient } from "@prisma/client";
import { ArtifactData } from "../../../../src/model/data/artifact/artifact";

export interface ArtifactHelper {
    loadJson(filePath: string): ArtifactData;
    upsertArtifactSet(prisma: PrismaClient, artifactData: ArtifactData): Promise<{ id: number; name: string }>;
    upsertArtifactSetTranslations(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void>;
    obtainingRecreate(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void>;
    piecesRecreate(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void>;
    bonusesRecreate(prisma: PrismaClient, artifactSetId: number, translations: { language: string; artifactData: ArtifactData }[]): Promise<void>;
    seedArtifactSet(prisma: PrismaClient, translations: { language: string; artifactData: ArtifactData }[]): Promise<void>;
}
