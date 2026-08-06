import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { BookHelperImpl } from "./helper/book/bookHelperImpl";
import { BookData } from "../../src/model/data/book/book";
import { BookHelper } from "./helper/book/bookHelper";
import { DEFAULT_LANG } from "../../constants";

const BOOKS_DIR = "../data/books";

export async function seedBooks(prisma: PrismaClient): Promise<void> {
  const bookHelper: BookHelper = new BookHelperImpl();

  const booksDir = path.resolve(__dirname, BOOKS_DIR);
  const bookNames: string[] = fs.readdirSync(path.resolve(booksDir, DEFAULT_LANG))
    .filter((file: string) => file.endsWith(".json"))
    .map((file: string) => path.basename(file, ".json"));

  for (const bookName of bookNames) {
    const enBookData: BookData = bookHelper.loadJson(path.resolve(booksDir, DEFAULT_LANG, `${bookName}.json`));
    const translations: { language: string; bookData: BookData }[] = [{ language: DEFAULT_LANG, bookData: enBookData }];
    const languages = fs.readdirSync(booksDir).filter((language: string) => language !== DEFAULT_LANG);

    for (const language of languages) {
      const fullPath = path.resolve(booksDir, language, `${bookName}.json`);
      if (fs.existsSync(fullPath)) {
        translations.push({ language: language, bookData: bookHelper.loadJson(fullPath) });
      }
    }

    console.log(`\n→ Seeding book: ${enBookData.name}`);

    await bookHelper.seedBook(prisma, translations);
  }

  console.log("\n✅ Books seeded.");
}
