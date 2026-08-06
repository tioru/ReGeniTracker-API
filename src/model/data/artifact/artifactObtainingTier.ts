// Chaque entrée de "sources" est un objet à clé unique { <ArtifactSourceTypes>: <nom affiché> },
// tel que produit par scrape-artifacts.ts (buildObtainingOutput).
export type ArtifactObtainingSourceData = Record<string, string>;

export interface ArtifactObtainingTierData {
  rarity: number;
  sources: ArtifactObtainingSourceData[];
}
