import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { BannerHelper } from './bannerHelper';
import { BannerData } from '../../model/banner/banner';
import { NormalizedBannerData } from '../../model/banner/normalizedBanner';
import { NormalizedEntryData } from '../../model/banner/normalizedEntry';
import { WeaponRaritySplitData } from '../../model/banner/weaponRaritySplit';
import { CharacterRaritySplitData } from '../../model/banner/characterRaritySplit';

export const BUFFER_ENCODING = 'utf-8';
const ENGLISH_INDEX = 0;

const RARITY_MAP: Record<string, number> = {
  featured3Star: 3,
  featured4Star: 4,
  featured5Star: 5,
};

export class BannerHelperImpl implements BannerHelper {
    loadJson(fullPath: string): BannerData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as BannerData;
    }

    public normalize(bannerData: BannerData): NormalizedBannerData {
        const characters: NormalizedEntryData[] = [];
        const weapons: NormalizedEntryData[] = [];

        if (bannerData.type === 'character') {
            this.flattenCharacterSplit(bannerData.boostedCharacters, 'BOOSTED', characters);
            this.flattenCharacterSplit(bannerData.otherCharacters, 'OTHER', characters);
            this.flattenWeaponSplit(bannerData.weapons, 'OTHER', weapons);
        } else {
            this.flattenWeaponSplit(bannerData.boostedWeapons, 'BOOSTED', weapons);
            this.flattenWeaponSplit(bannerData.otherWeapons, 'OTHER', weapons);
            this.flattenCharacterSplit(bannerData.characters, 'OTHER', characters);
        }

        return {
            name: bannerData.name,
            type: bannerData.type === 'character' ? 'CHARACTER' : 'WEAPON',
            releaseDate: new Date(bannerData.releaseDate),
            endDate: new Date(bannerData.endDate),
            characters,
            weapons,
        };
    }

    public verifyConsistency(reference: NormalizedBannerData, other: NormalizedBannerData, language: string): void {
        if (reference.type !== other.type) {
            console.warn(`⚠️  [${language}] Type différent pour "${reference.name}": ${reference.type} vs ${other.type}`);
        }
        if (reference.releaseDate.getTime() !== other.releaseDate.getTime()) {
            console.warn(`⚠️  [${language}] releaseDate différente pour "${reference.name}"`);
        }
        if (reference.endDate.getTime() !== other.endDate.getTime()) {
            console.warn(`⚠️  [${language}] endDate différente pour "${reference.name}"`);
        }

        this.compareEntryLists(reference.characters, other.characters, language, reference.name, 'characters');
        this.compareEntryLists(reference.weapons, other.weapons, language, reference.name, 'weapons');
    } 

    // ── Helpers privés ────────────────────────────────────────────────────

    private async findExistingBannerId(prisma: PrismaClient, name: string): Promise<number | null> {
        const existing = await prisma.banner.findFirst({ where: { name }, select: { id: true } });
        return existing?.id ?? null;
    }

    private async charactersRecreate(prisma: PrismaClient, bannerId: number, entries: NormalizedEntryData[]): Promise<void> {
        await prisma.bannerCharacter.deleteMany({ where: { bannerId } });

        for (const entry of entries) {
            const character = await prisma.character.findUnique({ where: { name: entry.name }, select: { id: true } });
            if (!character) {
                console.warn(`⚠️  Personnage introuvable : "${entry.name}"`);
                continue;
            }
            await prisma.bannerCharacter.create({
                data: { bannerId, characterId: character.id, rarity: entry.rarity, role: entry.role },
            });
        }
    }

    private async weaponsRecreate(prisma: PrismaClient, bannerId: number, entries: NormalizedEntryData[]): Promise<void> {
        await prisma.bannerWeapon.deleteMany({ where: { bannerId } });

        for (const entry of entries) {
            const weapon = await prisma.weapon.findUnique({ where: { name: entry.name }, select: { id: true } });
            if (!weapon) {
                console.warn(`⚠️  Arme introuvable : "${entry.name}"`);
                continue;
            }
            await prisma.bannerWeapon.create({
                data: { bannerId, weaponId: weapon.id, rarity: entry.rarity, role: entry.role },
            });
        }
    }

    private async translationsRecreate(prisma: PrismaClient, bannerId: number, translations: { language: string; bannerData: BannerData}[]): Promise<void> {
        for (const { language, bannerData } of translations) {
            await prisma.bannerTranslation.upsert({
                where: { bannerId_language: { bannerId, language } },
                update: { name: bannerData.name },
                create: { bannerId, language, name: bannerData.name },
            });
        }
    }

    private flattenCharacterSplit(split: CharacterRaritySplitData | undefined, role: 'BOOSTED' | 'OTHER', out: NormalizedEntryData[]): void {
        if (!split) return;
        for (const [rarityKey, value] of Object.entries(split)) {
            const rarity = RARITY_MAP[rarityKey];
            const names = Array.isArray(value) ? value : [value];
            for (const name of names as string[]) {
                out.push({ name, rarity, role });
            }
        }
    }

    private flattenWeaponSplit(split: WeaponRaritySplitData | undefined, role: 'BOOSTED' | 'OTHER', out: NormalizedEntryData[]): void {
        if (!split) return;
        for (const [rarityKey, names] of Object.entries(split)) {
            const rarity = RARITY_MAP[rarityKey];
            for (const name of names as string[]) {
                out.push({ name, rarity, role });
            }
        }
    }

    private compareEntryLists(reference: NormalizedEntryData[], other: NormalizedEntryData[], language: string, bannerName: string, listLabel: string): void {
        if (reference.length !== other.length) {
            console.warn(
                `⚠️  [${language}] Nombre de ${listLabel} différent pour "${bannerName}": EN=${reference.length}, ${language}=${other.length}`,
            );
        }
        const len = Math.min(reference.length, other.length);
        for (let i = 0; i < len; i++) {
            const ref = reference[i];
            const oth = other[i];
            if (ref.rarity !== oth.rarity || ref.role !== oth.role) {
                console.warn(
                    `⚠️  [${language}] Incohérence ${listLabel} #${i} pour "${bannerName}": EN="${ref.name}" (${ref.rarity}★, ${ref.role}) vs ${language}="${oth.name}" (${oth.rarity}★, ${oth.role})`,
                );
            }
        }
    }

    public async seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData }[]): Promise<void> {
        const refData = translations[ENGLISH_INDEX].bannerData;
        const reference = this.normalize(refData);

        // Vérification croisée avec les autres langues (lecture seule)
        for (let i = 0; i < translations.length; i++) {
            if (i === ENGLISH_INDEX) continue;
            const { language, bannerData } = translations[i];
            const normalized = this.normalize(bannerData);
            this.verifyConsistency(reference, normalized, language);
        }

        const banner = await prisma.banner.upsert({
            where: { id: await this.findExistingBannerId(prisma, reference.name) ?? -1 },
            update: {
                type: reference.type,
                releaseDate: reference.releaseDate,
                endDate: reference.endDate,
            },
            create: {
                name: reference.name,
                type: reference.type,
                releaseDate: reference.releaseDate,
                endDate: reference.endDate,
            },
        });

        await this.charactersRecreate(prisma, banner.id, reference.characters);
        console.log(`BannerCharacters recreated (${reference.characters.length})`);

        await this.weaponsRecreate(prisma, banner.id, reference.weapons);
        console.log(`BannerWeapons recreated (${reference.weapons.length})`);

        await this.translationsRecreate(prisma, banner.id, translations);
        console.log(`BannerTranslations upserted (${translations.map((t) => t.language).join(', ')})`);
    }
}