import { CreatureDropData } from "./creatureDrop";

export interface CreatureData {
    name: string;
    family: string;
    group: string;
    location: string;
    description: string;
    image: string | null;
    drops: CreatureDropData[];
    releaseVersion: string;
    bait?: string;
}
