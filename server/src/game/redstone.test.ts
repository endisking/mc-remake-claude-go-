import { describe, it, expect } from 'vitest';
import { Redstone, containerSignal, type RedstoneHost, UPDATE_ALL } from '@shared/game/redstone';
import { TickScheduler } from './ticks';
import { blockIdOf, blockNameOf as blockNameOfState, defaultState, getProp, stateOf, withProp } from '@shared/world/blockstate';

/** A tiny level: a map of states, a block tick list and the redstone engine wired like GameServer. */
class TestLevel {
  readonly blocks = new Map<string, number>();
  readonly ticks = new TickScheduler<number>();
  time = 0;
  primed: [number, number, number][] = [];
  dispensed = 0;
  entities = 0;
  readonly rs: Redstone;
  constructor() {
    const self = this;
    const host: RedstoneHost = {
      getState: (x, y, z) => self.get(x, y, z),
      setBlock: (x, y, z, s, f) => self.set(x, y, z, s, f),
      scheduleTick: (x, y, z, s, d, p) => self.ticks.schedule(self.time, x, y, z, blockIdOf(s), d, p),
      hasScheduledTick: (x, y, z, s) => self.ticks.has(x, y, z, blockIdOf(s)),
      willTickThisTick: (x, y, z, s) => self.ticks.willTickThisTick(self.time, x, y, z, blockIdOf(s)),
      gameTime: () => self.time,
      primeTnt: (x, y, z) => void self.primed.push([x, y, z]),
      dispense: () => void self.dispensed++,
      countEntities: () => self.entities,
      dropAndRemove: (x, y, z) => self.set(x, y, z, 0, UPDATE_ALL),
    };
    this.rs = new Redstone(host);
  }
  get(x: number, y: number, z: number): number {
    if (y === 0) return this.blocks.get(`${x},${y},${z}`) ?? defaultState('stone');
    return this.blocks.get(`${x},${y},${z}`) ?? 0;
  }
  set(x: number, y: number, z: number, s: number, flags = UPDATE_ALL): void {
    const old = this.get(x, y, z);
    if (old === s) return;
    this.blocks.set(`${x},${y},${z}`, s);
    this.rs.onBlockChanged(x, y, z, old, s, flags);
  }
  place(x: number, y: number, z: number, name: string, props?: Record<string, string | number | boolean>): void {
    let s = stateOf(name, props);
    if (name === 'redstone_wire') s = withProp(this.rs.wirePlacementState(x, y, z), 'power', 0);
    this.set(x, y, z, s);
    if (name === 'repeater' || name === 'comparator') this.rs.diodePlaced(x, y, z);
  }
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.time++;
      this.ticks.tick(this.time, () => true, (t) => {
        const st = this.get(t.x, t.y, t.z);
        if (blockIdOf(st) === t.type) this.rs.tick(t.x, t.y, t.z, st);
      });
      this.rs.runBlockEvents();
    }
  }
  prop(x: number, y: number, z: number, p: string) {
    return getProp(this.get(x, y, z), p);
  }
}

