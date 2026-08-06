import { ArtifactObtainingTierData } from './artifactObtainingTier';
import { ArtifactPieceData } from './artifactPiece';

export interface ArtifactData {
  name: string;
  obtaining: ArtifactObtainingTierData[];
  flowerOfLife: ArtifactPieceData;
  plumeOfDeath: ArtifactPieceData;
  sandsOfEon: ArtifactPieceData;
  gobletOfEonothem: ArtifactPieceData;
  circletOfLogos: ArtifactPieceData;
  // "Npieces" -> texte du bonus (ex: "2pieces", "4pieces"), + "effects" -> tags
  // de catégorisation du set (cf. scrape-artifacts.ts / buildSetBonusesOutput).
  setBonuses: Record<string, string | string[]>;
  releaseVersion: string;
}
