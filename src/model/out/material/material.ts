import { MaterialSourceOut } from "./materialSource";
import { MaterialSellerOut } from "./seller";

export type MaterialOut = {
  name: string;
  rarity: number | null;
  categories: string[];
  description: string | null;
  sources: MaterialSourceOut[];
  usedIn: string[];
  usedByCharacters: {
    ascension: string[];
    talent: string[];
  };
  sellers: MaterialSellerOut[];
};