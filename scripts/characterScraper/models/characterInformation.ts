import { elementType } from "./elementType";
import { weaponType } from "./weaponType";

export interface characterInformation {
    quality: number,
    weapon: weaponType,
    element: elementType,
    name: string
}