describe('redstone dust', () => {
  it('decays by one per block from a redstone block', () => {
    const l = new TestLevel();
    for (let x = 1; x <= 17; x++) l.place(x, 1, 0, 'redstone_wire');
    l.place(0, 1, 0, 'redstone_block');
    const powers = [];
    for (let x = 1; x <= 17; x++) powers.push(l.prop(x, 1, 0, 'power'));
    expect(powers).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
    // and turns off again
    l.set(0, 1, 0, 0);
    for (let x = 1; x <= 17; x++) expect(l.prop(x, 1, 0, 'power')).toBe(0);
  });

  it('connects into lines and stays a cross when alone', () => {
    const l = new TestLevel();
    l.place(0, 1, 0, 'redstone_wire');
    expect(['north', 'south', 'east', 'west'].map((p) => l.prop(0, 1, 0, p))).toEqual(['side', 'side', 'side', 'side']);
    l.place(1, 1, 0, 'redstone_wire');
    // an east-west line
    expect(l.prop(0, 1, 0, 'east')).toBe('side');
    expect(l.prop(0, 1, 0, 'west')).toBe('side');
    expect(l.prop(0, 1, 0, 'north')).toBe('none');
  });

  it('climbs up the side of a block and powers dust on top', () => {
    const l = new TestLevel();
    l.place(0, 1, 0, 'redstone_block');
    l.place(1, 1, 0, 'redstone_wire');
    l.place(2, 1, 0, 'stone');
    l.place(2, 2, 0, 'redstone_wire');
    expect(l.prop(1, 1, 0, 'east')).toBe('up');
    expect(l.prop(2, 2, 0, 'power')).toBe(14);
  });

  it('weakly powers the block it points into, which activates a lamp but not dust', () => {
    const l = new TestLevel();
    l.place(0, 1, 0, 'lever', { face: 'floor', facing: 'east' });
    l.place(1, 1, 0, 'redstone_wire');
    l.place(2, 1, 0, 'stone');
    l.place(3, 1, 0, 'redstone_lamp');
    l.rs.use(0, 1, 0, true);
    expect(l.prop(1, 1, 0, 'power')).toBe(15);
    // a weakly powered block activates components next to it...
    expect(l.prop(3, 1, 0, 'lit')).toBe(true);
    // ...but not dust
    l.place(3, 1, 0, 'redstone_wire');
    expect(l.prop(3, 1, 0, 'power')).toBe(0);
  });
});

describe('torches', () => {
  /** stone at x=1 with a wall lever on its west side (x=0) and a wall torch on its east side (x=2) */
  function inverter() {
    const l = new TestLevel();
    l.place(1, 1, 0, 'stone');
    l.place(0, 1, 0, 'lever', { face: 'wall', facing: 'west' });
    l.place(2, 1, 0, 'redstone_wall_torch', { facing: 'east', lit: true });
    l.place(3, 1, 0, 'redstone_wire');
    return l;
  }
  it('inverts its block after 2 ticks', () => {
    const l = inverter();
    expect(l.prop(3, 1, 0, 'power')).toBe(15);
    l.rs.use(0, 1, 0, true);
    expect(l.prop(2, 1, 0, 'lit')).toBe(true);
    l.step(1);
    expect(l.prop(2, 1, 0, 'lit')).toBe(true);
    l.step(1);
    expect(l.prop(2, 1, 0, 'lit')).toBe(false);
    expect(l.prop(3, 1, 0, 'power')).toBe(0);
    l.rs.use(0, 1, 0, true);
    l.step(2);
    expect(l.prop(2, 1, 0, 'lit')).toBe(true);
    expect(l.prop(3, 1, 0, 'power')).toBe(15);
  });

  it('burns out after 8 toggles within 60 ticks and recovers', () => {
    const l = inverter();
    for (let i = 0; i < 8; i++) {
      l.rs.use(0, 1, 0, true);
      l.step(2);
      expect(l.prop(2, 1, 0, 'lit')).toBe(false);
      l.rs.use(0, 1, 0, true);
      l.step(2);
      if (i < 7) expect(l.prop(2, 1, 0, 'lit')).toBe(true);
    }
    // the 8th turn-off burnt it out: unpowered but still dark
    expect(l.prop(2, 1, 0, 'lit')).toBe(false);
    l.step(40);
    expect(l.prop(2, 1, 0, 'lit')).toBe(false);
    // the 160-tick recheck relights it once the toggles are older than 60 ticks
    l.step(130);
    expect(l.prop(2, 1, 0, 'lit')).toBe(true);
  });
});

