import { RegionType } from "../models/regionType";

export function mapRegionType(rawRegionType: string): RegionType {
    switch (rawRegionType.toLowerCase()) {
        case "mondstadt": return RegionType.MONDSTADT;
        case "liyue": return RegionType.LIYUE;
        case "inazuma": return RegionType.INAZUMA;
        case "sumeru": return RegionType.SUMERU;
        case "fontaine": return RegionType.FONTAINE;
        case "natlan": return RegionType.NATLAN;
        case "nod-krai": return RegionType["NOD-KRAI"];
        case "snezhnaya": return RegionType.SNEZHNAYA;
        default: throw new Error(`Unknown region type: ${rawRegionType}`);
    }
}
