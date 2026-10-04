import { describe, it, expect } from 'vitest';
import { OverworldLayers } from './layers';
import { step, joinBig, splitBig, H, L } from './lcg';
import cases from './fixtures/quart-biomes.json';

describe('biome layers (1.17)', () => {
  it('64-bit LCG step matches BigInt arithmetic', () => {
    const M = 6364136223846793005n, A = 1442695040888963407n;
    for (const [s, t] of [[123456789123456789n, 5n], [-1n, -7n], [0x7fffffffffffffffn, 1000n], [-987654321987654321n, 299999n]] as const) {
      const [sh, sl] = splitBig(s), [th, tl] = splitBig(t);
      step(sh, sl, th, tl);
      expect(joinBig(H, L)).toBe(BigInt.asIntN(64, s * (s * M + A) + t));
    }
  });

  for (const c of cases) {
    it(`seed ${c.seed}${c.large ? ' (large biomes)' : ''} at quart ${c.x},${c.z} matches cubiomes`, () => {
      const layers = new OverworldLayers(BigInt(c.seed), c.large);
      const got: number[] = [];
      for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) got.push(layers.quart.get(c.x + i, c.z + j));
      const bad = got.findIndex((v, i) => v !== c.ids[i]);
      expect(bad, bad >= 0 ? `first mismatch at ${bad % c.w},${Math.floor(bad / c.w)}: ${got[bad]} vs ${c.ids[bad]}` : '').toBe(-1);
    });
  }
});

import { obfuscateSeed, zoomToQuart, sha256 } from './zoom';
// reference: cubiomes voronoiAccess3D(x, 0, z) + cubiomes quart biomes (its bulk scale-1 path differs from vanilla)
import blockCases from './fixtures/block-biomes.json';

describe('biome zoom (1.15–1.17 voronoi)', () => {
  it('SHA-256 matches the standard test vector', () => {
    const hex = [...sha256(new TextEncoder().encode('abc'))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  for (const c of blockCases) {
    it(`seed ${c.seed}: block biomes at ${c.x},${c.z} match cubiomes`, () => {
      const layers = new OverworldLayers(BigInt(c.seed));
      const sha = obfuscateSeed(BigInt(c.seed));
      const q: [number, number] = [0, 0];
      const got: number[] = [];
      for (let j = 0; j < c.h; j++)
        for (let i = 0; i < c.w; i++) {
          zoomToQuart(sha, c.x + i, c.z + j, q);
          got.push(layers.quart.get(q[0], q[1]));
        }
      const bad = got.findIndex((v, i) => v !== c.ids[i]);
      expect(bad, bad >= 0 ? `first mismatch at ${bad % c.w},${Math.floor(bad / c.w)}: ${got[bad]} vs ${c.ids[bad]}` : '').toBe(-1);
    });
  }
});
