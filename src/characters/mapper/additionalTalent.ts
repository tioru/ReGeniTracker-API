import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { AdditionalTalentOut } from "../../model/out/character/additionalTalent";
import { AdditionalTalentWithRelations, mapDescriptions, mapUnlockType } from "./character";

export function mapAdditionalTalent(additionalTalentWithRelations: AdditionalTalentWithRelations, language: string) : AdditionalTalentOut {
    const pickedTranslation = pickTranslation(additionalTalentWithRelations.translations, language);
  
    if (!pickedTranslation) {
        console.warn(`⚠️  Missing translation (${language}) for additional talent ${additionalTalentWithRelations.translations[ENGLISH_INDEX].name}`);
    }

    return {
        unlock: mapUnlockType(additionalTalentWithRelations.unlock),
        name: pickedTranslation?.name ?? '',
        descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    } satisfies AdditionalTalentOut;
}