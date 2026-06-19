import { pickTranslation } from "../../common";
import { AscensionMaterialOut } from "../../model/out/character/ascensionMaterial";
import { CharacterWithRelations } from "../../model/withRelations/character";

type AscensionMaterialWithRelations = CharacterWithRelations['ascensionMaterials'][number];
type AscensionMaterialWithRelationsItem = AscensionMaterialWithRelations['items'][number];

export function mapAscensionMaterials(ascensionMaterialsWithRelations: AscensionMaterialWithRelations[], language: string) : AscensionMaterialOut[] {
    return ascensionMaterialsWithRelations.map((ascensionMaterialWithRelations : AscensionMaterialWithRelations) => ({
        level:     ascensionMaterialWithRelations.level,
        materials: ascensionMaterialWithRelations.items.map((item: AscensionMaterialWithRelationsItem) => {
            const translation = pickTranslation(item.material.translations, language);
            return {
                name: translation?.name ?? item.material.name,
                quantity: item.quantity,
            };
        }),
    }));
}