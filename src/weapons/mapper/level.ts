import { WeaponOut } from "../../model/out/weapon/weapon";
import { WeaponWithRelations } from "../../model/withRelations/weapon";

type LevelsWithRelations = WeaponWithRelations['levels'];

export function mapLevels(levels: LevelsWithRelations): WeaponOut['levels'] {
    return Object.fromEntries(
        levels.map((level) => [
            level.level,
            {
                baseAtk: level.baseAtk,
            },
        ]),
    );
}