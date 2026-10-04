import { describe, it, expect } from 'vitest';
import { PlayerPhysics, NO_INPUT, type MoveInput } from './playerphysics';
import { stateOf } from '../world/blockstate';

const STONE = stateOf('stone');
const ICE = stateOf('ice');
const WATER = stateOf('water');
const LADDER = stateOf('ladder', { facing: 'north' });
const SOUL_SAND = stateOf('soul_sand');
const COBWEB = stateOf('cobweb');

/** Infinite flat world: stone at y <= 63, plus overrides. */
function world(extra: Record<string, number> = {}, floor = STONE) {
  return {
    getState: (x: number, y: number, z: number) => {
      const k = `${x},${y},${z}`;
      if (k in extra) return extra[k]!;
      return y <= 63 ? floor : 0;
    },
  };
}

function spawn(w = world()) {
  const p = new PlayerPhysics(w);
  p.x = 0.5;
  p.y = 64;
  p.z = 0.5;
  p.onGround = true;
  return p;
}

const fwd = (extra: Partial<MoveInput> = {}): MoveInput => ({ ...NO_INPUT, forward: 1, ...extra });

/** Average horizontal speed in m/s over the last `measure` ticks after `warm` ticks. */
function speed(p: PlayerPhysics, input: MoveInput, warm = 60, measure = 100): number {
  for (let i = 0; i < warm; i++) p.tick(input);
  const x0 = p.x, z0 = p.z;
  for (let i = 0; i < measure; i++) p.tick(input);
  return (Math.hypot(p.x - x0, p.z - z0) / measure) * 20;
}

