import { pickTranslation } from "../../common";
import { MaterialSourceOut } from "../../model/out/material/materialSource";
import { MaterialWithRelations } from "../../model/withRelations/material";

export type SourceWithRelations = MaterialWithRelations['sources'][number];

export function mapSource(sourceWithRelations: SourceWithRelations, language: string): MaterialSourceOut {
  if (sourceWithRelations.type === 'ALCHEMY') {
    return {
      type: sourceWithRelations.type,
      minimumLevel: sourceWithRelations.minimumLevel,
      recipes: sourceWithRelations.recipes.map((recipe) => ({
        subtype: recipe.subtype,
        resultQuantity: recipe.resultQuantity,
        ingredients: recipe.ingredients.map((ingredient) => {
          const translation = pickTranslation(ingredient.translations, language);
          return {
            item: translation?.item ?? '',
            quantity: ingredient.quantity,
          };
        }),
      })),
    } satisfies MaterialSourceOut;
  }

  const translation = pickTranslation(sourceWithRelations.translations, language);
  
  return {
    type: sourceWithRelations.type,
    minimumLevel: sourceWithRelations.minimumLevel,
    names: translation?.names ?? [],
  } satisfies MaterialSourceOut;
}