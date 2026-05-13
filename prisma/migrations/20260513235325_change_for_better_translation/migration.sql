-- Nouveaux modèles de traduction
CREATE TABLE "MaterialSourceTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "names" TEXT[],
    "sourceId" INTEGER NOT NULL,
    CONSTRAINT "MaterialSourceTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeIngredientTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    CONSTRAINT "RecipeIngredientTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialSellerTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "sellerId" INTEGER NOT NULL,
    CONSTRAINT "MaterialSellerTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialUseTranslation" (
    "id" SERIAL NOT NULL,
    "lang" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "useId" INTEGER NOT NULL,
    CONSTRAINT "MaterialUseTranslation_pkey" PRIMARY KEY ("id")
);

-- Suppression des colonnes non traduites
ALTER TABLE "MaterialSource" DROP COLUMN IF EXISTS "names";
ALTER TABLE "RecipeIngredient" DROP COLUMN IF EXISTS "item";
ALTER TABLE "MaterialSeller" DROP COLUMN IF EXISTS "name";
ALTER TABLE "MaterialSeller" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "MaterialUse" DROP COLUMN IF EXISTS "itemName";

-- Migration CharacterMaterialUse : characterName -> characterId (FK)
ALTER TABLE "CharacterMaterialUse" ADD COLUMN "characterId" INTEGER;

UPDATE "CharacterMaterialUse" cmu
SET "characterId" = c.id
FROM "Character" c
WHERE c.name = cmu."characterName";

DELETE FROM "CharacterMaterialUse" WHERE "characterId" IS NULL;

ALTER TABLE "CharacterMaterialUse" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "CharacterMaterialUse" DROP COLUMN "characterName";

-- Contraintes FK
ALTER TABLE "MaterialSourceTranslation" ADD CONSTRAINT "MaterialSourceTranslation_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "MaterialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecipeIngredientTranslation" ADD CONSTRAINT "RecipeIngredientTranslation_ingredientId_fkey"
    FOREIGN KEY ("ingredientId") REFERENCES "RecipeIngredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialSellerTranslation" ADD CONSTRAINT "MaterialSellerTranslation_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "MaterialSeller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialUseTranslation" ADD CONSTRAINT "MaterialUseTranslation_useId_fkey"
    FOREIGN KEY ("useId") REFERENCES "MaterialUse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CharacterMaterialUse" ADD CONSTRAINT "CharacterMaterialUse_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique constraints
CREATE UNIQUE INDEX "MaterialSourceTranslation_sourceId_lang_key" ON "MaterialSourceTranslation"("sourceId", "lang");
CREATE UNIQUE INDEX "RecipeIngredientTranslation_ingredientId_lang_key" ON "RecipeIngredientTranslation"("ingredientId", "lang");
CREATE UNIQUE INDEX "MaterialSellerTranslation_sellerId_lang_key" ON "MaterialSellerTranslation"("sellerId", "lang");
CREATE UNIQUE INDEX "MaterialUseTranslation_useId_lang_key" ON "MaterialUseTranslation"("useId", "lang");