describe('player physics (vanilla 1.17.1 values)', () => {
  it('walks at ~4.317 m/s', () => {
    expect(speed(spawn(), fwd())).toBeCloseTo(4.317, 2);
  });
  it('sprints at ~5.612 m/s', () => {
    expect(speed(spawn(), fwd({ sprint: true }))).toBeCloseTo(5.612, 2);
  });
  it('sneaks at ~1.295 m/s', () => {
    expect(speed(spawn(), fwd({ sneak: true }))).toBeCloseTo(1.295, 2);
  });
  it('sprint-jumps at ~7.1 m/s average', () => {
    const v = speed(spawn(), fwd({ sprint: true, jump: true }), 60, 240);
    expect(v).toBeGreaterThan(6.9);
    expect(v).toBeLessThan(7.3);
  });
  it('jumps ~1.25 blocks high', () => {
    const p = spawn();
    p.tick({ ...NO_INPUT, jump: true });
    let maxY = p.y;
    for (let i = 0; i < 20; i++) {
      p.tick(NO_INPUT);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY - 64).toBeCloseTo(1.2522, 3);
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(64, 6);
  });
  it('reaches ~78.4 m/s terminal velocity falling', () => {
    const p = new PlayerPhysics({ getState: () => 0 });
    p.y = 10000;
    for (let i = 0; i < 400; i++) p.tick(NO_INPUT);
    expect(-p.vy * 20).toBeCloseTo(78.4, 0);
  });
  it('steps up 0.5 blocks (slab) but not a full block', () => {
    const slab = stateOf('stone_slab', { type: 'bottom' });
    const slabs: Record<string, number> = {};
    for (let z = 2; z < 40; z++) slabs[`0,64,${z}`] = slab;
    const p = spawn(world(slabs));
    for (let i = 0; i < 30; i++) p.tick(fwd());
    expect(p.y).toBeCloseTo(64.5, 6);
    const q = spawn(world({ '0,64,2': STONE }));
    for (let i = 0; i < 30; i++) q.tick(fwd());
    expect(q.y).toBeCloseTo(64, 6);
    expect(q.z).toBeCloseTo(1.7, 6); // stopped against the block (2 - 0.3)
  });
  it('sneaking stops at the edge of a block', () => {
    const p = spawn(world({}, 0));
    // single pillar under the player
    const w = { getState: (x: number, y: number, z: number) => (x === 0 && z === 0 && y <= 63 ? STONE : 0) };
    const q = new PlayerPhysics(w);
    q.x = 0.5; q.y = 64; q.z = 0.5; q.onGround = true;
    for (let i = 0; i < 60; i++) q.tick(fwd({ sneak: true }));
    expect(q.y).toBeCloseTo(64, 6);
    expect(q.z).toBeLessThan(1.31);
    expect(q.z).toBeGreaterThan(1.2);
    void p;
  });
  it('slides on ice and is slowed by soul sand and cobwebs', () => {
    // ice: slightly lower top walking speed (vanilla formula) but long slides after letting go
    const ice = spawn(world({}, ICE));
    expect(speed(ice, fwd())).toBeCloseTo(4.155, 2);
    const stone = spawn();
    speed(stone, fwd());
    const zi = ice.z, zs = stone.z;
    for (let i = 0; i < 40; i++) {
      ice.tick(NO_INPUT);
      stone.tick(NO_INPUT);
    }
    expect(ice.z - zi).toBeGreaterThan(1.5);
    expect(stone.z - zs).toBeLessThan(0.3);
    // the 0.4 speed factor is applied every tick before friction, giving ~2.51 m/s overall
    expect(speed(spawn(world({}, SOUL_SAND)), fwd())).toBeCloseTo(2.51, 2);
    const p = spawn(world({ '0,64,1': COBWEB, '0,65,1': COBWEB }));
    for (let i = 0; i < 40; i++) p.tick(fwd());
    expect(p.z).toBeLessThan(2.5); // ~8 blocks without the web
  });
  it('climbs ladders at ~2.35 m/s', () => {
    const extra: Record<string, number> = {};
    for (let y = 64; y < 90; y++) {
      extra[`0,${y},0`] = LADDER;
      extra[`0,${y},1`] = STONE;
    }
    const p = spawn(world(extra));
    for (let i = 0; i < 20; i++) p.tick(fwd());
    const y0 = p.y;
    for (let i = 0; i < 40; i++) p.tick(fwd());
    expect(((p.y - y0) / 40) * 20).toBeCloseTo(2.353, 1);
  });
  it('sinks slowly in water and swims up when holding jump', () => {
    const extra: Record<string, number> = {};
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 60; y <= 70; y++) extra[`${x},${y},${z}`] = WATER;
    const p = spawn(world(extra));
    p.y = 66;
    p.onGround = false;
    for (let i = 0; i < 40; i++) p.tick(NO_INPUT);
    expect(p.isInWater).toBe(true);
    expect(p.vy).toBeLessThan(0);
    expect(p.vy).toBeGreaterThan(-0.2);
    const y0 = p.y;
    for (let i = 0; i < 20; i++) p.tick({ ...NO_INPUT, jump: true });
    expect(p.y).toBeGreaterThan(y0);
  });
  it('flies in creative at ~10.92 m/s and ~21.6 m/s sprinting', () => {
    const p = spawn();
    p.abilities.mayFly = true;
    p.abilities.flying = true;
    p.y = 80;
    p.onGround = false;
    expect(speed(p, fwd())).toBeCloseTo(10.92, 1);
    expect(speed(p, fwd({ sprint: true }))).toBeCloseTo(21.6, 0);
  });
  it('crouching lowers the hitbox to 1.5 and crawling fits 1-block gaps', () => {
    const p = spawn();
    p.tick({ ...NO_INPUT, sneak: true });
    expect(p.height).toBe(1.5);
    expect(p.eyeHeight).toBe(1.27);
    const q = spawn(world({ '0,65,0': STONE }));
    q.tick(NO_INPUT);
    expect(q.pose).toBe('swimming');
    expect(q.height).toBe(0.6);
  });

  it('auto-jump climbs a 1-block step but not a 2-block wall; off by default', () => {
    // yaw 0 walks toward +z; a raised floor from z=3 on
    const raised: Record<string, number> = {};
    for (let z = 3; z < 30; z++) raised[`0,64,${z}`] = STONE;
    const step = world(raised);
    const p = spawn(step);
    p.autoJumpEnabled = true;
    for (let i = 0; i < 40; i++) p.tick(fwd());
    expect(p.y).toBeGreaterThanOrEqual(65);
    expect(p.z).toBeGreaterThan(3);
    const q = spawn(step);
    for (let i = 0; i < 40; i++) q.tick(fwd());
    expect(q.y).toBe(64);
    const wall = world({ ...raised, '0,65,3': STONE });
    const r = spawn(wall);
    r.autoJumpEnabled = true;
    let jumped = false;
    for (let i = 0; i < 40; i++) {
      r.tick(fwd());
      if (r.y > 64.01) jumped = true;
    }
    expect(jumped).toBe(false);
  });
});
