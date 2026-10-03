import { describe, it, expect } from 'vitest';
import { BlockWorld } from './world';
import { Chunk } from './chunk';
import { LightEngine } from './light';
import { stateOf } from './blockstate';

const STONE = stateOf('stone');
const GLASS = stateOf('glass');
const LEAVES = stateOf('oak_leaves', { persistent: true });
const TORCH = stateOf('torch');
const SLAB_BOTTOM = stateOf('stone_slab', { type: 'bottom' });
const WATER = stateOf('water');

function flatWorld(radius: number, floorY = 10): { world: BlockWorld; light: LightEngine } {
  const world = new BlockWorld();
  for (let cx = -radius; cx <= radius; cx++)
    for (let cz = -radius; cz <= radius; cz++) {
      const c = new Chunk(cx, cz);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y <= floorY; y++) c.setState(x, y, z, STONE);
      world.addChunk(c);
    }
  const light = new LightEngine(world);
  for (const c of world.chunks.values()) light.lightChunk(c);
  return { world, light };
}

function setBlock(world: BlockWorld, light: LightEngine, x: number, y: number, z: number, s: number) {
  const old = world.setStateRaw(x, y, z, s);
  light.onBlockChanged(x, y, z, old, s);
}

describe('light engine', () => {
  it('fills open sky with 15 and solid ground with 0', () => {
    const { world } = flatWorld(1);
    expect(world.getSkyLight(3, 11, 3)).toBe(15);
    expect(world.getSkyLight(3, 200, 3)).toBe(15);
    expect(world.getSkyLight(3, 10, 3)).toBe(0);
    expect(world.getSkyLight(3, 5, 3)).toBe(0);
  });

  it('spreads torch light with a falloff of 1 per block', () => {
    const { world, light } = flatWorld(1);
    setBlock(world, light, 0, 11, 0, TORCH);
    expect(world.getBlockLight(0, 11, 0)).toBe(14);
    expect(world.getBlockLight(1, 11, 0)).toBe(13);
    expect(world.getBlockLight(5, 11, 0)).toBe(9);
    expect(world.getBlockLight(3, 11, 4)).toBe(7);
    expect(world.getBlockLight(-14, 11, 0)).toBe(0);
    setBlock(world, light, 0, 11, 0, 0);
    expect(world.getBlockLight(1, 11, 0)).toBe(0);
    expect(world.getBlockLight(5, 11, 0)).toBe(0);
  });

  it('casts shadows under roofs and lets light in from the side', () => {
    const { world, light } = flatWorld(1);
    // 5x5 roof at y=14 covering (−2..2)
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) setBlock(world, light, x, 14, z, STONE);
    expect(world.getSkyLight(0, 13, 0)).toBe(12); // 3 blocks from open edge at x=3 → 15-3
    expect(world.getSkyLight(2, 13, 0)).toBe(14);
    expect(world.getSkyLight(0, 15, 0)).toBe(15);
  });

  it('leaves and water reduce sky light by 1 per block; glass does not', () => {
    const { world, light } = flatWorld(0);
    setBlock(world, light, 4, 20, 4, GLASS);
    expect(world.getSkyLight(4, 19, 4)).toBe(15);
    setBlock(world, light, 6, 20, 6, LEAVES);
    expect(world.getSkyLight(6, 19, 6)).toBe(14);
    setBlock(world, light, 8, 11, 8, WATER);
    setBlock(world, light, 8, 12, 8, WATER);
    // water column inside a 1x1 pit: cells keep sideways sky from air above surface
    expect(world.getSkyLight(8, 12, 8)).toBe(14);
  });

  it('bottom slabs block light coming from below', () => {
    const { world, light } = flatWorld(0);
    // enclosed 1x1 cell at y=11 under a slab ceiling (walls of stone)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      setBlock(world, light, 8 + dx!, 11, 8 + dz!, STONE);
      setBlock(world, light, 8 + dx!, 12, 8 + dz!, STONE);
    }
    setBlock(world, light, 8, 12, 8, SLAB_BOTTOM);
    setBlock(world, light, 8, 11, 8, TORCH);
    expect(world.getBlockLight(8, 13, 8)).toBe(0);
    expect(world.getSkyLight(8, 11, 8)).toBe(0);
  });

  it('incremental updates match a full recompute', () => {
    const { world, light } = flatWorld(1);
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const palette = [0, STONE, GLASS, LEAVES, TORCH, SLAB_BOTTOM, 0, 0];
    for (let i = 0; i < 400; i++) {
      const x = rnd(40) - 20, y = 8 + rnd(10), z = rnd(40) - 20;
      setBlock(world, light, x, y, z, palette[rnd(palette.length)]!);
    }
    // snapshot, then relight everything from scratch
    const snap = new Map<string, number>();
    for (let x = -20; x < 20; x++) for (let z = -20; z < 20; z++) for (let y = 5; y < 22; y++) snap.set(`${x},${y},${z}`, world.getLight(x, y, z));
    const fresh = new LightEngine(world);
    for (const c of world.chunks.values()) c.lit = false;
    for (const c of world.chunks.values()) fresh.lightChunk(c);
    // second pass so chunks lit before their neighbors pull border light in
    for (const c of world.chunks.values()) fresh.lightChunk(c);
    let diffs = 0;
    for (const [k, v] of snap) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      if (world.getLight(x, y, z) !== v) diffs++;
    }
    expect(diffs).toBe(0);
  });
});
