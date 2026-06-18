import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { AscensionTalentOut } from "../../model/out/character/ascensionTalent";
import { AscensionTalentWithRelations, mapDescriptions, mapUnlockType } from "./character";

export function mapAscensionTalent(ascensionTalentWithRelations: AscensionTalentWithRelations, language: string) : AscensionTalentOut {
    const pickedTranslation = pickTranslation(ascensionTalentWithRelations.translations, language);
    
    if (!pickedTranslation) {
        console.warn(`⚠️  Missing translation (${language}) for ascension talent ${ascensionTalentWithRelations.translations[ENGLISH_INDEX].name}`);
    }

    return {
        unlock: mapUnlockType(ascensionTalentWithRelations.unlock),
        name: pickedTranslation?.name ?? '',
        descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    } satisfies AscensionTalentOut;
}