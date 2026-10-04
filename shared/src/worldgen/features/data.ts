/** The generated 1.17.1 worldgen data (see tools/datagen/worldgen.ts). */
import worldgenJson from '../../data/generated/worldgen.json';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface BiomeWorldgen {
  category: string;
  features: (string | J)[][];
  carvers: { air?: string[]; liquid?: string[] };
  starts?: string[];
  spawners?: Record<string, { type: string; weight: number; minCount: number; maxCount: number }[]>;
}

export const WORLDGEN = worldgenJson as unknown as {
  biomes: Record<string, BiomeWorldgen>;
  configured_features: Record<string, J>;
  configured_carvers: Record<string, J>;
  configured_structure_features: Record<string, J>;
  block_tags: Record<string, string[]>;
};
