import { Prisma } from "@prisma/client";

export type WeaponWithRelations = Prisma.WeaponGetPayload<{
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