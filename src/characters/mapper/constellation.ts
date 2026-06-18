import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { ConstellationOut } from "../../model/out/character/constellation";
import { ConstellationWithRelations, mapDescriptions } from "./character";

export function mapConstellation(constellationWithRelations: ConstellationWithRelations, language: string) : ConstellationOut {
    const pickedTranslation = pickTranslation(constellationWithRelations.translations, language);

    if (!pickedTranslation) {
        console.warn(`⚠️  Missing translation (${language}) for constellation ${constellationWithRelations.translations[ENGLISH_INDEX].name}`);
    }

    return {
        level: constellationWithRelations.level,
        name: pickedTranslation?.name ?? '',
        descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
        hexereiBuffDescriptions: mapDescriptions(pickedTranslation?.hexereiBuffDescriptions ?? []),
    } satisfies ConstellationOut;
}