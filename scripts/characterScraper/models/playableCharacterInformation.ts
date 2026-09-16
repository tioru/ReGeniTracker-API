import { ElementType } from "./elementType";
import { WeaponType } from "./weaponType";

export interface PlayableCharacterInformation {
    quality: number,
    weapon: WeaponType,
    element: ElementType,
    name: string
}