import { CharacterHelper } from "./characterHelper";
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObtainingTypes, PrismaClient } from "@prisma/client";
import { CharacterData } from "../../model/character/character";
import { DescriptionItemData } from "../../model/character/DescriptionItem";

export const BUFFER_ENCODING = 'utf-8';

export class CharacterHelperImpl implements CharacterHelper {
  public loadJson(filePath: string): CharacterData {
    const fullPath = path.resolve(__dirname, filePath);
    return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as CharacterData;
  }

  public parseDate(value?: string): Date | null {
        if (!value) return null;
        const normalized = value.startsWith('0000-') ? `1900-${value.slice(5)}` : value;
        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? null : date;
  }

  public buildDescriptions(items: DescriptionItemData[]): DescriptionItemData[] {
    return items.map((descriptions) => ({ title: descriptions.title ?? null, description: descriptions.description }));
  }

  public async upsertCharacter(prisma: PrismaClient, characterData: CharacterData) : Promise<{id: number; name: string; rarity: number; vision: string; weapon: string; nation: string; birthday: Date | null; releaseDate: Date | null; obtaining: ObtainingTypes[]}> {
      return await prisma.character.upsert({
        where: { name: characterData.name },
        update: {
          rarity: characterData.rarity,
          vision: characterData.vision,
          weapon: characterData.weapon,
          nation: characterData.nation,
          birthday: this.parseDate(characterData.birthday),
          releaseDate: this.parseDate(characterData.releaseDate),
          obtaining: characterData.obtaining,
        },
        create: {
          name: characterData.name,
          rarity: characterData.rarity,
          vision: characterData.vision,
          weapon: characterData.weapon,
          nation: characterData.nation,
          birthday: this.parseDate(characterData.birthday),
          releaseDate: this.parseDate(characterData.releaseDate),
          obtaining: characterData.obtaining,
        },
      });
  }

  public async upsertCharacterTranslations(prisma: PrismaClient, characterId: number, translations:{ language: string; characterData: CharacterData}[]): Promise<void> {
    for (const { language, characterData } of translations) {
      await prisma.characterTranslation.upsert({
        where: { characterId_language: { characterId: characterId, language } },
        update: {
          title: characterData.title ?? null,
          description: characterData.description ?? null,
          affiliation: characterData.affiliation ?? null,
          constellation: characterData.constellation ?? null,
          specialDish: characterData.specialDish ?? null,
        },
        create: {
          language: language,
          title: characterData.title ?? null,
          description: characterData.description ?? null,
          affiliation: characterData.affiliation ?? null,
          constellation: characterData.constellation ?? null,
          specialDish: characterData.specialDish ?? null,
          characterId: characterId,
        },
      });
    }
  }

  public async characterLevelsRecreate(prisma: PrismaClient, characterId: number, characterData: CharacterData): Promise<void> {
    await prisma.characterLevel.deleteMany({ where: { characterId: characterId } });
    await prisma.characterLevel.createMany({
      data: Object.entries(characterData.levels).map(([level, stats]) => ({
        level,
        baseHp: stats.baseHp,
        baseDef: stats.baseDef,
        baseAtk: stats.baseAtk,
        energyRecharge: stats.energyRecharge,
        characterId: characterId,
      })),
    });
  }

  public async ascensionMaterialsRecreate(prisma: PrismaClient, characterId: number, characterData: CharacterData): Promise<void> {
    await prisma.ascensionMaterialItem.deleteMany({
      where: { ascensionMaterial: { characterId: characterId } },
    });

    await prisma.ascensionMaterial.deleteMany({ where: { characterId: characterId } });
      
    for (const ascension of characterData.ascensionMaterials) {
      const ascensionMaterial = await prisma.ascensionMaterial.create({
        data: { level: ascension.level, characterId: characterId },
      });
        
      for (const mat of ascension.materials) {
        const material = await prisma.material.upsert({
          where: { name: mat.name },
          update: {},
          create: { name: mat.name, categories: [] },
        });
          
        await prisma.ascensionMaterialItem.create({
          data: {
            quantity: mat.quantity,
            ascensionMaterialId: ascensionMaterial.id,
            materialId: material.id,
          },
        });
      }
    }
  }

