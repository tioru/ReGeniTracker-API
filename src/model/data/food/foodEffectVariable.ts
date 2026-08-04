export interface FoodQualityValuesData {
    suspicious: number | null;
    normal: number | null;
    delicious: number | null;
}

export interface FoodEffectVariableData {
    label: string;
    values: FoodQualityValuesData;
}
