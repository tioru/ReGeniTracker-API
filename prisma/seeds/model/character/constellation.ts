import { DescriptionData } from "./description";

export interface ConstellationData {
    level: number;
    name: string;
    descriptions: DescriptionData[];
    hexereiBuffDescriptions: {
        title: string | null;
        description: string;
    }[];
}