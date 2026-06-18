import { NotFoundException } from "@nestjs/common";
import { CharacterMaterialType } from "@prisma/client";
import { pickTranslation } from "../../common";
import { MaterialOut } from "../../model/out/material/material";
import { MaterialWithRelations } from "../../model/withRelations/material";
import { mapSource, SourceWithRelations } from "./source";
import { mapSeller, SellerWithRelations } from "./seller";

type UsedInWithRelations = MaterialWithRelations['usedIn'][number];
type UsedByCharacterWithRelations = MaterialWithRelations['usedByCharacters'][number];

export function mapMaterial(materialWithRelations: MaterialWithRelations, language: string): MaterialOut {
  const pickedTranslation = pickTranslation(materialWithRelations.translations, language);

  if (!pickedTranslation) {
    throw new NotFoundException(`Language not found for "${materialWithRelations.name}"`);
  }

  return {
    name: materialWithRelations.name,
    rarity: materialWithRelations.rarity,
    categories: materialWithRelations.categories,
    description: pickedTranslation.description,
    sources: materialWithRelations.sources.map((source: SourceWithRelations) => mapSource(source, language)),
    usedIn: materialWithRelations.usedIn.map((use: UsedInWithRelations) => {
      const translation = pickTranslation(use.translations, language);
      return translation?.itemName ?? '';
    }),
    usedByCharacters: {
      ascension: materialWithRelations.usedByCharacters
        .filter((use: UsedByCharacterWithRelations) => use.type === CharacterMaterialType.ASCENSION)
        .map((use: UsedByCharacterWithRelations) => {
          const translation = pickTranslation(use.character.translations, language);
          return translation?.name ?? use.character.name;
        }),
      talent: materialWithRelations.usedByCharacters
        .filter((use: UsedByCharacterWithRelations) => use.type === CharacterMaterialType.TALENT)
        .map((use: UsedByCharacterWithRelations) => {
          const translation = pickTranslation(use.character.translations, language);
          return translation?.name ?? use.character.name;
        }),
    },
    sellers: materialWithRelations.sellers.map((seller: SellerWithRelations) => mapSeller(seller, language)),
  };
}