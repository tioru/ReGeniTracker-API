import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { PassiveTalentOut } from "../../model/out/character/passiveTalent";
import { mapDescriptions, mapUnlockType, PassiveTalentWithRelations } from "./character";

export function mapPassiveTalent(passiveTalentWithRelations: PassiveTalentWithRelations, language: string) : PassiveTalentOut {
    const pickedTranslation = pickTranslation(passiveTalentWithRelations.translations, language);

    if (!pickedTranslation) {
      console.warn(`⚠️  Missing translation (${language}) for passive talent ${passiveTalentWithRelations.translations[ENGLISH_INDEX].name}`);
    }

    return {
        unlock: mapUnlockType(passiveTalentWithRelations.unlock),
        name: pickedTranslation?.name ?? '',
        descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
        attributes: passiveTalentWithRelations.attributes.map((attribute) => {
            const translation = pickTranslation(attribute.translations, language);
            return {
                name: translation?.name ?? '',
                value: translation?.value ?? '',
            };
        }),
    } satisfies PassiveTalentOut;
}