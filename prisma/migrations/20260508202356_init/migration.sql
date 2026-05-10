-- CreateTable
CREATE TABLE "Character" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "rarity" INTEGER NOT NULL,
    "vision" TEXT NOT NULL,
    "weapon" TEXT NOT NULL,
    "nation" TEXT NOT NULL,
    "affiliation" TEXT,
    "birthday" TIMESTAMP(3),
    "releaseDate" TIMESTAMP(3),
    "constellation" TEXT,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AscensionMaterial" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "AscensionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillTalent" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "unlock" TEXT,
    "upgrades" JSONB,
    "attributeScaling" JSONB,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "SkillTalent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassiveTalent" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unlock" TEXT,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "PassiveTalent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Constellation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL,
    "characterId" INTEGER NOT NULL,

    CONSTRAINT "Constellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Character_name_key" ON "Character"("name");

-- AddForeignKey
ALTER TABLE "AscensionMaterial" ADD CONSTRAINT "AscensionMaterial_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTalent" ADD CONSTRAINT "SkillTalent_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassiveTalent" ADD CONSTRAINT "PassiveTalent_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Constellation" ADD CONSTRAINT "Constellation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
