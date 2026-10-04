import { describe, it, expect } from 'vitest';
import { BlockWorld } from '../world/world';
import { Chunk } from '../world/chunk';
import { stateOf, blockNameOf, getProp } from '../world/blockstate';
import {
  tickFluid, onBlockChanged, getFlow, getSpread, fluidTickType, KIND_WATER, type FluidLevel,
} from './fluids';

const STONE = stateOf('stone');
const water = (level = 0) => stateOf('water', { level });
const lava = (level = 0) => stateOf('lava', { level });

/** A tiny server: a block world, a liquid tick list and a game clock. */
class Harness implements FluidLevel {
  readonly world = new BlockWorld();
  time = 0;
  ultraWarm = false;
  private buckets = new Map<number, [number, number, number, number][]>();
  private scheduled = new Set<string>();
  drops: [number, number, number, number][] = [];
  fizzes = 0;

  constructor(r = 2) {
    for (let cx = -r; cx < r; cx++) for (let cz = -r; cz < r; cz++) this.world.addChunk(new Chunk(cx, cz));
  }
  getState(x: number, y: number, z: number): number {
    return this.world.getState(x, y, z);
  }
  setBlock(x: number, y: number, z: number, state: number): void {
    const old = this.world.setStateRaw(x, y, z, state);
    if (old !== state) onBlockChanged(this, x, y, z, old, state);
  }
  scheduleTick(x: number, y: number, z: number, type: number, delay: number): void {
    const key = `${x},${y},${z},${type}`;
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const at = this.time + delay;
    if (!this.buckets.has(at)) this.buckets.set(at, []);
    this.buckets.get(at)!.push([x, y, z, type]);
  }
  dropResources(x: number, y: number, z: number, state: number): void {
    this.drops.push([x, y, z, state]);
  }
  fizz(): void {
    this.fizzes++;
  }
  nextInt(bound: number): number {
    return bound - 1; // never the "slow lava" branch (nextInt(4) != 0)
  }
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.time++;
      const due = this.buckets.get(this.time);
      if (!due) continue;
      this.buckets.delete(this.time);
      for (const [x, y, z, t] of due) this.scheduled.delete(`${x},${y},${z},${t}`);
      for (const [x, y, z, t] of due) tickFluid(this, x, y, z, t);
    }
  }
  floor(y: number, r = 20): void {
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) this.world.setStateRaw(x, y, z, STONE);
  }
  name(x: number, y: number, z: number): string {
    return blockNameOf(this.getState(x, y, z));
  }
  level(x: number, y: number, z: number): number | undefined {
    return getProp(this.getState(x, y, z), 'level') as number | undefined;
  }
}

