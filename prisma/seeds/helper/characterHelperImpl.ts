import { CharacterHelper } from "./characterHelper";
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DescriptionItem } from "../model/character/descriptionItem";
import { ObtainingTypes, PrismaClient } from "@prisma/client";
import { CharacterData } from "../model/character/character";
import { DEFAULT_LANG } from "../character.seed";

export class CharacterHelperImpl implements CharacterHelper {
  public loadJson(filePath: string): CharacterData {
    const fullPath = path.resolve(__dirname, filePath);
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  }

  public parseDate(value?: string): Date | null {
        if (!value) return null;
        const normalized = value.startsWith('0000-') ? `1900-${value.slice(5)}` : value;
        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? null : date;
  }

  public buildDescriptions(items: DescriptionItem[]) : DescriptionItem[] {
    return items.map((descriptions) => ({ title: descriptions.title ?? null, description: descriptions.description }));
  }

  public async upsertCharacter(prisma: PrismaClient, characterData: CharacterData) {
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

  public async upsertCharacterTranslations(prisma: PrismaClient, characterId: number, translations:{ language: string; characterData: CharacterData}[]) {
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

  public async characterLevelsRecreate(prisma: PrismaClient, characterId: number, characterData: CharacterData) {
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

  public async ascensionMaterialsRecreate(prisma: PrismaClient, character: CharacterData & { id: number }) {
    await prisma.ascensionMaterialItem.deleteMany({
      where: { ascensionMaterial: { characterId: character.id } },
    });

    await prisma.ascensionMaterial.deleteMany({ where: { characterId: character.id } });
      
    for (const ascension of character.ascensionMaterials) {
      const ascensionMaterial = await prisma.ascensionMaterial.create({
        data: { level: ascension.level, characterId: character.id },
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

  public async seedCharacter(prisma: PrismaClient, translations: { language: string; characterData: CharacterData }[]) {
    const character = await this.upsertCharacter(prisma, translations[0].characterData);

    console.log(`✓ Character upserted (id: ${character.id})`);

    await this.upsertCharacterTranslations(prisma, character.id , translations);
        
    console.log(`  ✓ CharacterTranslations (${translations.map((t) => t.language).join(', ')})`);
      
    // 3. CharacterLevels — delete + recreate (pas de clé naturelle simple)
    await this.characterLevelsRecreate(prisma, character.id, translations[0].characterData);

    console.log(`  ✓ CharacterLevels (${Object.keys(translations[0].characterData.levels).length} niveaux)`);
      
    // 4. AscensionMaterials
    await this.ascensionMaterialsRecreate(prisma, { ...translations[0].characterData, id: character.id });
    console.log(`  ✓ AscensionMaterials (${translations[0].characterData.ascensionMaterials.length} paliers)`);
      
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
}