import { NormalizedEntryData } from './normalizedEntry';

export interface NormalizedBannerData {
    name: string;
    type: 'CHARACTER' | 'WEAPON';
    releaseDate: Date;
    endDate: Date;
    characters: NormalizedEntryData[];
    weapons: NormalizedEntryData[];
}