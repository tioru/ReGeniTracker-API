import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { NormalAttackOut } from "../../model/out/character/normalAttack";
import { mapDescriptions, mapUnlockType, NormalAttackWithRelations } from "./character";

export function mapNormalAttack(normalAttackWithRelations: NormalAttackWithRelations, language: string) : NormalAttackOut {
    const pickedTranslation = pickTranslation(normalAttackWithRelations.translations, language);

    if (!pickedTranslation) {
      console.warn(`⚠️  Missing translation (${language}) for normal attack ${normalAttackWithRelations.translations[ENGLISH_INDEX].name}`);
    }

    return {
        unlock: mapUnlockType(normalAttackWithRelations.unlock),
        name: pickedTranslation?.name ?? '',
        descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
        upgrades: normalAttackWithRelations.upgrades.map((upgrade) => {
            const translation = pickTranslation(upgrade.translations, language);
            return {
                name: translation?.name ?? '',
                values: upgrade.values,
            };
        }),
    } satisfies NormalAttackOut;
}