import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { ElementalSkillOut } from "../../model/out/character/elementalSkill";
import { ElementalSkillWithRelations, mapDescriptions, mapUnlockType } from "./character";

export function mapElementalSkill(elementalSkillWithRelations: ElementalSkillWithRelations, language: string) : ElementalSkillOut {
    const pickedTranslation = pickTranslation(elementalSkillWithRelations.translations, language);

    if (!pickedTranslation) {
      console.warn(`⚠️  Missing translation (${language}) for elemental skill ${elementalSkillWithRelations.translations[ENGLISH_INDEX].name}`);
    }

    return {
        unlock: mapUnlockType(elementalSkillWithRelations.unlock),
        name: pickedTranslation?.name ?? '',
        note: pickedTranslation?.note ?? '',
        descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
        upgrades: elementalSkillWithRelations.upgrades.map((upgrade) => {
            const translation = pickTranslation(upgrade.translations, language);
            return {
                name: translation?.name ?? '',
                values: upgrade.values,
            };
        }),
    } satisfies ElementalSkillOut;
}