describe('fluid spreading', () => {
  it('a water source on flat ground spreads a diamond of radius 7 with levels = distance', () => {
    const h = new Harness();
    h.floor(63);
    h.setBlock(0, 64, 0, water());
    h.run(400);
    for (let x = -9; x <= 9; x++)
      for (let z = -9; z <= 9; z++) {
        const d = Math.abs(x) + Math.abs(z);
        if (d <= 7) {
          expect(h.name(x, 64, z), `${x},${z}`).toBe('water');
          expect(h.level(x, 64, z), `${x},${z}`).toBe(d);
        } else expect(h.name(x, 64, z), `${x},${z}`).toBe('air');
      }
  });

  it('lava on flat ground spreads a diamond of radius 3 (drop-off 2)', () => {
    const h = new Harness();
    h.floor(63);
    h.setBlock(0, 64, 0, lava());
    h.run(2000);
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const d = Math.abs(x) + Math.abs(z);
        if (d <= 3) {
          expect(h.name(x, 64, z), `${x},${z}`).toBe('lava');
          expect(h.level(x, 64, z), `${x},${z}`).toBe(2 * d);
        } else expect(h.name(x, 64, z)).toBe('air');
      }
  });

  it('in the Nether lava spreads like water (drop-off 1, delay 10)', () => {
    const h = new Harness();
    h.ultraWarm = true;
    h.floor(63);
    h.setBlock(0, 64, 0, lava());
    h.run(10);
    expect(h.name(1, 64, 0)).toBe('lava');
    h.run(1000);
    expect(h.level(7, 64, 0)).toBe(7);
    expect(h.name(8, 64, 0)).toBe('air');
  });

  it('removing the source drains the flow', () => {
    const h = new Harness();
    h.floor(63);
    h.setBlock(0, 64, 0, water());
    h.run(400);
    h.setBlock(0, 64, 0, 0);
    h.run(400);
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) expect(h.name(x, 64, z)).toBe('air');
  });

  it('water falls (level 8) and spreads again at the bottom', () => {
    const h = new Harness();
    h.floor(60);
    h.world.setStateRaw(0, 63, 0, STONE);
    h.setBlock(0, 64, 0, water());
    h.run(600);
    // over the edge of the pillar: falling columns next to it
    expect(h.level(1, 63, 0)).toBe(8);
    expect(h.level(1, 61, 0)).toBe(8);
    expect(h.level(2, 61, 0)).toBe(1);
  });

  it('two adjacent sources over a solid block make an infinite source', () => {
    const h = new Harness();
    h.floor(63);
    // a 3x1 trench
    for (let x = -1; x <= 3; x++) for (const z of [-1, 1]) h.world.setStateRaw(x, 64, z, STONE);
    h.world.setStateRaw(-1, 64, 0, STONE);
    h.world.setStateRaw(3, 64, 0, STONE);
    h.setBlock(0, 64, 0, water());
    h.setBlock(2, 64, 0, water());
    h.run(50);
    expect(h.level(1, 64, 0)).toBe(0);
    // taking one out refills from the other two
    h.setBlock(2, 64, 0, 0);
    h.run(50);
    expect(h.level(2, 64, 0)).not.toBe(0);
    h.setBlock(2, 64, 0, water());
    h.setBlock(1, 64, 0, 0);
    h.run(50);
    expect(h.level(1, 64, 0)).toBe(0);
  });

  it('lava never forms infinite sources', () => {
    const h = new Harness();
    h.ultraWarm = true;
    h.floor(63);
    for (let x = -1; x <= 3; x++) for (const z of [-1, 1]) h.world.setStateRaw(x, 64, z, STONE);
    h.world.setStateRaw(-1, 64, 0, STONE);
    h.world.setStateRaw(3, 64, 0, STONE);
    h.setBlock(0, 64, 0, lava());
    h.setBlock(2, 64, 0, lava());
    h.run(200);
    expect(h.level(1, 64, 0)).toBe(1); // flowing, amount 7
  });

  it('slope finding sends water only toward the nearest hole', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(3, 63, 0, 0); // a hole three blocks east
    h.setBlock(0, 64, 0, water());
    expect(getSpread(h, KIND_WATER, false, 0, 64, 0, water()).map((e) => e[0])).toEqual([5]);
    h.run(5);
    expect(h.name(1, 64, 0)).toBe('water');
    expect(h.name(-1, 64, 0)).toBe('air');
    expect(h.name(0, 64, 1)).toBe('air');
    expect(h.name(0, 64, -1)).toBe('air');
    h.run(30);
    expect(h.name(3, 63, 0)).toBe('water');
    expect(h.level(3, 63, 0)).toBe(8);
  });

  it('a hole beyond the search distance is not seen', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(7, 63, 0, 0);
    expect(getSpread(h, KIND_WATER, false, 0, 64, 0, water()).length).toBe(4);
  });

  it('equally near holes split the flow', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(2, 63, 0, 0);
    h.world.setStateRaw(0, 63, -2, 0);
    expect(getSpread(h, KIND_WATER, false, 0, 64, 0, water()).map((e) => e[0])).toEqual([2, 5]);
  });

  it('water washes away plants and torches, dropping them; lava burns them without drops', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(1, 64, 0, stateOf('poppy'));
    h.world.setStateRaw(-1, 64, 0, stateOf('torch'));
    h.setBlock(0, 64, 0, water());
    h.run(5);
    expect(h.name(1, 64, 0)).toBe('water');
    expect(h.name(-1, 64, 0)).toBe('water');
    expect(h.drops.map((d) => blockNameOf(d[3])).sort()).toEqual(['poppy', 'torch']);
    const l = new Harness();
    l.floor(63);
    l.world.setStateRaw(1, 64, 0, stateOf('poppy'));
    l.setBlock(0, 64, 0, lava());
    l.run(30);
    expect(l.name(1, 64, 0)).toBe('lava');
    expect(l.drops.length).toBe(0);
    expect(l.fizzes).toBe(1);
  });

  it('water does not flow through walls, doors or into full-face slabs', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(1, 64, 0, stateOf('oak_door'));
    h.world.setStateRaw(-1, 64, 0, stateOf('stone_slab', { type: 'double' }));
    h.setBlock(0, 64, 0, water());
    h.run(5);
    expect(h.name(1, 64, 0)).toBe('oak_door');
    expect(h.name(-1, 64, 0)).toBe('stone_slab');
    expect(h.name(0, 64, 1)).toBe('water');
  });

  it('flowing water does not waterlog blocks; a waterlogged block acts as a source', () => {
    const h = new Harness();
    h.floor(63);
    const slab = stateOf('oak_slab', { type: 'bottom', waterlogged: false });
    h.world.setStateRaw(2, 64, 0, slab);
    h.setBlock(0, 64, 0, water());
    h.run(100);
    expect(getProp(h.getState(2, 64, 0), 'waterlogged')).toBe(false);
    const g = new Harness();
    g.floor(63);
    // a waterlogged stair spreads water out of its open sides
    const ws = stateOf('oak_slab', { type: 'bottom', waterlogged: false });
    g.world.setStateRaw(0, 64, 0, ws);
    g.setBlock(0, 64, 0, stateOf('oak_slab', { type: 'bottom', waterlogged: true }));
    g.run(400);
    expect(g.level(1, 64, 0)).toBe(1);
    expect(g.level(7, 64, 0)).toBe(7);
    expect(getProp(g.getState(0, 64, 0), 'waterlogged')).toBe(true);
  });

  it('two sources waterlog a slab between them (infinite source into a container)', () => {
    const h = new Harness();
    h.floor(63);
    for (let x = -1; x <= 3; x++) for (const z of [-1, 1]) h.world.setStateRaw(x, 64, z, STONE);
    h.world.setStateRaw(-1, 64, 0, STONE);
    h.world.setStateRaw(3, 64, 0, STONE);
    h.world.setStateRaw(1, 64, 0, stateOf('oak_slab', { type: 'bottom', waterlogged: false }));
    h.setBlock(0, 64, 0, water());
    h.setBlock(2, 64, 0, water());
    h.run(20);
    expect(getProp(h.getState(1, 64, 0), 'waterlogged')).toBe(true);
  });
});

