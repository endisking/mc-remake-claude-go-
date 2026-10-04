import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PosSet } from './trees';
import { OverworldGenerator } from '../overworld/generator';
import { BlockWorld } from '../../world/world';
import { blockNameOf } from '../../world/blockstate';

describe('tree position order', () => {
  it('matches java.util.HashSet<BlockPos> iteration order', () => {
    // fixture: 300 random positions inserted into a real Java HashSet, then iterated (JDK 21)
    const [inp, out] = readFileSync(new URL('./fixtures/hashset-order.txt', import.meta.url), 'utf8').trim().split('\n');
    const set = new PosSet();
    for (const t of inp!.split(';').filter(Boolean)) {
      const [x, y, z] = t.split(',').map(Number);
      set.add(x!, y!, z!);
    }
    expect(set.javaOrder().map((p) => p.join(',')).join(';') + ';').toBe(out);
  });
});

describe('overworld decoration', () => {
  // 6×6 decorated chunks (plus a generated ring) around spawn of seed 20211
  const gen = new OverworldGenerator(20211n);
  const world = new BlockWorld();
  for (let cz = -4; cz <= 3; cz++) for (let cx = -4; cx <= 3; cx++) world.addChunk(gen.generate(cx, cz));
  for (let cz = -3; cz <= 2; cz++) for (let cx = -3; cx <= 2; cx++) gen.decorate(world, cx, cz);
  const counts = new Map<string, { n: number; maxY: number }>();
  for (let x = -48; x < 48; x++)
    for (let z = -48; z < 48; z++)
      for (let y = 0; y < 256; y++) {
        const name = blockNameOf(world.getState(x, y, z));
        const c = counts.get(name) ?? { n: 0, maxY: 0 };
        c.n++;
        c.maxY = Math.max(c.maxY, y);
        counts.set(name, c);
      }

  it('places ores within their 1.17.1 height ranges', () => {
    expect(counts.get('coal_ore')!.n).toBeGreaterThan(500);
    expect(counts.get('iron_ore')!.n).toBeGreaterThan(200);
    // a blob reaches at most a few blocks beyond its origin's range
    expect(counts.get('iron_ore')!.maxY).toBeLessThan(63 + 8);
    expect(counts.get('diamond_ore')!.maxY).toBeLessThan(16 + 8);
    expect(counts.get('deepslate')!.maxY).toBeLessThan(16 + 12);
    for (const s of ['granite', 'diorite', 'andesite', 'gravel', 'tuff', 'copper_ore', 'lapis_ore', 'redstone_ore', 'gold_ore']) expect(counts.get(s)?.n ?? 0).toBeGreaterThan(0);
  });

  it('grows trees and plants on the surface', () => {
    expect(counts.get('oak_log')?.n ?? 0).toBeGreaterThan(5);
    expect(counts.get('oak_leaves')?.n ?? 0).toBeGreaterThan(100);
    expect(counts.get('grass')?.n ?? 0).toBeGreaterThan(50);
  });
});