describe('repeaters', () => {
  function line(delay: number) {
    const l = new TestLevel();
    l.place(1, 1, 0, 'repeater', { facing: 'west', delay });
    l.place(2, 1, 0, 'redstone_wire');
    return l;
  }
  it('1-tick repeater turns on after 2 game ticks, 4-tick after 8', () => {
    for (const delay of [1, 4]) {
      const l = line(delay);
      l.place(0, 1, 0, 'redstone_block');
      let t = 0;
      while (l.prop(2, 1, 0, 'power') === 0 && t < 20) {
        l.step(1);
        t++;
      }
      expect(t).toBe(delay * 2);
      expect(l.prop(2, 1, 0, 'power')).toBe(15);
      // turns off after the same delay
      l.set(0, 1, 0, 0);
      t = 0;
      while ((l.prop(2, 1, 0, 'power') as number) > 0 && t < 20) {
        l.step(1);
        t++;
      }
      expect(t).toBe(delay * 2);
    }
  });

  it('extends short pulses to its delay', () => {
    const l = line(3);
    l.place(0, 1, 0, 'redstone_block');
    l.step(1);
    l.set(0, 1, 0, 0);
    let on = 0;
    for (let i = 0; i < 30; i++) {
      l.step(1);
      if (l.prop(2, 1, 0, 'power') === 15) on++;
    }
    expect(on).toBe(6);
  });

  it('is locked by a powered repeater on its side', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'repeater', { facing: 'west' });
    l.place(1, 1, 1, 'repeater', { facing: 'south' });
    l.place(1, 1, 2, 'redstone_block');
    l.step(4);
    expect(l.prop(1, 1, 1, 'powered')).toBe(true);
    expect(l.prop(1, 1, 0, 'locked')).toBe(true);
    l.place(0, 1, 0, 'redstone_block');
    l.step(10);
    expect(l.prop(1, 1, 0, 'powered')).toBe(false);
  });

  it('makes a working repeater clock', () => {
    // four 1-tick repeaters in a square, seeded by one pulse
    const c = new TestLevel();
    c.place(0, 1, 0, 'repeater', { facing: 'west' }); // outputs east → (1,1,0)
    c.place(1, 1, 0, 'redstone_wire');
    c.place(1, 1, 1, 'repeater', { facing: 'north' }); // input north (1,1,0) outputs south
    c.place(1, 1, 2, 'redstone_wire');
    c.place(0, 1, 2, 'repeater', { facing: 'east' }); // input east outputs west
    c.place(-1, 1, 2, 'redstone_wire');
    c.place(-1, 1, 1, 'repeater', { facing: 'south' }); // input south outputs north
    c.place(-1, 1, 0, 'redstone_wire');
    // seed a pulse at (-1,1,0)
    c.place(-1, 1, -1, 'redstone_block');
    c.step(1);
    c.set(-1, 1, -1, 0);
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      c.step(1);
      samples.push(c.prop(1, 1, 0, 'power') as number);
    }
    const rising = samples.map((v, i) => (v > 0 && (i === 0 || samples[i - 1] === 0) ? i : -1)).filter((i) => i >= 0);
    expect(rising.length).toBeGreaterThanOrEqual(3);
    // 4 repeaters × 2 game ticks per loop
    expect(rising[2]! - rising[1]!).toBe(8);
  });
});

describe('comparators', () => {
  it('subtracts the side input in subtract mode and compares in compare mode', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'comparator', { facing: 'west' }); // rear input at x=0, output at x=2
    l.place(2, 1, 0, 'redstone_wire');
    l.place(0, 1, 0, 'redstone_block');
    l.step(2);
    expect(l.prop(2, 1, 0, 'power')).toBe(15);
    // side input of strength 13: dust 2 blocks from a redstone block
    l.place(1, 1, 1, 'redstone_wire');
    l.place(1, 1, 2, 'redstone_wire');
    l.place(1, 1, 3, 'redstone_wire');
    l.place(1, 1, 4, 'redstone_block');
    expect(l.prop(1, 1, 1, 'power')).toBe(13);
    l.step(4);
    expect(l.prop(2, 1, 0, 'power')).toBe(15); // compare: 15 >= 13
    l.rs.use(1, 1, 0, true); // subtract
    l.step(4);
    expect(l.prop(2, 1, 0, 'power')).toBe(2);
  });

  it('reads a container fill level', () => {
    expect(containerSignal([{ id: 1, count: 64 }, ...Array(26).fill(null)], () => 64)).toBe(1);
    expect(containerSignal(Array(27).fill({ id: 1, count: 64 }), () => 64)).toBe(15);
    expect(containerSignal(Array(27).fill(null), () => 64)).toBe(0);
    // one sword in a hopper (5 slots): 1/5 * 14 = 2.8 → 2 + 1
    expect(containerSignal([{ id: 2, count: 1 }, null, null, null, null], () => 1)).toBe(3);
  });

  it('reads cake bites', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'comparator', { facing: 'west' });
    l.place(2, 1, 0, 'redstone_wire');
    l.place(0, 1, 0, 'cake', { bites: 3 });
    l.step(4);
    expect(l.prop(2, 1, 0, 'power')).toBe(8); // (7 - 3) * 2
  });
});

