-- CreateTable
CREATE TABLE "CharacterTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "affiliation" TEXT,
    "constellation" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "CharacterTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterTranslation_characterId_lang_key" ON "CharacterTranslation"("characterId", "lang");

-- AddForeignKey
ALTER TABLE "CharacterTranslation" ADD CONSTRAINT "CharacterTranslation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
