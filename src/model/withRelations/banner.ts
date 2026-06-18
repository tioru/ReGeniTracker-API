import { Prisma } from "@prisma/client";

export type BannerWithRelations = Prisma.BannerGetPayload<{
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