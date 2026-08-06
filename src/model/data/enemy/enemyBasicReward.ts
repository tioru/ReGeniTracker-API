export interface EnemyBasicRewardItemData {
    name: string;
    quantity: number;
}

export interface EnemyBasicRewardData {
    domainLevel?: number;
    worldLevel?: number;
    bossLevel: number;
    rewards: EnemyBasicRewardItemData[];
}
