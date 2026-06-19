import { Prisma } from "@prisma/client";

export const WEAPON_INCLUDE = {
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
    }
}

export type WeaponWithRelations = Prisma.WeaponGetPayload<{
  include: typeof WEAPON_INCLUDE
}>;