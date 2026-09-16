import { ElementType } from "../models/elementType";

export function mapElementType(rawElementType: string): ElementType {
    switch (rawElementType.toLowerCase()) {
        case "pyro": return ElementType.PYRO;
        case "electro": return ElementType.ELECTRO;
        case "dendro": return ElementType.DENDRO;
        case "cryo": return ElementType.CRYO;
        case "geo": return ElementType.GEO;
        case "anemo": return ElementType.ANEMO;
        case "hydro": return ElementType.HYDRO;
        default: throw new Error(`Unknown element type: ${rawElementType}`);
    }
}
