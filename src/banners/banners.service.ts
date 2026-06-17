import { Injectable, NotFoundException } from '@nestjs/common';
import { FeaturedRoles, Prisma } from '@prisma/client';
import { CharacterRaritySplitOut } from '../model/out/banner/characterRaritySplit';
import { WeaponRaritySplitOut } from '../model/out/banner/weaponRaritySplit';
import { BannerOut } from '../model/out/banner/banner';
import { PrismaService } from '../prisma/prisma.service';

type BannerWithRelations = Prisma.BannerGetPayload<{
  include: {
    translations: true,
    characters: {
      include: {
        character: { include: { translations: true } },
      },
    },
    weapons: {
      include: {
        weapon: { include: { translations: true } },
      },
    },
  };
}>;

type BannerCharacterWithRelations = BannerWithRelations['characters'][number];
type BannerWeaponWithRelations = BannerWithRelations['weapons'][number];

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTranslation(translations: any[], language: string): any {
    return translations.find((translation: any) => translation.language === language) ?? null;
}

function emptyCharacterSplit(): CharacterRaritySplitOut {
    return { featured5Star: [], featured4Star: [], featured3Star: [] };
}

function emptyWeaponSplit(): WeaponRaritySplitOut {
    return { featured5Star: [], featured4Star: [], featured3Star: [] };
}

function rarityKey(rarity: number): 'featured5Star' | 'featured4Star' | 'featured3Star' | null {
    if (rarity === 5) return 'featured5Star';
    if (rarity === 4) return 'featured4Star';
    if (rarity === 3) return 'featured3Star';
    return null;
}

function characterName(entry: BannerCharacterWithRelations, language: string): string {
    const translation = pickTranslation(entry.character.translations, language);
    return translation?.name ?? entry.character.name;
}

function weaponName(entry: BannerWeaponWithRelations, language: string): string {
    const translation = pickTranslation(entry.weapon.translations, language);
    return translation?.name ?? entry.weapon.name;
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapBanner(bannerWithRelations: BannerWithRelations, language: string): BannerOut {
    const pickedTranslation = pickTranslation(bannerWithRelations.translations, language);

    if (!pickedTranslation) {
        throw new NotFoundException(`Language not found for "${bannerWithRelations.name}"`);
    }

    const base = {
        name: pickedTranslation.name,
        type: bannerWithRelations.type === 'CHARACTER' ? ('character' as const) : ('weapon' as const),
        releaseDate: bannerWithRelations.releaseDate,
        endDate: bannerWithRelations.endDate,
    };

    if (bannerWithRelations.type === 'CHARACTER') {
        return {
            ...base,
            boostedCharacters: mapCharacterSplit(bannerWithRelations.characters, 'BOOSTED', language),
            otherCharacters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
            weapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
        };
    }

    return {
        ...base,
        boostedWeapons: mapWeaponSplit(bannerWithRelations.weapons, 'BOOSTED', language),
        otherWeapons: mapWeaponSplit(bannerWithRelations.weapons, 'OTHER', language),
        characters: mapCharacterSplit(bannerWithRelations.characters, 'OTHER', language),
    };
}

function mapCharacterSplit(entries: BannerCharacterWithRelations[], role: FeaturedRoles, language: string): CharacterRaritySplitOut {
    const split = emptyCharacterSplit();

    for (const entry of entries) {
        if (entry.role !== role) continue;
        const key = rarityKey(entry.rarity);
        if (!key) continue;
        split[key].push(characterName(entry, language));
    }

    return split;
}

function mapWeaponSplit(entries: BannerWeaponWithRelations[], role: FeaturedRoles, language: string): WeaponRaritySplitOut {
    const split = emptyWeaponSplit();

    for (const entry of entries) {
        if (entry.role !== role) continue;
        const key = rarityKey(entry.rarity);
        if (!key) continue;
        split[key].push(weaponName(entry, language));
    }

    return split;
}

@Injectable()
export class BannersService {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(): Promise<string[]> {
        const banners = await this.prisma.banner.findMany({
            select: { name: true },
        });
        return banners.map((banner) => banner.name).sort((a: string, b: string) => a.localeCompare(b));
    }

    async findOne(name: string, language: string): Promise<BannerOut | undefined> {
        const banner: BannerWithRelations | null = await this.prisma.banner.findFirst({
            where: { name },
            include: {
                translations: true,
                characters: {
                    include: {
                        character: { include: { translations: true } },
                    },
                },
                weapons: {
                    include: {
                        weapon: { include: { translations: true } },
                    },
                },
            },
        });

        if (!banner) {
            throw new NotFoundException(`"${name}" not found`);
        }

        try {
            return mapBanner(banner, language);
        } catch (error: any) {
            console.error(error);
        }
    }
}