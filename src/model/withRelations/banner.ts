import { Prisma } from "@prisma/client";

export const BANNER_INCLUDE = {
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
    }
} satisfies Prisma.BannerInclude;

export type BannerWithRelations = Prisma.BannerGetPayload<{
  include: typeof BANNER_INCLUDE
}>;