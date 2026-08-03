import * as fs from 'node:fs';
import { PrismaClient, WeaponTypes, WeaponSecondaryStatType } from "@prisma/client";
import { WeaponHelper } from "./weaponHelper";
import { WeaponData } from "../../../../src/model/data/weapon/weapon";
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

const SECONDARY_STAT_TYPE_BY_LABEL: Record<string, WeaponSecondaryStatType> = {
    'ATK': 'ATK',
    'HP': 'HP',
    'DEF': 'DEF',
    'CRIT Rate': 'CRIT_RATE',
    'CRIT DMG': 'CRIT_DMG',
    'Energy Recharge': 'ENERGY_RECHARGE',
    'Elemental Mastery': 'ELEMENTAL_MASTERY',
    'Physical DMG Bonus': 'PHYSICAL_DMG_BONUS',
};

export class WeaponHelperImpl implements WeaponHelper {
    loadJson(fullPath: string): WeaponData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as WeaponData;
    }

    public async upsertWeapon(prisma: PrismaClient, weaponData: WeaponData): Promise<{ id: number; name: string; rarity: number; type: WeaponTypes }> {
        const secondaryStatType = this.resolveSecondaryStatType(weaponData);

        return prisma.weapon.upsert({
            where: { name: weaponData.name },
            update: {
                rarity: weaponData.rarity,
                type: weaponData.type,
                releaseDate: weaponData.releaseDate ? new Date(weaponData.releaseDate) : null,
                secondaryStatType,
                effects: weaponData.effects ?? [],
            },
            create: {
                name: weaponData.name,
                rarity: weaponData.rarity,
                type: weaponData.type,
                releaseDate: weaponData.releaseDate ? new Date(weaponData.releaseDate) : null,
                secondaryStatType,
                effects: weaponData.effects ?? [],
            }
        });
    }

    private resolveSecondaryStatType(weaponData: WeaponData): WeaponSecondaryStatType | null {
        const label = weaponData.secondaryAttribute?.type;
        if (!label) return null;

        const type = SECONDARY_STAT_TYPE_BY_LABEL[label];
        if (!type) {
            console.warn(`⚠️  Stat secondaire inconnue pour "${weaponData.name}": "${label}"`);
            return null;
        }
        return type;
    }

    public async upsertWeaponTranslations(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void> {
        for (const { language, weaponData } of translations) {
            await prisma.weaponTranslation.upsert({
                where: { weaponId_language: { weaponId, language } },
                update: {
                    name: weaponData.name,
                    description: weaponData.description ?? null,
                    history: weaponData.history ?? null,
                },
                create: {
                    weaponId,
                    language,
                    name: weaponData.name,
                    description: weaponData.description ?? null,
                    history: weaponData.history ?? null,
                },
            });
        }
    }

    public async levelsRecreate(prisma: PrismaClient, weaponId: number, weaponData: WeaponData): Promise<void> {
        await prisma.weaponLevel.deleteMany({ where: { weaponId } });

        const secondaryLevels = weaponData.secondaryAttribute?.levels ?? {};
        const levels = Object.entries(weaponData.levels).map(([level, levelData]) => {
            const secondaryLevelData = secondaryLevels[level];
            const secondaryStatValue = secondaryLevelData ? Object.values(secondaryLevelData)[0] : null;

            return {
                weaponId,
                level,
                baseAtk: levelData.baseAtk,
                secondaryStatValue,
            };
        });

        await prisma.weaponLevel.createMany({ data: levels });
    }

    public async ascensionMaterialsRecreate(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void> {
        const existing = await prisma.weaponAscensionMaterial.findMany({
          where: { weaponId },
          select: { id: true },
        });
        const ascensionIds = existing.map((ascension) => ascension.id);

        if (ascensionIds.length > 0) {
          await prisma.weaponAscensionMaterialItem.deleteMany({
            where: { ascensionMaterialId: { in: ascensionIds } },
          });
          await prisma.weaponAscensionMaterial.deleteMany({ where: { id: { in: ascensionIds } } });
        }

        const enAscensionMaterials = translations[ENGLISH_INDEX].weaponData.ascensionMaterials;

        for (const enAscension of enAscensionMaterials) {
            const createdAscension = await prisma.weaponAscensionMaterial.create({
                data: { weaponId, level: enAscension.level },
            });

            for (const enItem of enAscension.materials) {
                const material = await prisma.material.findUnique({
                    where: { name: enItem.name },
                    select: { id: true },
                });

                if (!material) {
                    console.warn(`⚠️  Matériau introuvable : ${enItem.name}`);
                    continue;
                }

                await prisma.weaponAscensionMaterialItem.create({
                    data: {
                        ascensionMaterialId: createdAscension.id,
                        materialId: material.id,
                        quantity: enItem.quantity,
                    },
                });
            }
        }
    }

    public async sellersRecreate(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void> {
        const existingSellers = await prisma.weaponSeller.findMany({
            where: { weaponId },
            select: { id: true },
        });
        const sellerIds = existingSellers.map((seller) => seller.id);

        if (sellerIds.length > 0) {
            await prisma.weaponSellerTranslation.deleteMany({
                where: { sellerId: { in: sellerIds } },
            });
            await prisma.weaponSeller.deleteMany({ where: { id: { in: sellerIds } } });
        }

        const enWeaponData = translations[ENGLISH_INDEX].weaponData;

        for (let sellerIndex = 0; sellerIndex < enWeaponData.sellers.length; sellerIndex++) {
            const enSeller = enWeaponData.sellers[sellerIndex];

            const createdSeller = await prisma.weaponSeller.create({
                data: {
                    weaponId,
                    cost: enSeller.cost,
                    stock: enSeller.stock,
                    restock: enSeller.restock,
                },
            });

            for (const { language, weaponData } of translations) {
                const seller = weaponData.sellers[sellerIndex] ?? enSeller;
                await prisma.weaponSellerTranslation.create({
                    data: {
                        sellerId: createdSeller.id,
                        language,
                        name: seller.name,
                        currency: seller.currency,
                    },
                });
            }
        }
    }

    public async refinementsRecreate(prisma: PrismaClient, weaponId: number, translations: { language: string; weaponData: WeaponData }[]): Promise<void> {
        const existingRefinements = await prisma.weaponRefinement.findMany({
            where: { weaponId },
            select: { id: true },
        });
        const refinementIds = existingRefinements.map((refinement) => refinement.id);

        if (refinementIds.length > 0) {
            await prisma.weaponRefinementTranslation.deleteMany({
                where: { refinementId: { in: refinementIds } },
            });
            await prisma.weaponRefinement.deleteMany({ where: { id: { in: refinementIds } } });
        }

        const enRefinementLevels = translations[ENGLISH_INDEX].weaponData.weaponRefinementLevel ?? {};

        for (const [rank, enRefinement] of Object.entries(enRefinementLevels)) {
            const createdRefinement = await prisma.weaponRefinement.create({
                data: {
                    weaponId,
                    rank: parseInt(rank, 10),
                    upgradeCost: enRefinement.upgradeCost[0]?.quantity ?? null,
                },
            });

            for (const { language, weaponData } of translations) {
                const refinement = weaponData.weaponRefinementLevel?.[rank] ?? enRefinement;
                await prisma.weaponRefinementTranslation.create({
                    data: {
                        refinementId: createdRefinement.id,
                        language,
                        title: refinement.title,
                        descriptions: refinement.descriptions,
                    },
                });
            }
        }
    }

    public async seedWeapon( prisma: PrismaClient, translations: { language: string; weaponData: WeaponData }[]): Promise<void> {
        const weapon = await this.upsertWeapon(prisma, translations[ENGLISH_INDEX].weaponData);
        console.log(`Weapon upserted (id: ${weapon.id})`);
        
        await this.upsertWeaponTranslations(prisma, weapon.id, translations);
        console.log(`WeaponTranslations upserted (${translations.map((t) => t.language).join(', ')})`);
        
        await this.levelsRecreate(prisma, weapon.id, translations[ENGLISH_INDEX].weaponData);
        console.log(`Levels recreated`);
        
        await this.ascensionMaterialsRecreate(prisma, weapon.id, translations);
        console.log(`AscensionMaterials recreated`);
        
        await this.sellersRecreate(prisma, weapon.id, translations);
        console.log(`Sellers recreated`);

        await this.refinementsRecreate(prisma, weapon.id, translations);
        console.log(`Refinements recreated`);
    }
}