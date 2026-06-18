import { pickTranslation } from "../../common";
import { WeaponSellerOut } from "../../model/out/weapon/seller";
import { WeaponWithRelations } from "../../model/withRelations/weapon";

type SellerWithRelations = WeaponWithRelations['sellers'][number];

export function mapSellers(sellersWithRelations: SellerWithRelations[], language: string): WeaponSellerOut[] {
    return sellersWithRelations.map((sellerWithRelations: SellerWithRelations) => {
        const translation = pickTranslation(sellerWithRelations.translations, language);
        return {
            name: translation?.name ?? '',
            currency: translation?.currency ?? '',
            cost: sellerWithRelations.cost,
            stock: sellerWithRelations.stock,
            restock: sellerWithRelations.restock,
        };
    });
}