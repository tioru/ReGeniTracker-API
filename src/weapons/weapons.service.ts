import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WeaponOut } from '../model/out/weapon/weapon';
import { WeaponAscensionMaterialOut } from '../model/out/weapon/ascensionMaterial';
import { WeaponSellerOut } from '../model/out/weapon/seller';
import { PrismaService } from '../prisma/prisma.service';

type WeaponWithRelations = Prisma.WeaponGetPayload<{
    include: {
        translations: true,
        levels: true,
        ascensionMaterials: {
            include: {
                items: {
                    include: {
                        material: {
                            include: {
                                translations: true,
                            },
                        },
                    },
                },
            },
        },
        sellers: {
            include: { translations: true },
        },
    };
}>;

type AscensionMaterialWithRelations = WeaponWithRelations['ascensionMaterials'][number];
type AscensionMaterialWithRelationsItem = AscensionMaterialWithRelations['items'][number];
type LevelsWithRelations = WeaponWithRelations['levels'];
type SellerWithRelations = WeaponWithRelations['sellers'][number];

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTranslation(translations: any[], language: string): any {
    return translations.find((translation: any) => translation.language === language) ?? null;
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapWeapon(weaponWithRelations: WeaponWithRelations, language: string): WeaponOut {
    const pickedTranslation = pickTranslation(weaponWithRelations.translations, language);

    if (!pickedTranslation) {
        throw new NotFoundException(`Language not found for "${weaponWithRelations.name}"`);
    }

    return {
        name: weaponWithRelations.name,
        type: weaponWithRelations.type,
        rarity: weaponWithRelations.rarity,
        releaseDate: weaponWithRelations.releaseDate,
        description: pickedTranslation.description,
        history: pickedTranslation.history,
        levels: mapLevels(weaponWithRelations.levels),
        ascensionMaterials: mapAscensionMaterials(weaponWithRelations.ascensionMaterials, language),
        sellers: mapSellers(weaponWithRelations.sellers, language),
    };
}

function mapLevels(levels: LevelsWithRelations): WeaponOut['levels'] {
    return Object.fromEntries(
        levels.map((level) => [
            level.level,
            {
                baseAtk: level.baseAtk,
            },
        ]),
    );
}

function mapAscensionMaterials(ascensionMaterialsWithRelations: AscensionMaterialWithRelations[], language: string): WeaponAscensionMaterialOut[] {
    return ascensionMaterialsWithRelations.map((ascensionMaterialWithRelations: AscensionMaterialWithRelations) => ({
        level: ascensionMaterialWithRelations.level,
        materials: ascensionMaterialWithRelations.items.map((item: AscensionMaterialWithRelationsItem) => {
            const t = pickTranslation(item.material.translations, language);
            return {
                name: t?.name ?? item.material.name,
                quantity: item.quantity,
            };
        }),
    }));
}

function mapSellers(sellersWithRelations: SellerWithRelations[], language: string): WeaponSellerOut[] {
    return sellersWithRelations.map((sellerWithRelations: SellerWithRelations) => {
        const t = pickTranslation(sellerWithRelations.translations, language);
        return {
            name: t?.name ?? '',
            currency: t?.currency ?? '',
            cost: sellerWithRelations.cost,
            stock: sellerWithRelations.stock,
            restock: sellerWithRelations.restock,
        };
    });
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class WeaponsService {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(): Promise<string[]> {
        const weapons = await this.prisma.weapon.findMany({
            select: { name: true },
        });
        return weapons.map((weapon) => weapon.name).sort((a: string, b: string) => a.localeCompare(b));
    }

    async findOne(name: string, language: string): Promise<WeaponOut | undefined> {
        const weapon: WeaponWithRelations | null = await this.prisma.weapon.findUnique({
            where: { name },
            include: {
                translations: true,
                levels: true,
                ascensionMaterials: {
                    include: {
                        items: {
                            include: {
                                material: {
                                    include: {
                                        translations: true,
                                    },
                                },
                            },
                        },
                    },
                },
                sellers: {
                    include: { translations: true },
                },
            },
        });

        if (!weapon) {
            throw new NotFoundException(`"${name}" not found`);
        }

        try {
            return mapWeapon(weapon, language);
        } catch (e: any) {
            console.error(e);
        }
    }
}
