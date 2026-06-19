import { Prisma } from "@prisma/client";

export const MATERIAL_INCLUDE = {
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
  }
} satisfies Prisma.MaterialInclude;

export type MaterialWithRelations = Prisma.MaterialGetPayload<{
  include: typeof MATERIAL_INCLUDE
}>;