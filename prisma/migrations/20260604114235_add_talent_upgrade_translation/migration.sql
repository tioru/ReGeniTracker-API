/*
  Warnings:

  - You are about to drop the column `name` on the `PassiveTalentAttribute` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `PassiveTalentAttribute` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `TalentUpgrade` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PassiveTalentAttribute" DROP COLUMN "name",
DROP COLUMN "value";

-- AlterTable
ALTER TABLE "TalentUpgrade" DROP COLUMN "name";

-- CreateTable
CREATE TABLE "TalentUpgradeTranslation" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "upgradeId" INTEGER NOT NULL,

    CONSTRAINT "TalentUpgradeTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TalentUpgradeTranslation_upgradeId_language_key" ON "TalentUpgradeTranslation"("upgradeId", "language");

-- AddForeignKey
ALTER TABLE "TalentUpgradeTranslation" ADD CONSTRAINT "TalentUpgradeTranslation_upgradeId_fkey" FOREIGN KEY ("upgradeId") REFERENCES "TalentUpgrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
