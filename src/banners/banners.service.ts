import { Injectable, NotFoundException } from '@nestjs/common';
import { BannerOut } from '../model/out/banner/banner';
import { PrismaService } from '../prisma/prisma.service';
import { BannerWithRelations } from '../model/withRelations/banner';
import { mapBanner } from './mapper/banner';

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