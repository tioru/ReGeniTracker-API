import { EnemyStatsData } from "./enemyStats";

export interface EnemyPhaseData {
    phase: number;
    name: string;
    damageTypes: string[];
    hasWeakPoint: boolean;
    abilities: string[];
    stats: EnemyStatsData;
}