describe('lava and water', () => {
  it('water touching a lava source makes obsidian, flowing lava makes cobblestone', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(0, 64, 0, lava());
    h.setBlock(0, 65, 0, water());
    expect(h.name(0, 64, 0)).toBe('obsidian');
    h.world.setStateRaw(5, 64, 0, lava(2));
    h.setBlock(6, 64, 0, water());
    expect(h.name(5, 64, 0)).toBe('cobblestone');
    expect(h.fizzes).toBe(2);
  });

  it('water below lava does not harden it; lava flowing down onto water makes stone', () => {
    const h = new Harness();
    h.floor(60);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = 61; y <= 66; y++) h.world.setStateRaw(dx!, y, dz!, STONE);
    h.world.setStateRaw(0, 61, 0, STONE);
    h.setBlock(0, 62, 0, water());
    h.setBlock(0, 64, 0, lava());
    expect(h.name(0, 64, 0)).toBe('lava');
    h.run(100);
    expect(h.name(0, 62, 0)).toBe('stone');
    expect(h.name(0, 63, 0)).toBe('lava');
  });

  it('flowing water meeting flowing lava hardens it into cobblestone; reaching the source makes obsidian', () => {
    const h = new Harness();
    h.floor(63);
    for (let x = -1; x <= 5; x++) for (const z of [-1, 1]) h.world.setStateRaw(x, 64, z, STONE);
    h.setBlock(4, 64, 0, lava());
    h.run(30);
    expect(h.level(3, 64, 0)).toBe(2);
    h.setBlock(0, 64, 0, water());
    h.run(100);
    expect(h.name(2, 64, 0)).toBe('water');
    expect(h.name(3, 64, 0)).toBe('cobblestone');
    expect(h.name(4, 64, 0)).toBe('lava');
    // mining the cobblestone lets the water reach the lava source
    h.setBlock(3, 64, 0, 0);
    h.run(60);
    expect(h.name(3, 64, 0)).toBe('water');
    expect(h.name(4, 64, 0)).toBe('obsidian');
  });

  it('lava over soul soil next to blue ice becomes basalt', () => {
    const h = new Harness();
    h.floor(63);
    h.world.setStateRaw(0, 63, 0, stateOf('soul_soil'));
    h.world.setStateRaw(1, 64, 0, stateOf('blue_ice'));
    h.setBlock(0, 64, 0, lava());
    expect(h.name(0, 64, 0)).toBe('basalt');
  });
});

describe('flow vector', () => {
  it('points downhill along the levels, and down for falling water against a wall', () => {
    const h = new Harness();
    h.floor(63);
    h.setBlock(0, 64, 0, water());
    h.run(400);
    const f = getFlow(h, 3, 64, 0);
    expect(f[0]).toBeGreaterThan(0.99);
    expect(Math.abs(f[2])).toBeLessThan(1e-6);
    expect(getFlow(h, 0, 64, 0)).toEqual([0, 0, 0]);
    const g = new Harness();
    g.floor(60);
    g.world.setStateRaw(1, 62, 0, STONE);
    g.world.setStateRaw(0, 62, 0, water(8));
    g.world.setStateRaw(0, 63, 0, water(8));
    const v = getFlow(g, 0, 62, 0);
    expect(v[1]).toBeLessThan(-0.9);
  });

  it('spring ticks resolve to the fluid at the position', () => {
    expect(fluidTickType(water())).toBe(1);
    expect(fluidTickType(water(3))).toBe(2);
    expect(fluidTickType(lava())).toBe(3);
    expect(fluidTickType(stateOf('oak_slab', { waterlogged: true }))).toBe(1);
    expect(fluidTickType(STONE)).toBe(0);
  });
});
