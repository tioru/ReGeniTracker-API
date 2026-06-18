import { pickTranslation } from "../../common";
import { MaterialSellerOut } from "../../model/out/material/seller";
import { MaterialWithRelations } from "../../model/withRelations/material";

export type SellerWithRelations = MaterialWithRelations['sellers'][number];

export function mapSeller(sellerWithRelations: SellerWithRelations, language: string): MaterialSellerOut {
  const translation = pickTranslation(sellerWithRelations.translations, language);
  
  return {
    name: translation?.name ?? '',
    currency: translation?.currency ?? '',
    cost: sellerWithRelations.cost,
    stock: sellerWithRelations.stock,
    restock: sellerWithRelations.restock,
  } satisfies MaterialSellerOut;
}