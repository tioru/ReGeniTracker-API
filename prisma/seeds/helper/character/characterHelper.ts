import { ObtainingTypes, PrismaClient } from "@prisma/client";
import { CharacterData } from "../../model/character/character";
import { DescriptionData } from "../../model/character/description";

export interface CharacterHelper {
    loadJson(filePath: string): CharacterData;
    parseDate(value?: string): Date | null;
    buildDescriptions(items: DescriptionData[]): DescriptionData[];
    upsertCharacter(prisma: PrismaClient, characterData: CharacterData) : Promise<{id: number; name: string; rarity: number; vision: string; weapon: string; nation: string; birthday: Date | null; releaseDate: Date | null; obtaining: ObtainingTypes[]}>;
    upsertCharacterTranslations(prisma: PrismaClient, characterId: number, translations:{ language: string; characterData: CharacterData}[]): Promise<void>;
    characterLevelsRecreate(prisma: PrismaClient, characterId: number, characterData: CharacterData): Promise<void>;
    ascensionMaterialsRecreate(prisma: PrismaClient, characterId: number, characterData: CharacterData): Promise<void>;
    normalAttacksRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData}[]): Promise<void>;
    elementalSkillsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData}[]): Promise<void>;
    elementalBurstsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void>;
    passiveTalentsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void>;
    ascensionTalentsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void>;
    additionalTalentsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void>;
    constellationsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void>;
    seedCharacter(prisma: PrismaClient, translations: { language: string; characterData: CharacterData }[]): Promise<void>;
}