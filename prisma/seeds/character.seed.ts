import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DescriptionItem {
  title: string | null;
  description: string;
}

interface UpgradeItem {
  name: string;
  values: string[];
}

interface AttributeItem {
  name: string;
  value: string;
}

interface MaterialItem {
  name: string;
  value: number;
}

interface CharacterData {
  name: string;
  rarity: number;
  vision: string;
  weapon: string;
  nation: string;
  birthday?: string;
  releaseDate?: string;
  specialDish: string;
  obtaining: string[];
  title?: string;
  description?: string;
  affiliation?: string;
  constellation?: string;
  levels: Record<string, { baseHp: number; baseDef: number; baseAtk: number; energyRecharge: string }>;
  ascensionMaterials: { level: number; materials: MaterialItem[] }[];
  normalAttacks: {
    unlock?: string;
    name: string;
    note?: string;
    descriptions: DescriptionItem[];
    upgrades: UpgradeItem[];
  }[];
  elementalSkills: {
    unlock?: string;
    name: string;
    note?: string;
    descriptions: DescriptionItem[];
    upgrades: UpgradeItem[];
  }[];
  elementalBursts: {
    unlock?: string;
    name: string;
    note?: string;
    descriptions: DescriptionItem[];
    upgrades: UpgradeItem[];
  }[];
  passiveTalents: {
    unlock?: string;
    name: string;
    note?: string;
    descriptions: DescriptionItem[];
    attributes?: AttributeItem[];
  }[];
  ascensionTalents: {
    unlock?: string;
    name: string;
    descriptions: DescriptionItem[];
  }[];
  additionalTalents: {
    unlock?: string;
    name: string;
    descriptions: DescriptionItem[];
  }[];
  constellations: {
    level: number;
    name: string;
    descriptions: DescriptionItem[];
    hexereiBuffDescriptions?: DescriptionItem[];
  }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadJson(filePath: string): CharacterData {
  const fullPath = path.resolve(__dirname, filePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const normalized = value.startsWith('0000-')
    ? `1900-${value.slice(5)}`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDescriptions(items: DescriptionItem[]) {
  return items.map((d) => ({ title: d.title ?? null, description: d.description }));
}

function buildUpgrades(upgrades: UpgradeItem[]) {
  return upgrades.map((u) => ({
    name: u.name,
    values: u.values,
  }));
}

// ── Seed d'un personnage ───────────────────────────────────────────────────────

async function seedCharacter(prisma: PrismaClient, enData: CharacterData, translations: { lang: string; data: CharacterData }[]) {
  console.log(`\n→ Seeding character: ${enData.name}`);

  // 1. Upsert Character (données non traduites)
  const character = await prisma.character.upsert({
    where: { name: enData.name },
    update: {
      rarity: enData.rarity,
      vision: enData.vision,
      weapon: enData.weapon,
      nation: enData.nation,
      birthday: parseDate(enData.birthday) ?? undefined,
      releaseDate: parseDate(enData.releaseDate) ?? undefined,
      obtaining: enData.obtaining as any[],
    },
    create: {
      name: enData.name,
      rarity: enData.rarity,
      vision: enData.vision,
      weapon: enData.weapon,
      nation: enData.nation,
      birthday: parseDate(enData.birthday) ?? undefined,
      releaseDate: parseDate(enData.releaseDate) ?? undefined,
      obtaining: enData.obtaining as any[],
    },
  });

  console.log(`  ✓ Character upserted (id: ${character.id})`);

  // 2. CharacterTranslation (EN + autres langues)
  const allTranslations = [{ lang: 'en', data: enData }, ...translations];
  for (const { lang, data } of allTranslations) {
    await prisma.characterTranslation.upsert({
      where: { characterId_lang: { characterId: character.id, lang } },
      update: {
        title: data.title ?? null,
        description: data.description ?? null,
        affiliation: data.affiliation ?? null,
        constellation: data.constellation ?? null,
        specialDish: data.specialDish ?? null,
      },
      create: {
        lang,
        title: data.title ?? null,
        description: data.description ?? null,
        affiliation: data.affiliation ?? null,
        constellation: data.constellation ?? null,
        specialDish: data.specialDish ?? null,
        characterId: character.id,
      },
    });
  }
  console.log(`  ✓ CharacterTranslations (${allTranslations.map((t) => t.lang).join(', ')})`);

  // 3. CharacterLevels — delete + recreate (pas de clé naturelle simple)
  await prisma.characterLevel.deleteMany({ where: { characterId: character.id } });
  await prisma.characterLevel.createMany({
    data: Object.entries(enData.levels).map(([level, stats]) => ({
      level,
      baseHp: stats.baseHp,
      baseDef: stats.baseDef,
      baseAtk: stats.baseAtk,
      energyRecharge: stats.energyRecharge,
      characterId: character.id,
    })),
  });
  console.log(`  ✓ CharacterLevels (${Object.keys(enData.levels).length} niveaux)`);

  // 4. AscensionMaterials
  await prisma.ascensionMaterialItem.deleteMany({
    where: { ascensionMaterial: { characterId: character.id } },
  });
  await prisma.ascensionMaterial.deleteMany({ where: { characterId: character.id } });

  for (const asc of enData.ascensionMaterials) {
    const ascMat = await prisma.ascensionMaterial.create({
      data: { level: asc.level, characterId: character.id },
    });

    for (const mat of asc.materials) {
      // Upsert du Material (partagé entre personnages)
      const material = await prisma.material.upsert({
        where: { name: mat.name },
        update: {},
        create: { name: mat.name, category: [] },
      });

      await prisma.ascensionMaterialItem.create({
        data: {
          value: mat.value,
          ascensionMaterialId: ascMat.id,
          materialId: material.id,
        },
      });
    }
  }
  console.log(`  ✓ AscensionMaterials (${enData.ascensionMaterials.length} paliers)`);

  // 5. NormalAttacks
  await prisma.normalAttackDescription.deleteMany({
    where: { normalAttackTranslation: { normalAttack: { characterId: character.id } } },
  });
  await prisma.normalAttackTranslation.deleteMany({
    where: { normalAttack: { characterId: character.id } },
  });
  await prisma.talentUpgrade.deleteMany({
    where: { normalAttackId: { not: null }, normalAttack: { characterId: character.id } },
  });
  await prisma.normalAttack.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.normalAttacks.length; i++) {
    const enNA = enData.normalAttacks[i];
    const na = await prisma.normalAttack.create({
      data: { unlock: enNA.unlock ?? null, characterId: character.id },
    });

    // Upgrades (données non traduites)
    for (const upgrade of enNA.upgrades ?? []) {
      await prisma.talentUpgrade.create({
        data: { name: upgrade.name, values: upgrade.values, normalAttackId: na.id },
      });
    }

    // Traductions
    for (const { lang, data } of allTranslations) {
      const tNA = data.normalAttacks?.[i];
      if (!tNA) continue;
      const translation = await prisma.normalAttackTranslation.create({
        data: { lang, name: tNA.name, note: tNA.note ?? null, normalAttackId: na.id },
      });
      await prisma.normalAttackDescription.createMany({
        data: buildDescriptions(tNA.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
    }
  }
  console.log(`  ✓ NormalAttacks`);

  // 6. ElementalSkills
  await prisma.elementalSkillDescription.deleteMany({
    where: { translation: { elementalSkill: { characterId: character.id } } },
  });
  await prisma.elementalSkillTranslation.deleteMany({
    where: { elementalSkill: { characterId: character.id } },
  });
  await prisma.talentUpgrade.deleteMany({
    where: { elementalSkillId: { not: null }, elementalSkill: { characterId: character.id } },
  });
  await prisma.elementalSkill.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.elementalSkills.length; i++) {
    const enES = enData.elementalSkills[i];
    const es = await prisma.elementalSkill.create({
      data: { unlock: enES.unlock ?? null, characterId: character.id },
    });

    for (const upgrade of enES.upgrades ?? []) {
      await prisma.talentUpgrade.create({
        data: { name: upgrade.name, values: upgrade.values, elementalSkillId: es.id },
      });
    }

    for (const { lang, data } of allTranslations) {
      const tES = data.elementalSkills?.[i];
      if (!tES) continue;
      const translation = await prisma.elementalSkillTranslation.create({
        data: { lang, name: tES.name, note: tES.note ?? null, elementalSkillId: es.id },
      });
      await prisma.elementalSkillDescription.createMany({
        data: buildDescriptions(tES.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
    }
  }
  console.log(`  ✓ ElementalSkills`);

  // 7. ElementalBursts
  await prisma.elementalBurstDescription.deleteMany({
    where: { translation: { elementalBurst: { characterId: character.id } } },
  });
  await prisma.elementalBurstTranslation.deleteMany({
    where: { elementalBurst: { characterId: character.id } },
  });
  await prisma.talentUpgrade.deleteMany({
    where: { elementalBurstId: { not: null }, elementalBurst: { characterId: character.id } },
  });
  await prisma.elementalBurst.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.elementalBursts.length; i++) {
    const enEB = enData.elementalBursts[i];
    const eb = await prisma.elementalBurst.create({
      data: { unlock: enEB.unlock ?? null, characterId: character.id },
    });

    for (const upgrade of enEB.upgrades ?? []) {
      await prisma.talentUpgrade.create({
        data: { name: upgrade.name, values: upgrade.values, elementalBurstId: eb.id },
      });
    }

    for (const { lang, data } of allTranslations) {
      const tEB = data.elementalBursts?.[i];
      if (!tEB) continue;
      const translation = await prisma.elementalBurstTranslation.create({
        data: { lang, name: tEB.name, note: tEB.note ?? null, elementalBurstId: eb.id },
      });
      await prisma.elementalBurstDescription.createMany({
        data: buildDescriptions(tEB.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
    }
  }
  console.log(`  ✓ ElementalBursts`);

  // 8. PassiveTalents
  await prisma.passiveTalentDescription.deleteMany({
    where: { translation: { passiveTalent: { characterId: character.id } } },
  });
  await prisma.passiveTalentTranslation.deleteMany({
    where: { passiveTalent: { characterId: character.id } },
  });
  await prisma.passiveTalentAttribute.deleteMany({
    where: { passiveTalentId: { in: await prisma.passiveTalent.findMany({ where: { characterId: character.id }, select: { id: true } }).then((r) => r.map((p) => p.id)) } },
  });
  await prisma.passiveTalent.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.passiveTalents.length; i++) {
    const enPT = enData.passiveTalents[i];
    const pt = await prisma.passiveTalent.create({
      data: {
        unlock: enPT.unlock ?? null,
        characterId: character.id,
        attributes: {
          create: (enPT.attributes ?? []).map((a) => ({ name: a.name, value: a.value })),
        },
      },
    });

    for (const { lang, data } of allTranslations) {
      const tPT = data.passiveTalents?.[i];
      if (!tPT) continue;
      const translation = await prisma.passiveTalentTranslation.create({
        data: { lang, name: tPT.name, note: tPT.note ?? null, passiveTalentId: pt.id },
      });
      await prisma.passiveTalentDescription.createMany({
        data: buildDescriptions(tPT.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
    }
  }
  console.log(`  ✓ PassiveTalents`);

  // 9. AscensionTalents
  await prisma.ascensionTalentDescription.deleteMany({
    where: { translation: { ascensionTalent: { characterId: character.id } } },
  });
  await prisma.ascensionTalentTranslation.deleteMany({
    where: { ascensionTalent: { characterId: character.id } },
  });
  await prisma.ascensionTalent.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.ascensionTalents.length; i++) {
    const enAT = enData.ascensionTalents[i];
    const at = await prisma.ascensionTalent.create({
      data: { unlock: enAT.unlock ?? null, characterId: character.id },
    });

    for (const { lang, data } of allTranslations) {
      const tAT = data.ascensionTalents?.[i];
      if (!tAT) continue;
      const translation = await prisma.ascensionTalentTranslation.create({
        data: { lang, name: tAT.name, ascensionTalentId: at.id },
      });
      await prisma.ascensionTalentDescription.createMany({
        data: buildDescriptions(tAT.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
    }
  }
  console.log(`  ✓ AscensionTalents`);

  // 10. AdditionalTalents
  await prisma.additionalTalentDescription.deleteMany({
    where: { translation: { additionalTalent: { characterId: character.id } } },
  });
  await prisma.additionalTalentTranslation.deleteMany({
    where: { additionalTalent: { characterId: character.id } },
  });
  await prisma.additionalTalent.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.additionalTalents.length; i++) {
    const enAdT = enData.additionalTalents[i];
    const adt = await prisma.additionalTalent.create({
      data: { unlock: enAdT.unlock ?? null, characterId: character.id },
    });

    for (const { lang, data } of allTranslations) {
      const tAdT = data.additionalTalents?.[i];
      if (!tAdT) continue;
      const translation = await prisma.additionalTalentTranslation.create({
        data: { lang, name: tAdT.name, additionalTalentId: adt.id },
      });
      await prisma.additionalTalentDescription.createMany({
        data: buildDescriptions(tAdT.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
    }
  }
  console.log(`  ✓ AdditionalTalents`);

  // 11. Constellations
  await prisma.constellationDescription.deleteMany({
    where: { translation: { constellation: { characterId: character.id } } },
  });
  await prisma.constellationHexereiDescription.deleteMany({
    where: { translation: { constellation: { characterId: character.id } } },
  });
  await prisma.constellationTranslation.deleteMany({
    where: { constellation: { characterId: character.id } },
  });
  await prisma.constellation.deleteMany({ where: { characterId: character.id } });

  for (let i = 0; i < enData.constellations.length; i++) {
    const enC = enData.constellations[i];
    const c = await prisma.constellation.create({
      data: { level: enC.level, characterId: character.id },
    });

    for (const { lang, data } of allTranslations) {
      const tC = data.constellations?.[i];
      if (!tC) continue;
      const translation = await prisma.constellationTranslation.create({
        data: { lang, name: tC.name, constellationId: c.id },
      });
      await prisma.constellationDescription.createMany({
        data: buildDescriptions(tC.descriptions).map((d) => ({
          ...d,
          translationId: translation.id,
        })),
      });
      if (tC.hexereiBuffDescriptions?.length) {
        await prisma.constellationHexereiDescription.createMany({
          data: buildDescriptions(tC.hexereiBuffDescriptions).map((d) => ({
            ...d,
            translationId: translation.id,
          })),
        });
      }
    }
  }
  console.log(`  ✓ Constellations`);
}

// ── Export principal ───────────────────────────────────────────────────────────
export async function seedCharacters(prisma: PrismaClient) {
  const charactersDir = path.resolve(__dirname, '../data/characters');
  const languages = fs.readdirSync(path.resolve(charactersDir, 'en')).map((file) =>
    path.basename(file, '.json'),
  );

  for (const charName of languages) {
    const enData = loadJson(`../data/characters/en/${charName}.json`);
    const translations: { lang: string; data: CharacterData }[] = [];
    const langDirs = fs.readdirSync(charactersDir).filter((l) => l !== 'en');

    for (const lang of langDirs) {
      const filePath = `../data/characters/${lang}/${charName}.json`;
      const fullPath = path.resolve(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        translations.push({ lang, data: loadJson(filePath) });
      }
    }

    await seedCharacter(prisma, enData, translations);
  }

  console.log('\n✅ Characters seedés.');
}