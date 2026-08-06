import { EnemyDropPoolData } from "./enemyDropPool";
import { EnemyLocationData } from "./enemyLocation";
import { EnemyPhaseData } from "./enemyPhase";
import { EnemyStatsData } from "./enemyStats";
import { EnemyBasicRewardData } from "./enemyBasicReward";

export type EnemyEncounterType = "Common Enemy" | "Elite Enemy" | "Normal Boss" | "Weekly Boss";

export interface CommonOrEliteEnemyData {
    name: string;
    enemyType: "Common Enemy" | "Elite Enemy";
    family: string;
    group: string;
    hasWeakPoint: boolean;
    abilities: string[];
    stats: EnemyStatsData;
    drops: EnemyDropPoolData;
    releaseVersion: string;
}

export interface BossEnemyData {
    name: string;
    enemyType: "Normal Boss" | "Weekly Boss";
    title: string;
    family: string;
    group: string;
    location: EnemyLocationData;
    phases: EnemyPhaseData[];
    bossRewards: {
        poolRewards: EnemyDropPoolData;
        basicRewards: EnemyBasicRewardData[];
    };
    releaseVersion: string;
}

export type EnemyData = CommonOrEliteEnemyData | BossEnemyData;

export function isBossEnemyData(enemyData: EnemyData): enemyData is BossEnemyData {
    return enemyData.enemyType === "Normal Boss" || enemyData.enemyType === "Weekly Boss";
}
