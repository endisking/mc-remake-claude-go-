import { describe, it, expect } from 'vitest';
import { EndBiomeSource, endHeightValue } from './biomesource';
import { EndGenerator } from './generator';
import { B } from '../biome/biomeids';
import { BlockWorld } from '../../world/world';
import { blockNameOf, getProp } from '../../world/blockstate';
import { JavaRandom } from '../../util/random';
import { spikesForSeed, generateChorusPlant, createEndPlatform, placeEndPodium, type BlockAccess } from '../features/end';

const SEED = 12345n;

function mapAccess(): BlockAccess & { m: Map<string, number> } {
  const m = new Map<string, number>();
  return {
    m,
    getState: (x, y, z) => (y === 63 ? 0 : m.get(`${x},${y},${z}`) ?? 0),
    setState: (x, y, z, s) => m.set(`${x},${y},${z}`, s),
  };
}

describe('End biome source', () => {
  it('is the_end within 64 chunks of the origin', () => {
    const src = new EndBiomeSource(SEED);
    expect(src.getNoiseBiome(0, 0)).toBe(B.the_end);
    // chunk 64 (quart 256) on the axis: 64² = 4096 ≤ 4096
    expect(src.getNoiseBiome(256, 0)).toBe(B.the_end);
    expect(src.getNoiseBiome(260, 0)).not.toBe(B.the_end);
  });

  it('height value falls off from the main island', () => {
    const src = new EndBiomeSource(SEED);
    expect(endHeightValue(src.islandNoise, 0, 0)).toBe(80);
    // at cell 12 (96 blocks): 100 - 12·8 = 4
    expect(endHeightValue(src.islandNoise, 12, 0)).toBeCloseTo(4, 5);
    expect(endHeightValue(src.islandNoise, 40, 0)).toBe(-100);
  });

  it('outer biomes come in all four kinds far out', () => {
    const src = new EndBiomeSource(SEED);
    const seen = new Set<number>();
    for (let x = 0; x < 200; x++) for (let z = 0; z < 40; z++) seen.add(src.getNoiseBiome(1000 * 4 + x * 4, z * 4 * 4));
    expect(seen.has(B.end_highlands)).toBe(true);
    expect(seen.has(B.end_midlands)).toBe(true);
    expect(seen.has(B.end_barrens)).toBe(true);
    expect(seen.has(B.small_end_islands)).toBe(true);
    expect(seen.has(B.the_end)).toBe(false);
  });
});

describe('End terrain', () => {
  it('main island is end stone around y 50–70 at the origin, void far away', () => {
    const gen = new EndGenerator(SEED);
    const c = gen.generate(0, 0);
    let top = -1;
    for (let y = 127; y >= 0 && top < 0; y--) if (blockNameOf(c.getState(0, y, 0)) === 'end_stone') top = y;
    expect(top).toBeGreaterThan(45);
    expect(top).toBeLessThan(75);
    // nothing but end stone and air
    for (let y = 0; y < 128; y++) expect(['air', 'end_stone']).toContain(blockNameOf(c.getState(5, y, 5)));
    // 400 blocks out on the axis is inside the void ring
    const far = gen.generate(25, 0);
    for (let y = 0; y < 128; y++) expect(blockNameOf(far.getState(8, y, 8))).toBe('air');
  });
});

