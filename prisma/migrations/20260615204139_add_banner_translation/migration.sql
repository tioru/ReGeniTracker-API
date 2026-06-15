-- CreateEnum
CREATE TYPE "WeaponTypes" AS ENUM ('SWORD', 'CLAYMORE', 'POLEARM', 'BOW', 'CATALYST');

-- CreateEnum
CREATE TYPE "BannerTypes" AS ENUM ('CHARACTER', 'WEAPON');

-- CreateEnum
CREATE TYPE "FeaturedRoles" AS ENUM ('BOOSTED', 'OTHER');

-- CreateTable
CREATE TABLE "Weapon" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "rarity" INTEGER NOT NULL,
    "type" "WeaponTypes" NOT NULL,

    CONSTRAINT "Weapon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponTranslation" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weaponId" INTEGER NOT NULL,

    CONSTRAINT "WeaponTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BannerTypes" NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerCharacter" (
    "id" SERIAL NOT NULL,
    "rarity" INTEGER NOT NULL,
    "role" "FeaturedRoles" NOT NULL,
    "bannerId" INTEGER NOT NULL,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "BannerCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerWeapon" (
    "id" SERIAL NOT NULL,
    "rarity" INTEGER NOT NULL,
    "role" "FeaturedRoles" NOT NULL,
    "bannerId" INTEGER NOT NULL,
    "weaponId" INTEGER NOT NULL,

    CONSTRAINT "BannerWeapon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerTranslation" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bannerId" INTEGER NOT NULL,

    CONSTRAINT "BannerTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Weapon_name_key" ON "Weapon"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WeaponTranslation_weaponId_language_key" ON "WeaponTranslation"("weaponId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "BannerCharacter_bannerId_characterId_key" ON "BannerCharacter"("bannerId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "BannerWeapon_bannerId_weaponId_key" ON "BannerWeapon"("bannerId", "weaponId");

-- CreateIndex
CREATE UNIQUE INDEX "BannerTranslation_bannerId_language_key" ON "BannerTranslation"("bannerId", "language");

-- AddForeignKey
ALTER TABLE "WeaponTranslation" ADD CONSTRAINT "WeaponTranslation_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerCharacter" ADD CONSTRAINT "BannerCharacter_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerCharacter" ADD CONSTRAINT "BannerCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerWeapon" ADD CONSTRAINT "BannerWeapon_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerWeapon" ADD CONSTRAINT "BannerWeapon_weaponId_fkey" FOREIGN KEY ("weaponId") REFERENCES "Weapon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerTranslation" ADD CONSTRAINT "BannerTranslation_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
