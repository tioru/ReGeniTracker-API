import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTranslation(translations: any[], lang: string): any {
  return translations.find((t: any) => t.lang === lang);
}

function mapDescriptions(items: { title: string | null; description: string }[]) {
  return items.map(d => ({ title: d.title, description: d.description }));
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapCharacter(raw: any, lang: string) {
  const t = pickTranslation(raw.translations, lang);

  return {
    name:         raw.name,
    rarity:       raw.rarity,
    vision:       raw.vision,
    weapon:       raw.weapon,
    nation:       raw.nation,
    birthday:     raw.birthday,
    releaseDate:  raw.releaseDate,
    obtaining:    raw.obtaining,
    // Champs traduits
    title:        t?.title ?? null,
    description:  t?.description ?? null,
    affiliation:  t?.affiliation ?? null,
    constellation: t?.constellation ?? null,
    specialDish: t?.specialDish ?? null,
    // Relations
    levels:              mapLevels(raw.levels),
    ascensionMaterials:  mapAscensionMaterials(raw.ascensionMaterials),
    normalAttacks:       raw.normalAttacks.map((x: any) => mapTalentWithUpgrades(x, lang)),
    elementalSkills:     raw.elementalSkills.map((x: any) => mapTalentWithUpgrades(x, lang)),
    elementalBursts:     raw.elementalBursts.map((x: any) => mapTalentWithUpgrades(x, lang)),
    passiveTalents:      raw.passiveTalents.map((x: any) => mapPassiveTalent(x, lang)),
    ascensionTalents:    raw.ascensionTalents.map((x: any) => mapSimpleTalent(x, lang)),
    additionalTalents:   raw.additionalTalents.map((x: any) => mapSimpleTalent(x, lang)),
    constellations:      raw.constellations.map((x: any) => mapConstellation(x, lang)),
  };
}

function mapLevels(levels: any[]) {
  return Object.fromEntries(
    levels.map(l => [l.level, {
      baseHp:        l.baseHp,
      baseDef:       l.baseDef,
      baseAtk:       l.baseAtk,
      energyRecharge: l.energyRecharge,
    }])
  );
}

function mapAscensionMaterials(ascMats: any[]) {
  return ascMats.map(a => ({
    level:     a.level,
    materials: a.items.map((i: any) => ({
      name:  i.material.name,
      value: i.value,
    })),
  }));
}

function mapTalentWithUpgrades(talent: any, lang: string) {
  const t = pickTranslation(talent.translations, lang);
  return {
    unlock:       talent.unlock ?? null,
    name:         t?.name ?? null,
    note:         t?.note ?? null,
    descriptions: mapDescriptions(t?.descriptions ?? []),
    upgrades:     (talent.upgrades ?? []).map((u: any) => ({
      name:   u.name,
      values: u.values,
    })),
  };
}

function mapPassiveTalent(talent: any, lang: string) {
  const t = pickTranslation(talent.translations, lang);
  return {
    unlock:       talent.unlock ?? null,
    name:         t?.name ?? null,
    note:         t?.note ?? null,
    descriptions: mapDescriptions(t?.descriptions ?? []),
    attributes:   (talent.attributes ?? []).map((a: any) => ({
      name:  a.name,
      value: a.value,
    })),
  };
}

function mapSimpleTalent(talent: any, lang: string) {
  const t = pickTranslation(talent.translations, lang);
  return {
    unlock:       talent.unlock ?? null,
    name:         t?.name ?? null,
    descriptions: mapDescriptions(t?.descriptions ?? []),
  };
}

function mapConstellation(constellation: any, lang: string) {
  const t = pickTranslation(constellation.translations, lang);
  return {
    level:                  constellation.level,
    name:                   t?.name ?? null,
    descriptions:           mapDescriptions(t?.descriptions ?? []),
    hexereiBuffDescriptions: mapDescriptions(t?.hexereiBuffDescriptions ?? []),
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: string) {
    const characters = await this.prisma.character.findMany({
      select: { name: true },
    });
    return characters.map(c => c.name);
  }

  async findOne(name: string, lang: string) {
    const raw = await this.prisma.character.findUnique({
      where: { name },
      include: {
        translations: true,
        levels: true,
        ascensionMaterials: {
          include: {
            items: { include: { material: true } },
          },
        },
        normalAttacks: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: true,
          },
        },
        elementalSkills: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: true,
          },
        },
        elementalBursts: {
          include: {
            translations: { include: { descriptions: true } },
            upgrades: true,
          },
        },
        passiveTalents: {
          include: {
            translations: { include: { descriptions: true } },
            attributes: true,
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
      },
    });

    if (!raw) throw new NotFoundException(`Character "${name}" not found`);

    return mapCharacter(raw, lang);
  }
}