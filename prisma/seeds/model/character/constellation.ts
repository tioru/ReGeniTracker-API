export interface ConstellationData {
    level: number;
    name: string;
    descriptions: {
        title: string | null;
        description: string;
    }[];
    hexereiBuffDescriptions: {
        title: string | null;
        description: string;
    }[];
}