/*
  Warnings:

  - You are about to drop the column `category` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `MaterialSource` table. All the data in the column will be lost.
  - Changed the type of `type` on the `MaterialSource` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "MaterialCategories" AS ENUM ('NAGADUS_EMERALD', 'VARUNADA_LAZURITE', 'ASCENSION_GEMS');

-- CreateEnum
CREATE TYPE "MaterialSourceTypes" AS ENUM ('COMMON_ENEMY', 'BOSS', 'WEEKLY_BOSS', 'ALCHEMY');

-- CreateEnum
CREATE TYPE "AlchemySubTypes" AS ENUM ('CRAFTING', 'CONVERTING');

-- CreateEnum
CREATE TYPE "RestockType" AS ENUM ('NEVER', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CharacterMaterialType" AS ENUM ('ASCENSION', 'TALENT');

-- AlterTable
ALTER TABLE "Material" DROP COLUMN "category",
ADD COLUMN     "categories" "MaterialCategories"[];

-- AlterTable
ALTER TABLE "MaterialSource" DROP COLUMN "name",
ADD COLUMN     "minimumLevel" INTEGER,
ADD COLUMN     "names" TEXT[],
DROP COLUMN "type",
ADD COLUMN     "type" "MaterialSourceTypes" NOT NULL;

-- CreateTable
CREATE TABLE "AlchemyRecipe" (
    "id" SERIAL NOT NULL,
    "subtype" "AlchemySubTypes" NOT NULL,
    "resultQuantity" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,

    CONSTRAINT "AlchemyRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" SERIAL NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "recipeId" INTEGER NOT NULL,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialSeller" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "restock" "RestockType" NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "MaterialSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialUse" (
    "id" SERIAL NOT NULL,
    "itemName" TEXT NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "MaterialUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterMaterialUse" (
    "id" SERIAL NOT NULL,
    "characterName" TEXT NOT NULL,
    "type" "CharacterMaterialType" NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "CharacterMaterialUse_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AlchemyRecipe" ADD CONSTRAINT "AlchemyRecipe_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MaterialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "AlchemyRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSeller" ADD CONSTRAINT "MaterialSeller_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUse" ADD CONSTRAINT "MaterialUse_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterMaterialUse" ADD CONSTRAINT "CharacterMaterialUse_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
