import { NormalizedEntryData } from './normalizedEntry';

export interface NormalizedBannerData {
    name: string;
    type: 'CHARACTER' | 'WEAPON' | 'NOVICE' | 'STANDARD' | 'CHRONICLED';
    releaseDate: Date;
    endDate: Date | null;
    mechanic: 'CHRONICLED' | 'LIGHTRACE' | null;
    characters: NormalizedEntryData[];
    weapons: NormalizedEntryData[];
}