import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { BlockWorld } from '@shared/world/world';
import { stateOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME, ITEMS_BY_NAME } from '@shared/data';
import { damageAfterArmor, totalArmor } from '@shared/game/armor';
import { mobLoot } from '@shared/game/mobloot';
import { itemName } from '@shared/item/stack';
import { JavaRandom } from '@shared/util/random';
import { MOB_FLAG } from '@shared/entity/mobdata';
import { ItemEntity, ExperienceOrb } from '../entity';
import { findPath, DEFAULT_MALUS, PathType, type PathMob } from './pathfinder';
import { Mob } from './mob';
import { Zombie, Creeper, Skeleton } from './monsters';
import { Cow, Sheep, Chicken, Animal } from './animals';
import { Arrow } from './arrow';
import { bowPower } from './monsters';
import { MOB_CAPS } from './manager';
import { Slime, isSlimeChunk } from './slime';
import { Enderman } from './enderman';
import { Bat, Squid } from './ambient';

const GRASS = stateOf('grass_block', { snowy: false });
const STONE = stateOf('stone');
const DIRT = stateOf('dirt');

/** Flat plains: bedrock 0, stone 1–59, dirt 60–62, grass 63; surface y = 64. */
class FlatGen {
  generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    c.biomes.fill(BIOMES_BY_NAME.get('plains')!.id);
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        c.setState(x, 0, z, stateOf('bedrock'));
        for (let y = 1; y < 60; y++) c.setState(x, y, z, STONE);
        for (let y = 60; y < 63; y++) c.setState(x, y, z, DIRT);
        c.setState(x, 63, z, GRASS);
      }
    c.computeHeightmaps();
    return c;
  }
}

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

function setup(opts: { spawnMobs?: boolean; dayTime?: number } = {}) {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: 0, devTerrain: true, randomSeed: 42n, spawnMobs: opts.spawnMobs ?? false });
  (server as unknown as { generator: FlatGen }).generator = new FlatGen();
  server.doDaylightCycle = false;
  server.dayTime = opts.dayTime ?? 6000;
  const a = client(server, 'A');
  const p = server.players[0]!;
  a.send({ t: 'chat', message: '/tp 0.5 64 0.5' });
  a.send({ t: 'move', x: 0.5, y: 64, z: 0.5, yaw: 0, pitch: 0, onGround: true });
  for (let i = 0; i < 61; i++) server.tick();
  return { server, a, p };
}

const ticks = (s: GameServer, n: number) => {
  for (let i = 0; i < n; i++) s.tick();
};
const give = (a: ReturnType<typeof client>, item: string, n = 1) => a.send({ t: 'chat', message: `/give @s ${item} ${n}` });

// ---------------------------------------------------------------- pathfinding
function flatWorld(): BlockWorld {
  const w = new BlockWorld();
  const g = new FlatGen();
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.addChunk(g.generate(cx, cz));
  return w;
}
const mobAt = (x: number, y: number, z: number): PathMob => ({
  x, y, z, width: 0.6, height: 1.95, onGround: true, maxUpStep: 0.6, canFloat: true, canOpenDoors: false,
  malus: (t) => DEFAULT_MALUS[t]!, maxFallDistance: () => 3,
});

