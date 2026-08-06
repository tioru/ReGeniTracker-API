import { PrismaClient } from "@prisma/client";
import { BookData } from "../../../../src/model/data/book/book";

export interface BookHelper {
  loadJson(filePath: string): BookData;
  upsertBook(prisma: PrismaClient, enData: BookData): Promise<{ id: number }>;
  upsertBookTranslations(prisma: PrismaClient, bookId: number, translations: { language: string; bookData: BookData }[]): Promise<void>;
  volumesRecreate(prisma: PrismaClient, bookId: number, translations: { language: string; bookData: BookData }[]): Promise<void>;
  seedBook(prisma: PrismaClient, translations: { language: string; bookData: BookData }[]): Promise<void>;
}