describe('lamps, TNT, doors, observers, buttons, plates', () => {
  it('a lamp turns on at once and off 4 ticks later', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'redstone_lamp');
    l.place(0, 1, 0, 'redstone_block');
    expect(l.prop(1, 1, 0, 'lit')).toBe(true);
    l.set(0, 1, 0, 0);
    l.step(3);
    expect(l.prop(1, 1, 0, 'lit')).toBe(true);
    l.step(1);
    expect(l.prop(1, 1, 0, 'lit')).toBe(false);
  });

  it('TNT ignites when powered', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'tnt');
    l.place(0, 1, 0, 'redstone_block');
    expect(l.primed).toEqual([[1, 1, 0]]);
    expect(l.get(1, 1, 0)).toBe(0);
  });

  it('opens an iron door with both halves', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'iron_door', { half: 'lower', facing: 'north' });
    l.place(1, 2, 0, 'iron_door', { half: 'upper', facing: 'north' });
    l.place(0, 1, 0, 'redstone_block');
    expect(l.prop(1, 1, 0, 'open')).toBe(true);
    expect(l.prop(1, 2, 0, 'open')).toBe(true);
    l.set(0, 1, 0, 0);
    expect(l.prop(1, 2, 0, 'open')).toBe(false);
  });

  it('an observer emits a 2-tick pulse after a 2-tick delay', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'observer', { facing: 'west' }); // watches x=0, outputs at x=2
    l.place(2, 1, 0, 'redstone_wire');
    l.place(0, 1, 0, 'stone');
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push(l.prop(2, 1, 0, 'power') as number);
      l.step(1);
    }
    expect(seen).toEqual([0, 0, 15, 15, 0, 0, 0, 0]);
  });

  it('stone buttons stay pressed 20 ticks, wooden 30', () => {
    for (const [name, ticks] of [['stone_button', 20], ['oak_button', 30]] as const) {
      const l = new TestLevel();
      l.place(1, 1, 0, 'stone');
      l.place(0, 1, 0, name, { face: 'wall', facing: 'west' });
      l.place(2, 1, 0, 'redstone_lamp');
      l.rs.use(0, 1, 0, true);
      expect(l.prop(2, 1, 0, 'lit')).toBe(true);
      l.step(ticks - 1);
      expect(l.prop(0, 1, 0, 'powered')).toBe(true);
      l.step(1);
      expect(l.prop(0, 1, 0, 'powered')).toBe(false);
    }
  });

  it('weighted plates scale with entity count; plates release after their check', () => {
    const l = new TestLevel();
    l.place(0, 1, 0, 'light_weighted_pressure_plate');
    l.entities = 7;
    l.rs.entityInside(0, 1, 0);
    expect(l.prop(0, 1, 0, 'power')).toBe(7);
    const h = new TestLevel();
    h.place(0, 1, 0, 'heavy_weighted_pressure_plate');
    h.entities = 7;
    h.rs.entityInside(0, 1, 0);
    expect(h.prop(0, 1, 0, 'power')).toBe(1); // ceil(7/150*15)
    const s = new TestLevel();
    s.place(0, 1, 0, 'stone_pressure_plate');
    s.place(1, 1, 0, 'redstone_wire');
    s.entities = 1;
    s.rs.entityInside(0, 1, 0);
    expect(s.prop(1, 1, 0, 'power')).toBe(15);
    s.entities = 0;
    s.step(19);
    expect(s.prop(0, 1, 0, 'powered')).toBe(true);
    s.step(1);
    expect(s.prop(0, 1, 0, 'powered')).toBe(false);
    expect(s.prop(1, 1, 0, 'power')).toBe(0);
  });

  it('dispensers fire once on a rising edge after 4 ticks', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'dispenser', { facing: 'east' });
    l.place(0, 1, 0, 'redstone_block');
    expect(l.prop(1, 1, 0, 'triggered')).toBe(true);
    l.step(3);
    expect(l.dispensed).toBe(0);
    l.step(1);
    expect(l.dispensed).toBe(1);
    l.step(10);
    expect(l.dispensed).toBe(1);
  });
});

