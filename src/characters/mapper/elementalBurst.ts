import { ENGLISH_INDEX } from "../../../constants";
import { pickTranslation } from "../../common";
import { ElementalBurstOut } from "../../model/out/character/elementalBurst";
import { ElementalBurstWithRelations, mapDescriptions, mapUnlockType } from "./character";

export function mapElementalBurst(elementalBurstWithRelations: ElementalBurstWithRelations, language: string) : ElementalBurstOut {
  const pickedTranslation = pickTranslation(elementalBurstWithRelations.translations, language);

  if (!pickedTranslation) {
    console.warn(`⚠️  Missing translation (${language}) for elemental burst ${elementalBurstWithRelations.translations[ENGLISH_INDEX].name}`);
  }

  return {
    unlock: mapUnlockType(elementalBurstWithRelations.unlock),
    name: pickedTranslation?.name ?? '',
    note: pickedTranslation?.note ?? '',
    descriptions: mapDescriptions(pickedTranslation?.descriptions ?? []),
    upgrades: elementalBurstWithRelations.upgrades.map((upgrade) => {
      const translation = pickTranslation(upgrade.translations, language);
      return {
        name: translation?.name ?? '',
        values: upgrade.values,
      };
    }),
  } satisfies ElementalBurstOut;
}