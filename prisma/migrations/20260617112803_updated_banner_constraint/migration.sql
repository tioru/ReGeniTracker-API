/*
  Warnings:

  - A unique constraint covering the columns `[name,releaseDate]` on the table `Banner` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "RestockType" ADD VALUE 'DAILY';

-- AlterTable
ALTER TABLE "Weapon" ADD COLUMN     "releaseDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WeaponTranslation" ADD COLUMN     "history" TEXT;

-- CreateTable
CREATE TABLE "WeaponLevel" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "baseAtk" INTEGER NOT NULL,
    "weaponId" INTEGER NOT NULL,

    CONSTRAINT "WeaponLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponAscensionMaterial" (
    "id" SERIAL NOT NULL,
    "level" INTEGER NOT NULL,
    "weaponId" INTEGER NOT NULL,

    CONSTRAINT "WeaponAscensionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponAscensionMaterialItem" (
    "id" SERIAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ascensionMaterialId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "WeaponAscensionMaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponSeller" (
    "id" SERIAL NOT NULL,
    "cost" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "restock" "RestockType" NOT NULL,
    "weaponId" INTEGER NOT NULL,

    CONSTRAINT "WeaponSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponSellerTranslation" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "sellerId" INTEGER NOT NULL,

    CONSTRAINT "WeaponSellerTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeaponSellerTranslation_sellerId_language_key" ON "WeaponSellerTranslation"("sellerId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Banner_name_releaseDate_key" ON "Banner"("name", "releaseDate");

-- AddForeignKey
ALTER TABLE "WeaponLevel" ADD CONSTRAINT "WeaponLevel_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponAscensionMaterial" ADD CONSTRAINT "WeaponAscensionMaterial_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponAscensionMaterialItem" ADD CONSTRAINT "WeaponAscensionMaterialItem_ascensionMaterialId_fkey" FOREIGN KEY ("ascensionMaterialId") REFERENCES "WeaponAscensionMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponAscensionMaterialItem" ADD CONSTRAINT "WeaponAscensionMaterialItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponSeller" ADD CONSTRAINT "WeaponSeller_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponSellerTranslation" ADD CONSTRAINT "WeaponSellerTranslation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "WeaponSeller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
