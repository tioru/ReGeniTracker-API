/*
  Warnings:

  - You are about to drop the column `lang` on the `AdditionalTalentTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `AscensionMaterialItem` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `AscensionTalentTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `CharacterTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `ConstellationTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `ElementalBurstTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `ElementalSkillTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `MaterialSellerTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `MaterialSourceTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `MaterialTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `MaterialUseTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `NormalAttackTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `note` on the `NormalAttackTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `PassiveTalentTranslation` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `RecipeIngredientTranslation` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[additionalTalentId,language]` on the table `AdditionalTalentTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ascensionTalentId,language]` on the table `AscensionTalentTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[characterId,language]` on the table `CharacterTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[constellationId,language]` on the table `ConstellationTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[elementalBurstId,language]` on the table `ElementalBurstTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[elementalSkillId,language]` on the table `ElementalSkillTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sellerId,language]` on the table `MaterialSellerTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sourceId,language]` on the table `MaterialSourceTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[materialId,language]` on the table `MaterialTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[useId,language]` on the table `MaterialUseTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[normalAttackId,language]` on the table `NormalAttackTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[passiveTalentId,language]` on the table `PassiveTalentTranslation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ingredientId,language]` on the table `RecipeIngredientTranslation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `language` to the `AdditionalTalentTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantity` to the `AscensionMaterialItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `AscensionTalentTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `CharacterTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `ConstellationTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `ElementalBurstTranslation` table without a default value. This is not possible if the table is not empty.
  - Made the column `note` on table `ElementalBurstTranslation` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `language` to the `ElementalSkillTranslation` table without a default value. This is not possible if the table is not empty.
  - Made the column `note` on table `ElementalSkillTranslation` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `language` to the `MaterialSellerTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `MaterialSourceTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `MaterialTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `MaterialUseTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `NormalAttackTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `PassiveTalentTranslation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `RecipeIngredientTranslation` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AdditionalTalentTranslation_additionalTalentId_lang_key";

-- DropIndex
DROP INDEX "AscensionTalentTranslation_ascensionTalentId_lang_key";

-- DropIndex
DROP INDEX "CharacterTranslation_characterId_lang_key";

-- DropIndex
DROP INDEX "ConstellationTranslation_constellationId_lang_key";

-- DropIndex
DROP INDEX "ElementalBurstTranslation_elementalBurstId_lang_key";

-- DropIndex
DROP INDEX "ElementalSkillTranslation_elementalSkillId_lang_key";

-- DropIndex
DROP INDEX "MaterialSellerTranslation_sellerId_lang_key";

-- DropIndex
DROP INDEX "MaterialSourceTranslation_sourceId_lang_key";

-- DropIndex
DROP INDEX "MaterialTranslation_materialId_lang_key";

-- DropIndex
DROP INDEX "MaterialUseTranslation_useId_lang_key";

-- DropIndex
DROP INDEX "NormalAttackTranslation_normalAttackId_lang_key";

-- DropIndex
DROP INDEX "PassiveTalentTranslation_passiveTalentId_lang_key";

-- DropIndex
DROP INDEX "RecipeIngredientTranslation_ingredientId_lang_key";

-- AlterTable
ALTER TABLE "AdditionalTalentTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "AscensionMaterialItem" DROP COLUMN "value",
ADD COLUMN     "quantity" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "AscensionTalentTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "CharacterTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ConstellationTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ElementalBurstTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL,
ALTER COLUMN "note" SET NOT NULL;

-- AlterTable
ALTER TABLE "ElementalSkillTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL,
ALTER COLUMN "note" SET NOT NULL;

-- AlterTable
ALTER TABLE "MaterialSellerTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MaterialSourceTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MaterialTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MaterialUseTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "NormalAttackTranslation" DROP COLUMN "lang",
DROP COLUMN "note",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PassiveTalentTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RecipeIngredientTranslation" DROP COLUMN "lang",
ADD COLUMN     "language" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalTalentTranslation_additionalTalentId_language_key" ON "AdditionalTalentTranslation"("additionalTalentId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "AscensionTalentTranslation_ascensionTalentId_language_key" ON "AscensionTalentTranslation"("ascensionTalentId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterTranslation_characterId_language_key" ON "CharacterTranslation"("characterId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ConstellationTranslation_constellationId_language_key" ON "ConstellationTranslation"("constellationId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ElementalBurstTranslation_elementalBurstId_language_key" ON "ElementalBurstTranslation"("elementalBurstId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ElementalSkillTranslation_elementalSkillId_language_key" ON "ElementalSkillTranslation"("elementalSkillId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSellerTranslation_sellerId_language_key" ON "MaterialSellerTranslation"("sellerId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialSourceTranslation_sourceId_language_key" ON "MaterialSourceTranslation"("sourceId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialTranslation_materialId_language_key" ON "MaterialTranslation"("materialId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialUseTranslation_useId_language_key" ON "MaterialUseTranslation"("useId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "NormalAttackTranslation_normalAttackId_language_key" ON "NormalAttackTranslation"("normalAttackId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "PassiveTalentTranslation_passiveTalentId_language_key" ON "PassiveTalentTranslation"("passiveTalentId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredientTranslation_ingredientId_language_key" ON "RecipeIngredientTranslation"("ingredientId", "language");