describe('ground pathfinding (WalkNodeEvaluator)', () => {
  it('walks straight on flat ground and around a 2-high wall', () => {
    const w = flatWorld();
    const straight = findPath(w, mobAt(0.5, 64, 0.5), 8, 64, 0, 16, 1)!;
    expect(straight.reached).toBe(true);
    expect(straight.nodes.length).toBeLessThanOrEqual(9);
    for (let z = -3; z <= 3; z++) for (let y = 64; y <= 65; y++) w.setStateRaw(4, y, z, STONE);
    const around = findPath(w, mobAt(0.5, 64, 0.5), 8, 64, 0, 32, 0)!;
    expect(around.reached).toBe(true);
    expect(around.nodes.some((n) => Math.abs(n.z) >= 4)).toBe(true);
    expect(around.nodes.every((n) => n.y === 64)).toBe(true);
  });

  it('steps up one block but not two; falls at most 3 blocks', () => {
    const w = flatWorld();
    for (let z = -16; z <= 16; z++) w.setStateRaw(4, 64, z, STONE);
    const up = findPath(w, mobAt(0.5, 64, 0.5), 8, 64, 0, 32, 0)!;
    expect(up.reached).toBe(true);
    expect(up.nodes.some((n) => n.x === 4 && n.y === 65)).toBe(true);
    for (let z = -16; z <= 16; z++) w.setStateRaw(4, 65, z, STONE);
    const blocked = findPath(w, mobAt(0.5, 64, 0.5), 8, 64, 0, 32, 0)!;
    expect(blocked.reached).toBe(false);
    // a 4-deep pit is not entered, a 3-deep one is
    const w2 = flatWorld();
    for (let y = 60; y <= 63; y++) w2.setStateRaw(3, y, 0, 0);
    const deep = findPath(w2, mobAt(0.5, 64, 0.5), 3, 60, 0, 16, 0)!;
    expect(deep.reached).toBe(false);
    w2.setStateRaw(3, 60, 0, STONE);
    const ok = findPath(w2, mobAt(0.5, 64, 0.5), 3, 61, 0, 16, 0)!;
    expect(ok.reached).toBe(true);
  });

  it('avoids lava and fences, and pays the water malus', () => {
    const w = flatWorld();
    for (let z = -2; z <= 2; z++) w.setStateRaw(3, 63, z, stateOf('lava'));
    const p = findPath(w, mobAt(0.5, 64, 0.5), 6, 64, 0, 32, 0)!;
    expect(p.reached).toBe(true);
    expect(p.nodes.every((n) => !(n.x === 3 && Math.abs(n.z) <= 2))).toBe(true);
    const fence = stateOf('oak_fence');
    for (let z = -16; z <= 16; z++) w.setStateRaw(8, 64, z, fence);
    expect(findPath(w, mobAt(0.5, 64, 0.5), 10, 64, 0, 32, 0)!.reached).toBe(false);
    expect(DEFAULT_MALUS[PathType.WATER]).toBe(8);
  });
});