  public async normalAttacksRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData}[]): Promise<void> {
    await prisma.normalAttackDescription.deleteMany({
      where: { normalAttackTranslation: { normalAttack: { characterId: characterId } } },
    });
    await prisma.normalAttackTranslation.deleteMany({
      where: { normalAttack: { characterId: characterId } },
    });
    await prisma.talentUpgrade.deleteMany({
      where: { normalAttackId: { not: null }, normalAttack: { characterId: characterId } },
    });
    await prisma.normalAttack.deleteMany({ where: { characterId: characterId } });
      
    for (let i = 0; i < translations[0].characterData.normalAttacks.length; i++) {
      const normalAttackData = translations[0].characterData.normalAttacks[i];
      const normalAttack = await prisma.normalAttack.create({
        data: { unlock: normalAttackData.unlock, characterId: characterId },
      });
        
      for (const upgrade of normalAttackData.upgrades) {
        await prisma.talentUpgrade.create({
          data: { name: upgrade.name, values: upgrade.values, normalAttackId: normalAttack.id },
        });
      }
        
      for (const { language, characterData } of translations) {
        const normalAttackData = characterData.normalAttacks?.[i];
        const translation = await prisma.normalAttackTranslation.create({
          data: { language: language, name: normalAttackData.name, normalAttackId: normalAttack.id },
        });
        await prisma.normalAttackDescription.createMany({
          data: this.buildDescriptions(normalAttackData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
      }
    }
  }

  public async elementalSkillsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData}[]): Promise<void> {
    await prisma.elementalSkillDescription.deleteMany({
      where: { translation: { elementalSkill: { characterId: characterId } } },
    });
    await prisma.elementalSkillTranslation.deleteMany({
      where: { elementalSkill: { characterId: characterId } },
    });
    await prisma.talentUpgrade.deleteMany({
      where: { elementalSkillId: { not: null }, elementalSkill: { characterId: characterId } },
    });
    await prisma.elementalSkill.deleteMany({ where: { characterId: characterId } });
      
    for (let i = 0; i < translations[0].characterData.elementalSkills.length; i++) {
      const elementalSkillData = translations[0].characterData.elementalSkills[i];
      const elementalSkill = await prisma.elementalSkill.create({
        data: { unlock: elementalSkillData.unlock, characterId: characterId },
      });
        
      for (const upgrade of elementalSkillData.upgrades) {
        await prisma.talentUpgrade.create({
          data: { name: upgrade.name, values: upgrade.values, elementalSkillId: elementalSkill.id },
        });
      }
        
      for (const { language, characterData } of translations) {
        const elementalSkillData = characterData.elementalSkills?.[i];
        const translation = await prisma.elementalSkillTranslation.create({
          data: { language: language, name: elementalSkillData.name, note: elementalSkillData.note, elementalSkillId: elementalSkill.id },
        });
        await prisma.elementalSkillDescription.createMany({
          data: this.buildDescriptions(elementalSkillData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
      }
    }
  }

  public async elementalBurstsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void> {
    await prisma.elementalBurstDescription.deleteMany({
      where: { translation: { elementalBurst: { characterId: characterId } } },
    });
    await prisma.elementalBurstTranslation.deleteMany({
      where: { elementalBurst: { characterId: characterId } },
    });
    await prisma.talentUpgrade.deleteMany({
      where: { elementalBurstId: { not: null }, elementalBurst: { characterId: characterId } },
    });
    await prisma.elementalBurst.deleteMany({ where: { characterId: characterId } });
      
    for (let i = 0; i < translations[0].characterData.elementalBursts.length; i++) {
      const elementalBurstData = translations[0].characterData.elementalBursts[i];
      const elementalBurst = await prisma.elementalBurst.create({
        data: { unlock: elementalBurstData.unlock, characterId: characterId },
      });
      
      for (const upgrade of elementalBurstData.upgrades) {
        await prisma.talentUpgrade.create({
          data: { name: upgrade.name, values: upgrade.values, elementalBurstId: elementalBurst.id },
        });
      }
        
      for (const { language, characterData } of translations) {
        const elementalBurstData = characterData.elementalBursts?.[i];
        const translation = await prisma.elementalBurstTranslation.create({
          data: { language: language, name: elementalBurstData.name, note: elementalBurstData.note, elementalBurstId: elementalBurst.id },
        });
        await prisma.elementalBurstDescription.createMany({
          data: this.buildDescriptions(elementalBurstData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
      }
    }
  }

  public async passiveTalentsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void> {
    await prisma.passiveTalentDescription.deleteMany({
      where: { translation: { passiveTalent: { characterId: characterId } } },
    });
    await prisma.passiveTalentTranslation.deleteMany({
      where: { passiveTalent: { characterId: characterId } },
    });
    await prisma.passiveTalentAttribute.deleteMany({
      where: { passiveTalentId: { in: await prisma.passiveTalent.findMany({ where: { characterId: characterId }, select: { id: true } }).then((r) => r.map((passiveTalent) => passiveTalent.id)) } },
    });
    await prisma.passiveTalent.deleteMany({ where: { characterId: characterId } });
      
    for (let i = 0; i < translations[0].characterData.passiveTalents.length; i++) {
      const passiveTalentData = translations[0].characterData.passiveTalents[i];
      const passiveTalent = await prisma.passiveTalent.create({
        data: {
          unlock: passiveTalentData.unlock,
          characterId: characterId,
          attributes: {
            create: (passiveTalentData.attributes).map((attribute) => ({ name: attribute.name, value: attribute.value })),
          },
        },
      });
        
      for (const { language, characterData } of translations) {
        const passiveTalentData = characterData.passiveTalents?.[i];
        const translation = await prisma.passiveTalentTranslation.create({
          data: { language: language, name: passiveTalentData.name ?? null, passiveTalentId: passiveTalent.id },
        });
        await prisma.passiveTalentDescription.createMany({
          data: this.buildDescriptions(passiveTalentData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
      }
    }
  }

  public async ascensionTalentsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void> {
    await prisma.ascensionTalentDescription.deleteMany({
      where: { translation: { ascensionTalent: { characterId: characterId } } },
    });
    await prisma.ascensionTalentTranslation.deleteMany({
      where: { ascensionTalent: { characterId: characterId } },
    });
    await prisma.ascensionTalent.deleteMany({ where: { characterId: characterId } });
      
    for (let i = 0; i < translations[0].characterData.ascensionTalents.length; i++) {
      const ascensionTalentData = translations[0].characterData.ascensionTalents[i];
      const ascensionTalent = await prisma.ascensionTalent.create({
        data: { unlock: ascensionTalentData.unlock, characterId: characterId },
      });

      for (const { language, characterData } of translations) {
        const ascensionTalentData = characterData.ascensionTalents?.[i];
        const translation = await prisma.ascensionTalentTranslation.create({
          data: { language: language, name: ascensionTalentData.name, ascensionTalentId: ascensionTalent.id },
        });
        await prisma.ascensionTalentDescription.createMany({
          data: this.buildDescriptions(ascensionTalentData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
      }
    }
  }

  public async additionalTalentsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void> {
    await prisma.additionalTalentDescription.deleteMany({
      where: { translation: { additionalTalent: { characterId: characterId } } },
    });
    await prisma.additionalTalentTranslation.deleteMany({
      where: { additionalTalent: { characterId: characterId } },
    });
    await prisma.additionalTalent.deleteMany({ where: { characterId: characterId } });
    
    for (let i = 0; i < translations[0].characterData.additionalTalents.length; i++) {
      const additionalTalentData = translations[0].characterData.additionalTalents[i];
      const additionalTalent = await prisma.additionalTalent.create({
        data: { unlock: additionalTalentData.unlock, characterId: characterId },
      });

      for (const { language, characterData } of translations) {
        const additionalTalentData = characterData.additionalTalents?.[i];
        const translation = await prisma.additionalTalentTranslation.create({
          data: { language, name: additionalTalentData.name, additionalTalentId: additionalTalent.id },
        });
        await prisma.additionalTalentDescription.createMany({
          data: this.buildDescriptions(additionalTalentData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
      }
    }
  }

  public async constellationsRecreate(prisma: PrismaClient, characterId: number, translations: { language: string; characterData: CharacterData }[]): Promise<void> {
    await prisma.constellationDescription.deleteMany({
      where: { translation: { constellation: { characterId: characterId } } },
    });
    await prisma.constellationHexereiDescription.deleteMany({
      where: { translation: { constellation: { characterId: characterId } } },
    });
    await prisma.constellationTranslation.deleteMany({
      where: { constellation: { characterId: characterId } },
    });
    await prisma.constellation.deleteMany({ where: { characterId: characterId } });
      
    for (let i = 0; i < translations[0].characterData.constellations.length; i++) {
      const constellationData = translations[0].characterData.constellations[i];
      const constellation = await prisma.constellation.create({
        data: { level: constellationData.level, characterId: characterId },
      });
        
      for (const { language, characterData } of translations) {
        const constellationData = characterData.constellations?.[i];
        const translation = await prisma.constellationTranslation.create({
          data: { language: language, name: constellationData.name, constellationId: constellation.id },
        });
        await prisma.constellationDescription.createMany({
          data: this.buildDescriptions(constellationData.descriptions).map((description) => ({
            ...description,
            translationId: translation.id,
          })),
        });
        if (constellationData.hexereiBuffDescriptions?.length) {
          await prisma.constellationHexereiDescription.createMany({
            data: this.buildDescriptions(constellationData.hexereiBuffDescriptions).map((description) => ({
              ...description,
              translationId: translation.id,
            })),
          });
        }
      }
    }
  }

  public async seedCharacter(prisma: PrismaClient, translations: { language: string; characterData: CharacterData }[]): Promise<void> {
    const character = await this.upsertCharacter(prisma, translations[0].characterData);
    console.log(`Character upserted (id: ${character.id})`);

    await this.upsertCharacterTranslations(prisma, character.id , translations);
    console.log(`CharacterTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);
      
    await this.characterLevelsRecreate(prisma, character.id, translations[0].characterData);
    console.log(`CharacterLevels recreated (${Object.keys(translations[0].characterData.levels).length} niveaux)`);
      
    await this.ascensionMaterialsRecreate(prisma, character.id, translations[0].characterData);
    console.log(`AscensionMaterials recreated (${translations[0].characterData.ascensionMaterials.length} paliers)`);
      
    await this.normalAttacksRecreate(prisma, character.id, translations);
    console.log(`NormalAttacks recreated`);

    await this.elementalSkillsRecreate(prisma, character.id, translations);
    console.log(`ElementalSkills recreated`);

    await this.elementalBurstsRecreate(prisma, character.id, translations);
    console.log(`ElementalBursts recreated`);

    await this.passiveTalentsRecreate(prisma, character.id, translations);
    console.log(`PassiveTalents recreated`);
      
    await this.ascensionTalentsRecreate(prisma, character.id, translations);
    console.log(`AscensionTalents recreated`);
      
    await this.additionalTalentsRecreate(prisma, character.id, translations);
    console.log(`AdditionalTalents recreated`);
    
    await this.constellationsRecreate(prisma, character.id, translations);
    console.log(`Constellations recreated`);
  }
}