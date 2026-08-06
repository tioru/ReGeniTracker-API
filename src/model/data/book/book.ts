import { BookVolumeData } from "./bookVolume";

export type BookCategory = "BOOK" | "BOOK_COLLECTION";

export interface BookData {
    name: string;
    category: BookCategory;
    rarity: number;
    region: string | null;
    author: string | null;
    publisher: string | null;
    illustrator: string | null;
    description: string | null;
    source: string | null;
    volumes: BookVolumeData[];
}
