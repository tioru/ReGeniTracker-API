/*
  Warnings:

  - You are about to drop the column `specialDish` on the `Character` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Character" DROP COLUMN "specialDish";

-- AlterTable
ALTER TABLE "CharacterTranslation" ADD COLUMN     "specialDish" TEXT;
