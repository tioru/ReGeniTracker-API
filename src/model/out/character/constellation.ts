import { DescriptionOut } from "./description";

export interface ConstellationOut {
    level: number;
    name: string;
    descriptions: DescriptionOut[];
    hexereiBuffDescriptions: DescriptionOut[];
}