import { describe, it, expect } from 'vitest';
import { TerrainNoise } from './terrain';
import { OverworldLayers } from '../biome/layers';
import { JavaRandom } from '../../util/random';
import ref from './heights-1.16.5.json';

describe('overworld terrain (1.16.5/1.17)', () => {
  it('ground heights at 256 random points match SeedFinding mc_terrain_java test vectors', () => {
    const seed = BigInt(ref.seed);
    const t = new TerrainNoise(seed, new OverworldLayers(seed).quart);
    const r = new JavaRandom(BigInt(ref.randomSeed));
    const buf = new Float64Array(65536);
    const bad: string[] = [];
    for (let i = 0; i < 256; i++) {
      const x = r.nextInt(512000) - 25600, z = r.nextInt(512000) - 25600;
      t.fillChunk(x >> 4, z >> 4, buf);
      let h = 0;
      for (let y = 255; y >= 0; y--) if (buf[(y << 8) | ((z & 15) << 4) | (x & 15)]! > 0) { h = y + 1; break; }
      if (h !== ref.heights[i]) bad.push(`${x},${z}: ${h} vs ${ref.heights[i]}`);
    }
    expect(bad.slice(0, 5), `${bad.length} wrong`).toEqual([]);
  }, 60000);
});