describe('End spikes', () => {
  it('ten spikes on a radius-42 circle with heights 76 + 3i and radii 2 + i/3', () => {
    const list = spikesForSeed(SEED);
    expect(list.map((s) => [s.centerX, s.centerZ])).toEqual([
      [42, 0], [33, 24], [12, 39], [-13, 39], [-34, 24], [-42, -1], [-34, -25], [-13, -40], [12, -40], [33, -25],
    ]);
    const heights = list.map((s) => s.height).sort((a, b) => a - b);
    expect(heights).toEqual([76, 79, 82, 85, 88, 91, 94, 97, 100, 103]);
    for (const s of list) {
      const i = (s.height - 76) / 3;
      expect(s.radius).toBe(2 + Math.trunc(i / 3));
      expect(s.guarded).toBe(i === 1 || i === 2);
    }
    // the shuffle depends on the seed only through nextLong() & 0xFFFF
    expect(spikesForSeed(SEED)).toBe(list);
    expect(spikesForSeed(1n).map((s) => s.height)).not.toEqual(list.map((s) => s.height));
  });

  it('decorating the main island builds the pillars with bedrock tops and caged ones', () => {
    const gen = new EndGenerator(SEED);
    const world = new BlockWorld();
    for (let cx = -4; cx <= 3; cx++) for (let cz = -4; cz <= 3; cz++) world.addChunk(gen.generate(cx, cz));
    for (let cx = -3; cx <= 2; cx++) for (let cz = -3; cz <= 2; cz++) gen.decorate(world, cx, cz);
    for (const s of spikesForSeed(SEED)) {
      expect(blockNameOf(world.getState(s.centerX, s.height, s.centerZ))).toBe('bedrock');
      expect(blockNameOf(world.getState(s.centerX, s.height - 1, s.centerZ))).toBe('obsidian');
      expect(blockNameOf(world.getState(s.centerX + s.radius, s.height - 5, s.centerZ))).toBe('obsidian');
      expect(blockNameOf(world.getState(s.centerX, s.height + 3, s.centerZ))).toBe(s.guarded ? 'iron_bars' : 'air');
    }
  });
});

describe('chorus plants', () => {
  it('generatePlant is deterministic and ends in age-5 flowers', () => {
    const grow = (seed: bigint) => {
      const a = mapAccess();
      a.setState(0, 63, 0, 0);
      const base: BlockAccess = {
        getState: (x, y, z) => (y < 64 ? (y === 63 ? 1 : 0) : a.m.get(`${x},${y},${z}`) ?? 0),
        setState: a.setState,
      };
      generateChorusPlant(base, 0, 64, 0, new JavaRandom(seed), 8);
      return a.m;
    };
    const one = grow(7n), two = grow(7n);
    expect([...one]).toEqual([...two]);
    const names = [...one.values()].map(blockNameOf);
    expect(names).toContain('chorus_plant');
    expect(names).toContain('chorus_flower');
    for (const [k, s] of one) {
      if (blockNameOf(s) === 'chorus_flower') expect(getProp(s, 'age')).toBe(5);
      const [x, , z] = k.split(',').map(Number) as [number, number, number];
      expect(Math.abs(x)).toBeLessThan(8);
      expect(Math.abs(z)).toBeLessThan(8);
    }
    expect([...grow(8n)]).not.toEqual([...one]);
  });
});

describe('arrival platform and exit podium', () => {
  it('createEndPlatform: 5×5 obsidian at y-1 with three air layers above', () => {
    const a = mapAccess();
    createEndPlatform(a, 100, 50, 0);
    expect(a.m.size).toBe(100);
    for (let x = 98; x <= 102; x++)
      for (let z = -2; z <= 2; z++) {
        expect(blockNameOf(a.m.get(`${x},49,${z}`)!)).toBe('obsidian');
        for (let y = 50; y <= 52; y++) expect(a.m.get(`${x},${y},${z}`)).toBe(0);
      }
  });

  it('active podium has 20 portal blocks around a 4-high bedrock pillar with torches', () => {
    const a = mapAccess();
    placeEndPodium(a, 0, 64, 0, true);
    const portals = [...a.m].filter(([, s]) => blockNameOf(s) === 'end_portal');
    expect(portals.length).toBe(20);
    for (let y = 64; y < 68; y++) expect(blockNameOf(a.m.get(`0,${y},0`)!)).toBe('bedrock');
    expect(blockNameOf(a.m.get('1,66,0')!)).toBe('wall_torch');
    const inactive = mapAccess();
    placeEndPodium(inactive, 0, 64, 0, false);
    expect([...inactive.m.values()].filter((s) => blockNameOf(s) === 'end_portal').length).toBe(0);
  });
});
