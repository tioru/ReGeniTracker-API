import { pickTranslation } from "../../common";
import { WeaponAscensionMaterialOut } from "../../model/out/weapon/ascensionMaterial";
import { WeaponWithRelations } from "../weapons.service";

type AscensionMaterialWithRelations = WeaponWithRelations['ascensionMaterials'][number];
type AscensionMaterialWithRelationsItem = AscensionMaterialWithRelations['items'][number];

export function mapAscensionMaterials(ascensionMaterialsWithRelations: AscensionMaterialWithRelations[], language: string): WeaponAscensionMaterialOut[] {
    return ascensionMaterialsWithRelations.map((ascensionMaterialWithRelations: AscensionMaterialWithRelations) => ({
        level: ascensionMaterialWithRelations.level,
        materials: ascensionMaterialWithRelations.items.map((item: AscensionMaterialWithRelationsItem) => {
            const translation = pickTranslation(item.material.translations, language);
            return {
                name: translation?.name ?? item.material.name,
                quantity: item.quantity,
            };
        }),
    }));
}