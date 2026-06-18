import { NotFoundException } from "@nestjs/common";
import { WeaponOut } from "../../model/out/weapon/weapon";
import { mapLevels } from "./level";
import { mapSellers } from "./seller";
import { mapAscensionMaterials } from "./ascensionMaterial";
import { pickTranslation } from "../../common";
import { WeaponWithRelations } from "../../model/withRelations/weapon";

export function mapWeapon(weaponWithRelations: WeaponWithRelations, language: string): WeaponOut {
    const pickedTranslation = pickTranslation(weaponWithRelations.translations, language);

    if (!pickedTranslation) {
        throw new NotFoundException(`Language not found for "${weaponWithRelations.name}"`);
    }

    return {
        name: weaponWithRelations.name,
        type: weaponWithRelations.type,
        rarity: weaponWithRelations.rarity,
        releaseDate: weaponWithRelations.releaseDate,
        description: pickedTranslation.description,
        history: pickedTranslation.history,
        levels: mapLevels(weaponWithRelations.levels),
        ascensionMaterials: mapAscensionMaterials(weaponWithRelations.ascensionMaterials, language),
        sellers: mapSellers(weaponWithRelations.sellers, language),
    };
}