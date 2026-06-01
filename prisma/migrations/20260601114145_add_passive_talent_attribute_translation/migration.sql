-- CreateTable
CREATE TABLE "PassiveTalentAttributeTranslation" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "attributeId" INTEGER NOT NULL,

    CONSTRAINT "PassiveTalentAttributeTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PassiveTalentAttributeTranslation_attributeId_language_key" ON "PassiveTalentAttributeTranslation"("attributeId", "language");

-- AddForeignKey
ALTER TABLE "PassiveTalentAttributeTranslation" ADD CONSTRAINT "PassiveTalentAttributeTranslation_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "PassiveTalentAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
