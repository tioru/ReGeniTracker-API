import { Prisma } from "@prisma/client";

export type CharacterWithRelations = Prisma.CharacterGetPayload<{
  include: {
    translations: true,
    levels: true,
    ascensionMaterials: {
      include: {
        items: { 
          include: { 
            material: {
              include: {
                translations: true
              },
            },
          },
        },
      },
    },
    normalAttacks: {
      include: {
        translations: { include: { descriptions: true } },
        upgrades: {
          include: { translations: true },
        },
      },
    },
    elementalSkills: {
      include: {
        translations: { include: { descriptions: true } },
        upgrades: {
          include: { translations: true },
        },
      },
    },
    elementalBursts: {
      include: {
        translations: { include: { descriptions: true } },
        upgrades: {
          include: { translations: true },
        },
      },
    },
    passiveTalents: {
      include: {
        translations: { include: { descriptions: true } },
        attributes: {
          include: { translations: true },
        },
      },
    },
    ascensionTalents: {
      include: {
        translations: { include: { descriptions: true } },
      },
    },
    additionalTalents: {
      include: {
        translations: { include: { descriptions: true } },
      },
    },
    constellations: {
      include: {
        translations: {
          include: {
            descriptions: true,
            hexereiBuffDescriptions: true,
          },
        },
      },
    },
  }
}>;