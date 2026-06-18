import { Prisma } from "@prisma/client";

export type MaterialWithRelations = Prisma.MaterialGetPayload<{
  include: {
    translations: true,
    sources: {
      include: {
        translations: true,
        recipes: {
          include: {
            ingredients: {
              include: { translations: true },
            },
          },
        },
      },
    },
    sellers: {
      include: { translations: true },
    },
    usedIn: {
      include: { translations: true },
    },
    usedByCharacters: {
      include: {
        character: {
          include: { translations: true },
        },
      },
    },
  };
}>;