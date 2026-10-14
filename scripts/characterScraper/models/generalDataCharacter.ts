import { Family } from "./family";
import { PlayableCharacterInformation } from "./playableCharacterInformation";
import { Titles } from "./titles";
import { Unrevealed } from "./unrevealed";
import { VoiceActors } from "./voiceActors";
import { VoiceLine } from "./voiceLine";

export interface GeneralDataCharacter {
    playableCharacterInformation: PlayableCharacterInformation,
    unrevealed: Unrevealed,
    titles: Titles,
    voiceActors: VoiceActors,
    family: Family,
    voiceLines: VoiceLine[]
}