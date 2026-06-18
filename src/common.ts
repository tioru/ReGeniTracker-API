interface Translatable {
  language: string;
}

export function pickTranslation<T extends Translatable>(translations: T[], language: string): T | null {
  return translations.find((translation) => translation.language === language) ?? null;
}