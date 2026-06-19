import { Injectable, NotFoundException } from '@nestjs/common';
import { WeaponOut } from '../model/out/weapon/weapon';
import { PrismaService } from '../prisma/prisma.service';
import { mapWeapon } from './mapper/weapon';
import { WEAPON_INCLUDE, WeaponWithRelations } from '../model/withRelations/weapon';

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
        const normalizedName = name.replace(/_/g, ' ');

        const weapon: WeaponWithRelations | null = await this.prisma.weapon.findFirst({
            where: {
                name: { equals: normalizedName, mode: 'insensitive' },
            },
            include: WEAPON_INCLUDE
        });

        if (!weapon) {
            throw new NotFoundException(`"${name}" not found`);
        }

        try {
            return mapWeapon(weapon, language);
        } catch (error: any) {
            console.error(error);
            throw error;
        }
    }
}
