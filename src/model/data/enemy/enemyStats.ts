export interface EnemyLevelStatsData {
    hp: number;
    atk: number;
    def: number;
}

export interface EnemyResistanceData {
    physical: number;
    pyro: number;
    hydro: number;
    electro: number;
    cryo: number;
    dendro: number;
    anemo: number;
    geo: number;
}

export interface EnemyStatsData {
    levels: Record<string, EnemyLevelStatsData>;
    resistance: EnemyResistanceData;
}
