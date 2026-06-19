import { CharacterOut } from "../../model/out/character/character";
import { CharacterWithRelations } from "../../model/withRelations/character";

type LevelsWithRelations = CharacterWithRelations["levels"];

export function mapLevels(levels: LevelsWithRelations) : CharacterOut["levels"] {
  return Object.fromEntries(
    levels.map(level => 
      [ level.level, 
        {
          baseHp:        level.baseHp,
          baseDef:       level.baseDef,
          baseAtk:       level.baseAtk,
          energyRecharge: level.energyRecharge,
        }
      ]
    )
  );
}