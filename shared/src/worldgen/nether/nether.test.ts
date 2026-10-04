import { describe, it, expect } from 'vitest';
import { NetherGenerator } from './generator';
import { pickNetherBiome, climateFitness, NETHER_BIOME_POINTS } from './biomesource';
import { B } from '../biome/biomeids';
import { blockNameOf } from '../../world/blockstate';
import { BlockWorld } from '../../world/world';

describe('nether biome source', () => {
  it('picks the 1.17.1 preset parameter points', () => {
    expect(pickNetherBiome(0, 0, 0, 0)).toBe(B.nether_wastes);
    expect(pickNetherBiome(0, -0.5, 0, 0)).toBe(B.soul_sand_valley);
    expect(pickNetherBiome(0.4, 0, 0, 0)).toBe(B.crimson_forest);
    expect(pickNetherBiome(0, 0.6, 0, 0)).toBe(B.warped_forest);
    expect(pickNetherBiome(-0.6, 0, 0, 0)).toBe(B.basalt_deltas);
    // offsets penalise warped forest (0.375²) and basalt deltas (0.175²)
    const warped = NETHER_BIOME_POINTS[3]!;
    expect(climateFitness(0, 0.5, 0, 0, warped)).toBeCloseTo(0.140625, 6);
    // halfway between wastes and warped forest humidity: wastes wins because of the offset
    expect(pickNetherBiome(0, 0.25, 0, 0)).toBe(B.nether_wastes);
  });

  it('produces all five biomes over a large area', () => {
    const g = new NetherGenerator(12345n);
    const seen = new Set<number>();
    for (let qx = -400; qx <= 400; qx += 8) for (let qz = -400; qz <= 400; qz += 8) seen.add(g.quartBiome(qx, qz));
    expect([...seen].sort()).toEqual([B.nether_wastes, B.soul_sand_valley, B.crimson_forest, B.warped_forest, B.basalt_deltas].sort());
  });
});

describe('nether terrain', () => {
  it('is deterministic', () => {
    const a = new NetherGenerator(42n).generate(3, -7);
    const b = new NetherGenerator(42n).generate(3, -7);
    for (let s = 0; s < 16; s++) expect(a.sections[s]!.blocks).toEqual(b.sections[s]!.blocks);
    const c = new NetherGenerator(43n).generate(3, -7);
    expect(c.sections[3]!.blocks).not.toEqual(a.sections[3]!.blocks);
  });

  it('has a bedrock floor and roof, a lava sea and nothing above 127', () => {
    const g = new NetherGenerator(7n);
    let lava = 0, air = 0, rack = 0;
    for (let cx = -2; cx <= 2; cx++)
      for (let cz = -2; cz <= 2; cz++) {
        const c = g.generate(cx, cz);
        for (let x = 0; x < 16; x++)
          for (let z = 0; z < 16; z++) {
            expect(blockNameOf(c.getState(x, 0, z))).toBe('bedrock');
            expect(blockNameOf(c.getState(x, 127, z))).toBe('bedrock');
            for (let y = 128; y < 256; y++) expect(c.getState(x, y, z)).toBe(0);
            for (let y = 5; y < 123; y++) {
              const n = blockNameOf(c.getState(x, y, z));
              if (n === 'lava') {
                lava++;
              } else if (n === 'air' || n === 'cave_air') air++;
              else rack++;
              if (y >= 32 && n === 'lava') expect.fail(`lava above sea level at ${y}`);
            }
          }
      }
    expect(lava).toBeGreaterThan(1000);
    expect(air).toBeGreaterThan(10000);
    expect(rack).toBeGreaterThan(10000);
  });

  it('decorates without errors (features read neighbours through a world)', () => {
    const g = new NetherGenerator(99n);
    const w = new BlockWorld();
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.addChunk(g.generate(cx, cz));
    g.decorate(w, 0, 0);
    const names = new Set<string>();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 128; y++) names.add(blockNameOf(w.getState(x, y, z)));
    expect(names.has('netherrack') || names.has('blackstone') || names.has('basalt')).toBe(true);
  });
});
