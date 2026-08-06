export interface LocationData {
    name: string;
    type: string; // 'Nation' | 'Subregion' | 'Area' | 'Subarea' (EN, source de vérité) ou libellé traduit (FR)
    parent: string | null;
    description: string;
    image: string | null;
    imageLocalName: string | null;
    subLocations: string[];
}
