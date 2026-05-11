/*
  Warnings:

  - You are about to drop the column `description` on the `ConstellationTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `PassiveTalentTranslation` table. All the data in the column will be lost.
  - You are about to drop the `AscensionMaterialTranslation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SkillTalent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SkillTalentTranslation` table. If the table is not empty, all the data it contains will be lost.
  - Changed the type of `level` on the `AscensionMaterial` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `specialDish` to the `Character` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ObtainingTypes" AS ENUM ('STANDARD_WISHES', 'CHRONICLED_WISHES', 'CHARACTER_EVENT_WISHES');

-- CreateEnum
CREATE TYPE "UnlockTypes" AS ENUM ('DEFAULT_UNLOCK', 'ASCENSION_1_UNLOCK', 'ASCENSION_2_UNLOCK', 'ASCENSION_3_UNLOCK', 'ASCENSION_4_UNLOCK', 'ASCENSION_5_UNLOCK', 'ASCENSION_6_UNLOCK', 'WITCH_HOMEWORK_UNLOCK');

-- DropForeignKey
ALTER TABLE "AscensionMaterialTranslation" DROP CONSTRAINT "AscensionMaterialTranslation_ascensionMaterialId_fkey";

-- DropForeignKey
ALTER TABLE "SkillTalent" DROP CONSTRAINT "SkillTalent_characterId_fkey";

-- DropForeignKey
ALTER TABLE "SkillTalentTranslation" DROP CONSTRAINT "SkillTalentTranslation_skillTalentId_fkey";

-- AlterTable
ALTER TABLE "AscensionMaterial" DROP COLUMN "level",
ADD COLUMN     "level" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "obtaining" "ObtainingTypes"[],
ADD COLUMN     "specialDish" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ConstellationTranslation" DROP COLUMN "description";

-- AlterTable
ALTER TABLE "PassiveTalentTranslation" DROP COLUMN "description",
ADD COLUMN     "note" TEXT;

-- DropTable
DROP TABLE "AscensionMaterialTranslation";

-- DropTable
DROP TABLE "SkillTalent";

-- DropTable
DROP TABLE "SkillTalentTranslation";

-- CreateTable
CREATE TABLE "CharacterLevel" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "baseHp" INTEGER NOT NULL,
    "baseDef" INTEGER NOT NULL,
    "baseAtk" INTEGER NOT NULL,
    "energyRecharge" TEXT NOT NULL,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "CharacterLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AscensionMaterialItem" (
    "id" SERIAL NOT NULL,
    "value" INTEGER NOT NULL,
    "ascensionMaterialId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "AscensionMaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "rarity" INTEGER,
    "category" TEXT[],

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "MaterialTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialSource" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "MaterialSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalAttack" (
    "id" SERIAL NOT NULL,
    "unlock" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "NormalAttack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalAttackTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "normalAttackId" INTEGER NOT NULL,

    CONSTRAINT "NormalAttackTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalAttackDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "NormalAttackDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementalSkill" (
    "id" SERIAL NOT NULL,
    "unlock" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "ElementalSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementalSkillTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "elementalSkillId" INTEGER NOT NULL,

    CONSTRAINT "ElementalSkillTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementalSkillDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "ElementalSkillDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementalBurst" (
    "id" SERIAL NOT NULL,
    "unlock" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "ElementalBurst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementalBurstTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "elementalBurstId" INTEGER NOT NULL,

    CONSTRAINT "ElementalBurstTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementalBurstDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "ElementalBurstDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassiveTalentDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "PassiveTalentDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassiveTalentAttribute" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "passiveTalentId" INTEGER NOT NULL,

    CONSTRAINT "PassiveTalentAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AscensionTalent" (
    "id" SERIAL NOT NULL,
    "unlock" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "AscensionTalent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AscensionTalentTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ascensionTalentId" INTEGER NOT NULL,

    CONSTRAINT "AscensionTalentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AscensionTalentDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "AscensionTalentDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalTalent" (
    "id" SERIAL NOT NULL,
    "unlock" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "AdditionalTalent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalTalentTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "additionalTalentId" INTEGER NOT NULL,

    CONSTRAINT "AdditionalTalentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalTalentDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "AdditionalTalentDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstellationDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "ConstellationDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstellationHexereiDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "translationId" INTEGER NOT NULL,

    CONSTRAINT "ConstellationHexereiDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentUpgrade" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "values" TEXT[],
    "normalAttackId" INTEGER,
    "elementalSkillId" INTEGER,
    "elementalBurstId" INTEGER,

    CONSTRAINT "TalentUpgrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Material_name_key" ON "Material"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialTranslation_materialId_lang_key" ON "MaterialTranslation"("materialId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "NormalAttackTranslation_normalAttackId_lang_key" ON "NormalAttackTranslation"("normalAttackId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "ElementalSkillTranslation_elementalSkillId_lang_key" ON "ElementalSkillTranslation"("elementalSkillId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "ElementalBurstTranslation_elementalBurstId_lang_key" ON "ElementalBurstTranslation"("elementalBurstId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "AscensionTalentTranslation_ascensionTalentId_lang_key" ON "AscensionTalentTranslation"("ascensionTalentId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalTalentTranslation_additionalTalentId_lang_key" ON "AdditionalTalentTranslation"("additionalTalentId", "lang");

-- AddForeignKey
ALTER TABLE "CharacterLevel" ADD CONSTRAINT "CharacterLevel_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AscensionMaterialItem" ADD CONSTRAINT "AscensionMaterialItem_ascensionMaterialId_fkey" FOREIGN KEY ("ascensionMaterialId") REFERENCES "AscensionMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AscensionMaterialItem" ADD CONSTRAINT "AscensionMaterialItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTranslation" ADD CONSTRAINT "MaterialTranslation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSource" ADD CONSTRAINT "MaterialSource_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalAttack" ADD CONSTRAINT "NormalAttack_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalAttackTranslation" ADD CONSTRAINT "NormalAttackTranslation_normalAttackId_fkey" FOREIGN KEY ("normalAttackId") REFERENCES "NormalAttack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalAttackDescription" ADD CONSTRAINT "NormalAttackDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "NormalAttackTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementalSkill" ADD CONSTRAINT "ElementalSkill_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementalSkillTranslation" ADD CONSTRAINT "ElementalSkillTranslation_elementalSkillId_fkey" FOREIGN KEY ("elementalSkillId") REFERENCES "ElementalSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementalSkillDescription" ADD CONSTRAINT "ElementalSkillDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ElementalSkillTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementalBurst" ADD CONSTRAINT "ElementalBurst_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementalBurstTranslation" ADD CONSTRAINT "ElementalBurstTranslation_elementalBurstId_fkey" FOREIGN KEY ("elementalBurstId") REFERENCES "ElementalBurst"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementalBurstDescription" ADD CONSTRAINT "ElementalBurstDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ElementalBurstTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassiveTalentDescription" ADD CONSTRAINT "PassiveTalentDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "PassiveTalentTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassiveTalentAttribute" ADD CONSTRAINT "PassiveTalentAttribute_passiveTalentId_fkey" FOREIGN KEY ("passiveTalentId") REFERENCES "PassiveTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AscensionTalent" ADD CONSTRAINT "AscensionTalent_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AscensionTalentTranslation" ADD CONSTRAINT "AscensionTalentTranslation_ascensionTalentId_fkey" FOREIGN KEY ("ascensionTalentId") REFERENCES "AscensionTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AscensionTalentDescription" ADD CONSTRAINT "AscensionTalentDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "AscensionTalentTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalTalent" ADD CONSTRAINT "AdditionalTalent_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalTalentTranslation" ADD CONSTRAINT "AdditionalTalentTranslation_additionalTalentId_fkey" FOREIGN KEY ("additionalTalentId") REFERENCES "AdditionalTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalTalentDescription" ADD CONSTRAINT "AdditionalTalentDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "AdditionalTalentTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstellationDescription" ADD CONSTRAINT "ConstellationDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ConstellationTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstellationHexereiDescription" ADD CONSTRAINT "ConstellationHexereiDescription_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ConstellationTranslation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentUpgrade" ADD CONSTRAINT "TalentUpgrade_normalAttackId_fkey" FOREIGN KEY ("normalAttackId") REFERENCES "NormalAttack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentUpgrade" ADD CONSTRAINT "TalentUpgrade_elementalSkillId_fkey" FOREIGN KEY ("elementalSkillId") REFERENCES "ElementalSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentUpgrade" ADD CONSTRAINT "TalentUpgrade_elementalBurstId_fkey" FOREIGN KEY ("elementalBurstId") REFERENCES "ElementalBurst"("id") ON DELETE SET NULL ON UPDATE CASCADE;