describe('pistons', () => {
  const name = (l: TestLevel, x: number, y: number, z: number) => blockNameOfState(l.get(x, y, z));
  it('pushes up to 12 blocks, not 13, and never obsidian', () => {
    for (const [n, ok] of [[12, true], [13, false]] as const) {
      const l = new TestLevel();
      l.place(0, 1, 0, 'piston', { facing: 'east' });
      for (let i = 1; i <= n; i++) l.place(i, 1, 0, 'stone');
      l.place(-1, 1, 0, 'redstone_block');
      l.step(1);
      expect(l.prop(0, 1, 0, 'extended')).toBe(ok);
      expect(name(l, 1, 1, 0)).toBe(ok ? 'piston_head' : 'stone');
      if (ok) expect(name(l, 13, 1, 0)).toBe('stone');
    }
    const o = new TestLevel();
    o.place(0, 1, 0, 'piston', { facing: 'east' });
    o.place(1, 1, 0, 'obsidian');
    o.place(-1, 1, 0, 'redstone_block');
    o.step(1);
    expect(o.prop(0, 1, 0, 'extended')).toBe(false);
  });

  it('destroys fragile blocks in the way and retracts without pulling (normal piston)', () => {
    const l = new TestLevel();
    l.place(0, 1, 0, 'piston', { facing: 'east' });
    l.place(1, 1, 0, 'stone');
    l.place(2, 1, 0, 'oak_door', { half: 'lower' });
    l.place(-1, 1, 0, 'redstone_block');
    l.step(1);
    expect(name(l, 2, 1, 0)).toBe('stone');
    l.set(-1, 1, 0, 0);
    l.step(1);
    expect(l.prop(0, 1, 0, 'extended')).toBe(false);
    expect(name(l, 1, 1, 0)).toBe('air');
    expect(name(l, 2, 1, 0)).toBe('stone');
  });

  it('sticky pistons pull the block back; slime drags its neighbours', () => {
    const l = new TestLevel();
    l.place(0, 2, 0, 'sticky_piston', { facing: 'east' });
    l.place(1, 2, 0, 'slime_block');
    l.place(1, 3, 0, 'stone');
    l.place(1, 2, 1, 'oak_planks');
    l.place(-1, 2, 0, 'redstone_block');
    l.step(1);
    expect(name(l, 2, 2, 0)).toBe('slime_block');
    expect(name(l, 2, 3, 0)).toBe('stone');
    expect(name(l, 2, 2, 1)).toBe('oak_planks');
    l.set(-1, 2, 0, 0);
    l.step(1);
    expect(name(l, 1, 2, 0)).toBe('slime_block');
    expect(name(l, 1, 3, 0)).toBe('stone');
    expect(name(l, 1, 2, 1)).toBe('oak_planks');
    expect(name(l, 2, 2, 0)).toBe('air');
  });

  it('is quasi-connected: powered from the block above its own position', () => {
    const l = new TestLevel();
    l.place(0, 1, 0, 'piston', { facing: 'east' });
    // a redstone block diagonally above (next to the space above the piston) powers it
    l.place(-1, 2, 0, 'redstone_block');
    l.step(1);
    // placing the block was a neighbour update of the space above only: no update reached the piston
    expect(l.prop(0, 1, 0, 'extended')).toBe(false);
    // any update to the piston now makes it notice
    l.place(0, 1, 1, 'stone');
    l.step(1);
    expect(l.prop(0, 1, 0, 'extended')).toBe(true);
  });
});

describe('target block', () => {
  it('outputs by distance from the centre and resets after 20 ticks for arrows', () => {
    const l = new TestLevel();
    l.place(1, 1, 0, 'target');
    l.place(2, 1, 0, 'redstone_wire');
    // dead centre of the west face → 15
    expect(l.rs.targetHit(1, 1, 0, 1, 1.5, 0.5, 4, true)).toBe(15);
    expect(l.prop(2, 1, 0, 'power')).toBe(15);
    l.step(19);
    expect(l.prop(1, 1, 0, 'power')).toBe(15);
    l.step(1);
    expect(l.prop(1, 1, 0, 'power')).toBe(0);
    // near the edge → 1
    expect(l.rs.targetHit(1, 1, 0, 1, 1.02, 0.5, 4, true)).toBe(1);
  });
});
