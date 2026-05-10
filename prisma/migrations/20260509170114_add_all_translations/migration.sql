/*
  Warnings:

  - You are about to drop the column `name` on the `AscensionMaterial` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `AscensionMaterial` table. All the data in the column will be lost.
  - You are about to drop the column `affiliation` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `constellation` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Constellation` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Constellation` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `PassiveTalent` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `PassiveTalent` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `SkillTalent` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `SkillTalent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AscensionMaterial" DROP COLUMN "name",
DROP COLUMN "value";

-- AlterTable
ALTER TABLE "Character" DROP COLUMN "affiliation",
DROP COLUMN "constellation",
DROP COLUMN "description",
DROP COLUMN "title";

-- AlterTable
ALTER TABLE "Constellation" DROP COLUMN "description",
DROP COLUMN "name";

-- AlterTable
ALTER TABLE "PassiveTalent" DROP COLUMN "description",
DROP COLUMN "name";

-- AlterTable
ALTER TABLE "SkillTalent" DROP COLUMN "description",
DROP COLUMN "name";

-- CreateTable
CREATE TABLE "AscensionMaterialTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "ascensionMaterialId" INTEGER NOT NULL,

    CONSTRAINT "AscensionMaterialTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillTalentTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "skillTalentId" INTEGER NOT NULL,

    CONSTRAINT "SkillTalentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassiveTalentTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "passiveTalentId" INTEGER NOT NULL,

    CONSTRAINT "PassiveTalentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstellationTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "constellationId" INTEGER NOT NULL,

    CONSTRAINT "ConstellationTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AscensionMaterialTranslation_ascensionMaterialId_lang_key" ON "AscensionMaterialTranslation"("ascensionMaterialId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "SkillTalentTranslation_skillTalentId_lang_key" ON "SkillTalentTranslation"("skillTalentId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "PassiveTalentTranslation_passiveTalentId_lang_key" ON "PassiveTalentTranslation"("passiveTalentId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "ConstellationTranslation_constellationId_lang_key" ON "ConstellationTranslation"("constellationId", "lang");

-- AddForeignKey
ALTER TABLE "AscensionMaterialTranslation" ADD CONSTRAINT "AscensionMaterialTranslation_ascensionMaterialId_fkey" FOREIGN KEY ("ascensionMaterialId") REFERENCES "AscensionMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTalentTranslation" ADD CONSTRAINT "SkillTalentTranslation_skillTalentId_fkey" FOREIGN KEY ("skillTalentId") REFERENCES "SkillTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassiveTalentTranslation" ADD CONSTRAINT "PassiveTalentTranslation_passiveTalentId_fkey" FOREIGN KEY ("passiveTalentId") REFERENCES "PassiveTalent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstellationTranslation" ADD CONSTRAINT "ConstellationTranslation_constellationId_fkey" FOREIGN KEY ("constellationId") REFERENCES "Constellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