// ---------------------------------------------------------------- pure rules
describe('mob rules', () => {
  it('armour formula (CombatRules.getDamageAfterAbsorb) and armour values', () => {
    expect(damageAfterArmor(10, 20, 0)).toBeCloseTo(4, 6);
    expect(damageAfterArmor(10, 20, 8)).toBeCloseTo(3, 6);
    expect(damageAfterArmor(3, 2, 0)).toBeCloseTo(3 * (1 - 0.5 / 25), 6); // zombie armour 2 vs a 3-damage hit
    const id = (n: string) => ITEMS_BY_NAME.get(n)!.id;
    expect(totalArmor([id('diamond_boots'), id('diamond_leggings'), id('diamond_chestplate'), id('diamond_helmet')])).toEqual({ armor: 20, toughness: 8, knockbackResistance: 0 });
    expect(totalArmor([0, 0, id('iron_chestplate'), 0]).armor).toBe(6);
  });

  it('loot tables: ranges, looting, killed-by-player and cooking', () => {
    const r = new JavaRandom(1n);
    const rnd = () => r.nextFloat();
    const counts = (type: string, ctx: Partial<Parameters<typeof mobLoot>[1]>, item: string) => {
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        const l = mobLoot(type, { looting: 0, onFire: false, killedByPlayer: true, random: rnd, ...ctx });
        out.push(l.filter((s) => itemName(s.id) === item).reduce((a, s) => a + s.count, 0));
      }
      return out;
    };
    const flesh = counts('zombie', {}, 'rotten_flesh');
    expect(Math.min(...flesh)).toBe(0);
    expect(Math.max(...flesh)).toBe(2);
    expect(Math.max(...counts('zombie', { looting: 3 }, 'rotten_flesh'))).toBe(5);
    expect(Math.min(...counts('pig', {}, 'porkchop'))).toBe(1);
    expect(Math.max(...counts('pig', {}, 'porkchop'))).toBe(3);
    expect(Math.max(...counts('pig', { onFire: true }, 'porkchop'))).toBe(0);
    expect(Math.min(...counts('pig', { onFire: true }, 'cooked_porkchop'))).toBe(1);
    expect(Math.max(...counts('spider', { killedByPlayer: false }, 'spider_eye'))).toBe(0);
    expect(Math.max(...counts('spider', {}, 'spider_eye'))).toBe(1);
    expect(Math.max(...counts('sheep', { sheared: true }, 'white_wool'))).toBe(0);
    expect(Math.min(...counts('sheep', { color: 'black' }, 'black_wool'))).toBe(1);
    expect(Math.max(...counts('skeleton', {}, 'bone'))).toBe(2);
    expect(Math.max(...counts('creeper', {}, 'gunpowder'))).toBe(2);
    expect(Math.min(...counts('cow', {}, 'beef'))).toBe(1);
    expect(Math.max(...counts('chicken', {}, 'feather'))).toBe(2);
  });

  it('bow power, mob caps and sheep colours', () => {
    expect(bowPower(20)).toBe(1);
    expect(bowPower(10)).toBeCloseTo((0.25 + 1) / 3, 6);
    expect(MOB_CAPS.monster).toBe(70);
    expect(MOB_CAPS.creature).toBe(10);
    const r = new JavaRandom(3n);
    const colors = new Map<number, number>();
    for (let i = 0; i < 10000; i++) {
      const c = Sheep.randomColor(r);
      colors.set(c, (colors.get(c) ?? 0) + 1);
    }
    expect(colors.get(15)! / 10000).toBeCloseTo(0.05, 1);
    expect(colors.get(0)! / 10000).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------- in-server behaviour
describe('mobs on the server', { timeout: 60000 }, () => {
  it('zombie melee: 3 damage on normal (2.5 easy, 4.5 hard), reduced by armour; arms raised; death message', () => {
    for (const [diff, expected] of [['normal', 3], ['easy', 2.5], ['hard', 4.5]] as const) {
      const { server, a, p } = setup();
      a.send({ t: 'chat', message: `/difficulty ${diff}` });
      const z = server.mobs.spawn('zombie', 1.5, 64, 0.5) as Zombie;
      z.baby = false;
      z.mainHand = null;
      server.tick();
      z.target = p;
      let hurtAt = -1;
      for (let i = 0; i < 60 && hurtAt < 0; i++) {
        server.tick();
        if (p.living.health < 20) hurtAt = i;
      }
      expect(20 - p.living.health).toBeCloseTo(expected, 5);
      expect(a.received.some((m) => m.t === 'animate' && m.id === z.id && m.action === 0)).toBe(true);
    }
    // iron chestplate: 6 armour
    const { server, a, p } = setup();
    p.inventory.set(38, { id: ITEMS_BY_NAME.get('iron_chestplate')!.id, count: 1, damage: 0 });
    const z = server.mobs.spawn('zombie', 1.5, 64, 0.5) as Zombie;
    z.baby = false;
    z.mainHand = null;
    z.target = p;
    for (let i = 0; i < 60 && p.living.health === 20; i++) server.tick();
    expect(20 - p.living.health).toBeCloseTo(damageAfterArmor(3, 6, 0), 5);
    expect(p.inventory.get(38)!.damage).toBe(1);
    // kill the player: "A was slain by Zombie"
    p.living.health = 1;
    p.inventory.set(38, null);
    ticks(server, 40);
    expect(a.received.some((m) => m.t === 'chat' && m.json.includes('A was slain by Zombie'))).toBe(true);
  });

  it('zombies burn in daylight under open sky, not at night', () => {
    const { server } = setup({ dayTime: 6000 });
    const z = server.mobs.spawn('zombie', 6.5, 64, 6.5) as Zombie;
    for (let i = 0; i < 300 && !z.isOnFire(); i++) server.tick();
    expect(z.isOnFire()).toBe(true);
    const n = setup({ dayTime: 18000 });
    const z2 = n.server.mobs.spawn('zombie', 6.5, 64, 6.5) as Zombie;
    ticks(n.server, 300);
    expect(z2.isOnFire()).toBe(false);
  });

  it('creeper: swells within 3 blocks, explodes 30 ticks later (power 3), destroying blocks and hurting the player', () => {
    const { server, a, p } = setup();
    const c = server.mobs.spawn('creeper', 2.5, 64, 0.5) as Creeper;
    c.target = p;
    let swellAt = -1, goneAt = -1;
    for (let i = 0; i < 120 && goneAt < 0; i++) {
      server.tick();
      if (swellAt < 0 && (c.mobFlags() & MOB_FLAG.SWELLING)) swellAt = i;
      if (c.removed) goneAt = i;
    }
    expect(swellAt).toBeGreaterThanOrEqual(0);
    expect(goneAt - swellAt).toBe(30);
    expect(p.living.health).toBeLessThan(20);
    expect(server.world.getState(2, 63, 0)).toBe(0);
    expect(a.received.some((m) => m.t === 'explode' && m.power === 3)).toBe(true);
  });

  it('skeletons shoot arrows (velocity 1.6) that hurt the player', () => {
    const { server, p } = setup({ dayTime: 18000 });
    const s = server.mobs.spawn('skeleton', 8.5, 64, 0.5) as Skeleton;
    s.target = p;
    let arrow: Arrow | null = null;
    for (let i = 0; i < 200 && p.living.health === 20; i++) {
      server.tick();
      for (const e of server.entities.values()) if (e instanceof Arrow && !arrow) arrow = e;
    }
    expect(arrow).not.toBeNull();
    expect(arrow!.owner).toBe(s);
    expect(p.living.health).toBeLessThan(20);
  });

  it('player attacks: damage, knockback, death after 20 ticks with loot and XP', () => {
    const { server, a, p } = setup();
    give(a, 'diamond_sword');
    ticks(server, 20);
    const pig = server.mobs.spawn('pig', 1.5, 64, 0.5)!;
    server.tick();
    a.send({ t: 'attack', target: pig.id, sneaking: false });
    expect(pig.health).toBe(3);
    expect(pig.vx).toBeGreaterThan(0); // knocked away from the player (+x)
    ticks(server, 20);
    a.send({ t: 'attack', target: pig.id, sneaking: false });
    expect(pig.dead).toBe(true);
    expect(a.received.some((m) => m.t === 'entityEvent' && m.id === pig.id && m.event === 3)).toBe(true);
    ticks(server, 21);
    expect(pig.removed).toBe(true);
    const items = [...server.entities.values()].filter((e) => e instanceof ItemEntity) as ItemEntity[];
    expect(items.some((e) => itemName(e.stack.id) === 'porkchop')).toBe(true);
    expect([...server.entities.values()].some((e) => e instanceof ExperienceOrb) || p.living.totalExperience > 0).toBe(true);
    expect(p.inventory.get(0)!.damage).toBe(2); // the sword lost 1 durability per hit
  });

  it('breeding: feed two cows wheat → a calf (age −24000) and 6000-tick cooldowns; calves grow up', () => {
    const { server, a, p } = setup();
    give(a, 'wheat', 2);
    const c1 = server.mobs.spawn('cow', 2.5, 64, 0.5) as Cow;
    const c2 = server.mobs.spawn('cow', 3.5, 64, 1.5) as Cow;
    c1.ageTicks = c2.ageTicks = 0;
    a.send({ t: 'interact', target: c1.id, hand: 0 });
    a.send({ t: 'interact', target: c2.id, hand: 0 });
    expect(c1.isInLove() && c2.isInLove()).toBe(true);
    expect(p.inventory.get(0)).toBeNull();
    let calf: Animal | undefined;
    for (let i = 0; i < 400 && !calf; i++) {
      server.tick();
      calf = server.mobs.mobs().find((m) => m instanceof Cow && m.isBaby()) as Animal | undefined;
    }
    expect(calf).toBeDefined();
    expect(calf!.ageTicks).toBeGreaterThan(-24000);
    expect(c1.ageTicks).toBeGreaterThan(5000);
    expect(c2.ageTicks).toBeGreaterThan(5000);
    calf!.ageTicks = -2;
    ticks(server, 3);
    expect(calf!.isBaby()).toBe(false);
  });

  it('sheep shearing and regrowing wool, cow milking, chicken eggs', () => {
    const { server, a, p } = setup();
    give(a, 'shears');
    const sheep = server.mobs.spawn('sheep', 1.5, 64, 0.5) as Sheep;
    sheep.ageTicks = 0;
    sheep.color = 0;
    server.tick();
    a.send({ t: 'interact', target: sheep.id, hand: 0 });
    expect(sheep.sheared).toBe(true);
    const wool = [...server.entities.values()].filter((e) => e instanceof ItemEntity && itemName(e.stack.id) === 'white_wool');
    expect(wool.length).toBeGreaterThanOrEqual(1);
    expect(wool.length).toBeLessThanOrEqual(3);
    server.tick();
    expect(a.received.some((m) => m.t === 'mobData' && m.id === sheep.id && (m.flags & MOB_FLAG.SHEARED) !== 0)).toBe(true);
    sheep.ate();
    expect(sheep.sheared).toBe(false);
    // milking
    p.inventory.set(0, { id: ITEMS_BY_NAME.get('bucket')!.id, count: 1, damage: 0 });
    const cow = server.mobs.spawn('cow', 0.5, 64, 2.5) as Cow;
    cow.ageTicks = 0;
    a.send({ t: 'interact', target: cow.id, hand: 0 });
    expect(itemName(p.inventory.get(0)!.id)).toBe('milk_bucket');
    // eggs
    const ch = server.mobs.spawn('chicken', -2.5, 64, 0.5) as Chicken;
    ch.ageTicks = 0;
    ch.eggTime = 1;
    server.tick();
    expect([...server.entities.values()].some((e) => e instanceof ItemEntity && itemName(e.stack.id) === 'egg')).toBe(true);
    expect(ch.eggTime).toBeGreaterThanOrEqual(6000);
    expect(ch.eggTime).toBeLessThan(12000);
  });

  it('mobs are sent to clients with addEntity + mobData, and move with entityMove', () => {
    const { server, a } = setup();
    const z = server.mobs.spawn('zombie', 4.5, 64, 4.5)!;
    server.tick();
    const add = a.received.find((m) => m.t === 'addEntity' && m.id === z.id);
    expect(add).toMatchObject({ type: 'zombie' });
    expect(a.received.some((m) => m.t === 'mobData' && m.id === z.id)).toBe(true);
    z.x += 1;
    server.tick();
    expect(a.received.some((m) => m.t === 'entityMove' && m.id === z.id)).toBe(true);
  });

  it('despawning: monsters beyond 128 blocks vanish at once, animals never; peaceful removes monsters', () => {
    const { server, a } = setup();
    const far = server.mobs.spawn('zombie', 140.5, 64, 0.5)!;
    const cow = server.mobs.spawn('cow', 140.5, 64, 4.5)!;
    const near = server.mobs.spawn('skeleton', 5.5, 64, 5.5)!;
    server.tick();
    expect(far.removed).toBe(true);
    expect(cow.removed).toBe(false);
    expect(near.removed).toBe(false);
    a.send({ t: 'chat', message: '/difficulty peaceful' });
    server.tick();
    expect(near.removed).toBe(true);
  });

  it('natural spawning: animals at chunk generation, monsters in the dark ≥ 24 blocks away at night, within the cap', () => {
    const { server, p } = setup({ spawnMobs: true, dayTime: 18000 });
    const animals = server.mobs.mobs().filter((m) => m.category === 'creature');
    expect(animals.length).toBeGreaterThan(0);
    for (const m of animals) expect(m.world.getState(Math.floor(m.x), Math.floor(m.y) - 1, Math.floor(m.z))).toBe(GRASS);
    ticks(server, 100);
    const monsters = server.mobs.mobs().filter((m) => m.category === 'monster');
    expect(monsters.length).toBeGreaterThan(0);
    // the cap (70 × 289 / 289) may be overshot by at most one chunk's packs
    expect(monsters.length).toBeLessThanOrEqual(70 + 12);
    void p;
    // by day, the surface is too bright: no new monsters
    const n = setup({ spawnMobs: true, dayTime: 6000 });
    ticks(n.server, 200);
    expect(n.server.mobs.mobs().filter((m) => m.category === 'monster').length).toBe(0);
  });

  it('isDarkEnoughToSpawn: block light ≤ random(8) after the sky check (1.17.1 rule)', () => {
    const { server } = setup({ dayTime: 18000 });
    const r = new JavaRandom(5n);
    // deep underground (no sky light, no block light): always dark enough
    let ok = 0;
    for (let i = 0; i < 100; i++) if (server.mobs.isDarkEnoughToSpawn(0, 30, 0, r)) ok++;
    expect(ok).toBe(100);
    const m = server.mobs.spawn('zombie', 0.5, 64, 3.5) as Mob;
    expect(m.walkTargetValue(0, 30, 0)).toBeCloseTo(0.5, 6);
  });

  it('zombies convert to drowned after 30 s underwater plus 15 s; undead do not drown', () => {
    const { server } = setup();
    for (let x = 8; x <= 10; x++) for (let z = 8; z <= 10; z++) for (let y = 60; y <= 66; y++) server.world.setStateRaw(x, y, z, stateOf('water'));
    const z = server.mobs.spawn('zombie', 9.5, 61, 9.5) as Zombie;
    z.baby = false;
    let drowned: Mob | undefined;
    for (let i = 0; i < 1000 && !drowned; i++) {
      server.tick();
      drowned = server.mobs.mobs().find((m) => m.type === 'drowned');
    }
    expect(z.removed).toBe(true);
    expect(drowned).toBeDefined();
    expect(z.health).toBe(20);
  });

  it('slimes: sizes 1/2/4 with size² health, split on death into 2–4 smaller slimes; slime chunks', () => {
    const { server, a } = setup();
    const s = server.mobs.spawn('slime', 5.5, 64, 5.5) as Slime;
    s.setSize(4);
    expect(s.health).toBe(16);
    expect(s.width).toBeCloseTo(2.04, 4);
    expect(s.attackDamage).toBe(4);
    give(a, 'diamond_sword');
    s.health = 1;
    s.hurt({ id: 'generic', bypassArmor: true }, 5);
    ticks(server, 21);
    const kids = server.mobs.mobs().filter((m) => m instanceof Slime && m !== s) as Slime[];
    expect(kids.length).toBeGreaterThanOrEqual(2);
    expect(kids.length).toBeLessThanOrEqual(4);
    expect(kids.every((k) => k.size === 2 && k.health === 4)).toBe(true);
    let n = 0;
    for (let x = 0; x < 100; x++) for (let z = 0; z < 100; z++) if (isSlimeChunk(12345n, x, z)) n++;
    expect(n / 10000).toBeGreaterThan(0.07);
    expect(n / 10000).toBeLessThan(0.13);
  });

  it('endermen: provoked by being looked at, immune to arrows (teleport), hurt by water', () => {
    const { server, a, p } = setup({ dayTime: 18000 });
    const e = server.mobs.spawn('enderman', 0.5, 64, 6.5) as Enderman;
    e.yaw = 180;
    // look straight at its eyes: yaw 0 faces +Z
    const eye = e.y + e.eyeHeight, dy = eye - (p.y + 1.62);
    a.send({ t: 'move', x: p.x, y: p.y, z: p.z, yaw: 0, pitch: -(Math.atan2(dy, 6) * 180) / Math.PI, onGround: true });
    for (let i = 0; i < 40 && !e.target; i++) server.tick();
    expect(e.target).toBe(p);
    expect(e.mobFlags() & MOB_FLAG.AGGRESSIVE).toBeTruthy();
    const hp = e.health;
    expect(e.hurt({ id: 'arrow', projectile: true }, 5)).toBe(false);
    expect(e.health).toBe(hp);
    const e2 = server.mobs.spawn('enderman', 20.5, 64, 20.5) as Enderman;
    server.world.setStateRaw(20, 64, 20, stateOf('water'));
    server.tick();
    expect(e2.health).toBeLessThan(40);
  });

  it('bats hang under ceilings and fly off when a player comes near; squid swim and suffocate on land', () => {
    const { server, a } = setup();
    for (let x = 9; x <= 11; x++) for (let z = 9; z <= 11; z++) server.world.setStateRaw(x, 66, z, STONE);
    const bat = server.mobs.spawn('bat', 10.5, 65.1, 10.5) as Bat;
    server.tick();
    expect(bat.resting).toBe(true);
    a.send({ t: 'chat', message: '/tp 10.5 64 12.5' });
    server.tick();
    expect(bat.resting).toBe(false);
    const sq = server.mobs.spawn('squid', 20.5, 64, 20.5) as Squid;
    ticks(server, 300);
    expect(sq.health).toBe(10);
    ticks(server, 25);
    expect(sq.health).toBeLessThan(10);
  });
});
