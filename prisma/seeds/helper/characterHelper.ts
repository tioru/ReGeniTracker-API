import { CharacterData } from "../model/character/character";

export interface CharacterHelper {
    loadJson(filePath: string): CharacterData;

    
}