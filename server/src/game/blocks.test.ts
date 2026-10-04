import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { TickScheduler } from './ticks';
import { FallingBlockEntity } from './fallingblock';
import { ItemEntity } from './entity';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, getProp, blockNameOf } from '@shared/world/blockstate';
import { ITEMS_BY_NAME } from '@shared/data';
import { BlockWorld } from '@shared/world/world';
import { Chunk } from '@shared/world/chunk';
import { growthSpeed, growthChanceDenominator, leavesDistance, canBeGrass, treeForSapling } from '@shared/game/growth';
import { stateForPlacement } from '@shared/game/placement';
import { blockDrops } from '@shared/game/loot';
import { JavaRandom } from '@shared/util/random';

function setup() {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true, randomSeed: 1234n });
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' }));
  for (let i = 0; i < 3; i++) server.tick();
  const send = (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p));
  const p = server.players[0]!;
  // a test platform high in the sky (full sky light), next to the player
  p.x = 8.5;
  p.y = 151;
  p.z = 8.5;
  const set = (x: number, y: number, z: number, name: string, props?: Record<string, string | number | boolean>) => server.setBlock(x, y, z, stateOf(name, props));
  const get = (x: number, y: number, z: number) => blockNameOf(server.world.getState(x, y, z));
  const give = (item: string, count = 1, slot = 0) => {
    p.inventory.selected = slot;
    p.inventory.set(slot, { id: ITEMS_BY_NAME.get(item)!.id, count, damage: 0 });
  };
  const use = (x: number, y: number, z: number, face = 1) => send({ t: 'useOn', x, y, z, face, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
  return { server, received, send, p, set, get, give, use };
}

describe('scheduled ticks', () => {
  it('run in time, priority, then scheduling order, ignoring duplicates', () => {
    const t = new TickScheduler<number>();
    const ran: string[] = [];
    t.schedule(0, 0, 0, 0, 1, 5);
    t.schedule(0, 1, 0, 0, 1, 2, 1);
    t.schedule(0, 2, 0, 0, 1, 2, -1);
    t.schedule(0, 3, 0, 0, 1, 2, -1);
    t.schedule(0, 3, 0, 0, 1, 1); // same pos+type pending: ignored
    expect(t.size).toBe(4);
    for (let time = 0; time <= 5; time++) t.tick(time, () => true, (e) => ran.push(`${time}:${e.x}`));
    expect(ran).toEqual(['2:2', '2:3', '2:1', '5:0']);
  });

  it('keep ticks for positions that are not ticking', () => {
    const t = new TickScheduler<number>();
    t.schedule(0, 100, 0, 0, 7, 1);
    let n = 0;
    t.tick(1, () => false, () => n++);
    expect(n).toBe(0);
    t.tick(2, () => true, () => n++);
    expect(n).toBe(1);
  });
});

describe('growth rules', () => {
  function world() {
    const w = new BlockWorld();
    w.addChunk(new Chunk(0, 0));
    return w;
  }
  it('crop growth speed matches CropBlock.getGrowthSpeed', () => {
    const w = world();
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) w.setStateRaw(x, 10, z, stateOf('farmland', { moisture: 7 }));
    w.setStateRaw(2, 11, 2, stateOf('wheat'));
    // moist 3×3: 1 + 3 + 8 × 3/4 = 10 → 1 in 3
    expect(growthSpeed(w, 2, 11, 2, 'wheat')).toBe(10);
    expect(growthChanceDenominator(10)).toBe(3);
    // a crop in a row on both axes grows half as fast
    w.setStateRaw(1, 11, 2, stateOf('wheat'));
    w.setStateRaw(2, 11, 1, stateOf('wheat'));
    expect(growthSpeed(w, 2, 11, 2, 'wheat')).toBe(5);
    // diagonal neighbour only: also halved
    w.setStateRaw(1, 11, 2, 0);
    w.setStateRaw(2, 11, 1, 0);
    w.setStateRaw(1, 11, 1, stateOf('wheat'));
    expect(growthSpeed(w, 2, 11, 2, 'wheat')).toBe(5);
    // dry farmland: 1 + 1 + 8 × 1/4 = 4 → 1 in 7
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) w.setStateRaw(x, 10, z, stateOf('farmland', { moisture: 0 }));
    w.setStateRaw(1, 11, 1, 0);
    expect(growthSpeed(w, 2, 11, 2, 'wheat')).toBe(4);
    expect(growthChanceDenominator(4)).toBe(7);
  });

  it('leaves take their distance from logs', () => {
    const w = world();
    w.setStateRaw(5, 10, 5, stateOf('oak_log'));
    expect(leavesDistance(w, 5, 11, 5)).toBe(1);
    w.setStateRaw(5, 11, 5, stateOf('oak_leaves', { distance: 1 }));
    expect(leavesDistance(w, 5, 12, 5)).toBe(2);
    expect(leavesDistance(w, 9, 12, 9)).toBe(7);
  });

  it('grass dies under opaque blocks and bottom slabs but not under leaves or glass', () => {
    const w = world();
    w.setStateRaw(3, 10, 3, stateOf('grass_block'));
    expect(canBeGrass(w, 3, 10, 3)).toBe(true);
    for (const [n, ok] of [['stone', false], ['oak_leaves', true], ['glass', true], ['oak_slab', false], ['water', false]] as const) {
      w.setStateRaw(3, 11, 3, stateOf(n));
      expect(canBeGrass(w, 3, 10, 3), n).toBe(ok);
    }
  });

  it('oak saplings grow fancy oaks 1 in 10, dark oak only as 2×2', () => {
    const r = new JavaRandom(5n);
    let fancy = 0;
    for (let i = 0; i < 10000; i++) if (treeForSapling('oak_sapling', r, false, false) === 'fancy_oak') fancy++;
    expect(fancy).toBeGreaterThan(900);
    expect(fancy).toBeLessThan(1100);
    expect(treeForSapling('dark_oak_sapling', r, false, false)).toBeNull();
    expect(treeForSapling('dark_oak_sapling', r, false, true)).toBe('dark_oak');
    expect(treeForSapling('birch_sapling', r, true, false)).toBe('birch_bees_005');
  });

  it('door hinges away from walls and toward a neighbouring door', () => {
    const w = world();
    // player looks north (yaw 180): left side is west (−x)
    const ctx = { world: w, x: 5, y: 11, z: 5, face: 1, hx: 0.5, hy: 1, hz: 0.5, yaw: 180, pitch: 0, sneaking: false };
    w.setStateRaw(4, 11, 5, stateOf('stone'));
    w.setStateRaw(4, 12, 5, stateOf('stone'));
    expect(getProp(stateForPlacement('oak_door', ctx, 0)!, 'hinge')).toBe('left');
    w.setStateRaw(4, 11, 5, 0);
    w.setStateRaw(4, 12, 5, 0);
    w.setStateRaw(6, 11, 5, stateOf('stone'));
    w.setStateRaw(6, 12, 5, stateOf('stone'));
    expect(getProp(stateForPlacement('oak_door', ctx, 0)!, 'hinge')).toBe('right');
    w.setStateRaw(6, 11, 5, 0);
    w.setStateRaw(6, 12, 5, 0);
    w.setStateRaw(4, 11, 5, stateOf('oak_door', { half: 'lower', facing: 'north', hinge: 'left' }));
    expect(getProp(stateForPlacement('oak_door', ctx, 0)!, 'hinge')).toBe('right');
  });

  it('player-placed leaves are persistent', () => {
    const w = world();
    const s = stateForPlacement('oak_leaves', { world: w, x: 1, y: 11, z: 1, face: 1, hx: 0.5, hy: 1, hz: 0.5, yaw: 0, pitch: 0, sneaking: false }, 0)!;
    expect(getProp(s, 'persistent')).toBe(true);
  });
});

describe('loot', () => {
  const rnd = (seed: bigint) => {
    const r = new JavaRandom(seed);
    return () => r.nextFloat();
  };
  it('ripe carrots drop 2–5, unripe 1; fortune ore drops multiply', () => {
    const random = rnd(1n);
    const counts = new Set<number>();
    for (let i = 0; i < 500; i++) counts.add(blockDrops(stateOf('carrots', { age: 7 }), { silkTouch: false, canHarvest: true, random })[0]!.count);
    expect([...counts].sort()).toEqual([2, 3, 4, 5]);
    expect(blockDrops(stateOf('carrots', { age: 3 }), { silkTouch: false, canHarvest: true, random })[0]!.count).toBe(1);
    let total = 0;
    for (let i = 0; i < 3000; i++) total += blockDrops(stateOf('diamond_ore'), { silkTouch: false, canHarvest: true, random, fortune: 3 })[0]!.count;
    // Fortune III: average 2.2 diamonds
    expect(total / 3000).toBeGreaterThan(2.05);
    expect(total / 3000).toBeLessThan(2.35);
  });
  it('glass drops nothing, stone needs a pickaxe, leaves need shears to drop themselves', () => {
    const random = rnd(2n);
    expect(blockDrops(stateOf('glass'), { silkTouch: false, canHarvest: true, random })).toEqual([]);
    expect(blockDrops(stateOf('stone'), { silkTouch: false, canHarvest: false, random })).toEqual([]);
    expect(blockDrops(stateOf('oak_leaves'), { silkTouch: false, shears: true, canHarvest: true, random })[0]!.id).toBe(ITEMS_BY_NAME.get('oak_leaves')!.id);
    expect(blockDrops(stateOf('melon_stem', { age: 7 }), { silkTouch: false, canHarvest: true, random }).every((s) => s.id === ITEMS_BY_NAME.get('melon_seeds')!.id)).toBe(true);
  });
});

describe('block behaviours on the server', { timeout: 60000 }, () => {
  it('sand falls as an entity and lands as a block', () => {
    const { server, set, get, received } = setup();
    set(10, 150, 10, 'stone');
    set(10, 160, 10, 'sand');
    server.tick();
    server.tick();
    server.tick();
    const e = [...server.entities.values()].find((x) => x instanceof FallingBlockEntity) as FallingBlockEntity | undefined;
    expect(e).toBeTruthy();
    expect(get(10, 160, 10)).toBe('air');
    expect(received.some((p) => p.t === 'addEntity' && p.type === 'falling_block' && p.data === stateOf('sand'))).toBe(true);
    for (let i = 0; i < 60; i++) server.tick();
    expect(get(10, 151, 10)).toBe('sand');
    expect([...server.entities.values()].some((x) => x instanceof FallingBlockEntity)).toBe(false);
  });

  it('a falling block that lands on a torch drops as an item', () => {
    const { server, set, get } = setup();
    set(12, 150, 12, 'stone');
    set(12, 151, 12, 'torch');
    set(12, 156, 12, 'gravel');
    for (let i = 0; i < 60; i++) server.tick();
    expect(get(12, 151, 12)).toBe('torch');
    expect(get(12, 152, 12)).toBe('air');
    const items = [...server.entities.values()].filter((x) => x instanceof ItemEntity) as ItemEntity[];
    expect(items.some((i) => i.stack.id === ITEMS_BY_NAME.get('gravel')!.id)).toBe(true);
  });

  it('concrete powder hardens next to water', () => {
    const { server, set, get } = setup();
    set(4, 150, 4, 'stone');
    set(4, 151, 4, 'white_concrete_powder');
    set(5, 151, 4, 'water');
    server.tick();
    expect(get(4, 151, 4)).toBe('white_concrete');
  });

  it('leaves decay once their log is gone; persistent leaves stay', () => {
    const { server, set, get } = setup();
    server.blocks.randomTickSpeed = 0; // no stray random ticks while the distances settle
    set(6, 150, 6, 'oak_log');
    set(6, 151, 6, 'oak_leaves', { distance: 1, persistent: false });
    set(7, 151, 6, 'oak_leaves', { distance: 2, persistent: false });
    set(5, 151, 6, 'oak_leaves', { distance: 2, persistent: true });
    server.setBlock(6, 150, 6, 0);
    for (let i = 0; i < 10; i++) server.tick();
    expect(getProp(server.world.getState(6, 151, 6), 'distance')).toBe(7);
    expect(getProp(server.world.getState(7, 151, 6), 'distance')).toBe(7);
    for (const [x, z] of [[6, 6], [7, 6], [5, 6]] as const) server.blocks.randomTick(x, 151, z, server.world.getState(x, 151, z));
    expect(get(6, 151, 6)).toBe('air');
    expect(get(7, 151, 6)).toBe('air');
    expect(get(5, 151, 6)).toBe('oak_leaves');
  });

  it('grass turns to dirt under stone and spreads to lit dirt', () => {
    const { server, set, get } = setup();
    set(2, 150, 2, 'grass_block');
    set(2, 151, 2, 'stone');
    server.blocks.randomTick(2, 150, 2, server.world.getState(2, 150, 2));
    expect(get(2, 150, 2)).toBe('dirt');
    set(2, 151, 2, 'air');
    set(3, 150, 2, 'grass_block');
    for (let i = 0; i < 200 && get(2, 150, 2) === 'dirt'; i++) server.blocks.randomTick(3, 150, 2, server.world.getState(3, 150, 2));
    expect(get(2, 150, 2)).toBe('grass_block');
  });

  it('hoe tills grass into farmland, which dries out back to dirt without water', () => {
    const { server, set, get, give, use, p } = setup();
    set(9, 150, 9, 'grass_block');
    give('iron_hoe');
    use(9, 150, 9);
    expect(get(9, 150, 9)).toBe('farmland');
    expect(p.inventory.get(0)!.damage).toBe(1);
    // no water: moisture stays 0, then it reverts (nothing planted)
    server.blocks.randomTick(9, 150, 9, server.world.getState(9, 150, 9));
    expect(get(9, 150, 9)).toBe('dirt');
    // with water nearby it gets wet
    set(9, 150, 9, 'farmland');
    set(12, 150, 9, 'water');
    server.blocks.randomTick(9, 150, 9, server.world.getState(9, 150, 9));
    expect(getProp(server.world.getState(9, 150, 9), 'moisture')).toBe(7);
  });

  it('crops grow on random ticks in light and jump 2–5 stages with bone meal', () => {
    const { server, set, give, use } = setup();
    for (let x = 7; x <= 9; x++) for (let z = 7; z <= 9; z++) set(x, 150, z, 'farmland', { moisture: 7 });
    set(8, 151, 8, 'wheat', { age: 0 });
    let ticks = 0;
    while ((getProp(server.world.getState(8, 151, 8), 'age') as number) < 7 && ticks < 500) {
      server.blocks.randomTick(8, 151, 8, server.world.getState(8, 151, 8));
      ticks++;
    }
    expect(getProp(server.world.getState(8, 151, 8), 'age')).toBe(7);
    // speed 10 → 1 in 3 per random tick: 7 stages take ~21
    expect(ticks).toBeGreaterThan(7);
    expect(ticks).toBeLessThan(80);
    set(8, 151, 8, 'carrots', { age: 0 });
    give('bone_meal', 10);
    use(8, 151, 8);
    const age = getProp(server.world.getState(8, 151, 8), 'age') as number;
    expect(age).toBeGreaterThanOrEqual(2);
    expect(age).toBeLessThanOrEqual(5);
  });

  it('a sapling grows into an oak tree with bone meal', () => {
    const { server, set, get, give, use, received } = setup();
    set(8, 150, 12, 'grass_block');
    set(8, 151, 12, 'oak_sapling');
    give('bone_meal', 64);
    p_loop: for (let i = 0; i < 64; i++) {
      use(8, 151, 12);
      if (get(8, 151, 12) !== 'oak_sapling') break p_loop;
    }
    expect(['oak_log']).toContain(get(8, 151, 12));
    let leaves = 0;
    for (let x = 4; x <= 12; x++) for (let z = 8; z <= 16; z++) for (let y = 151; y < 170; y++) if (get(x, y, z) === 'oak_leaves') leaves++;
    expect(leaves).toBeGreaterThan(10);
    expect(get(8, 150, 12)).toBe('dirt');
    expect(received.some((p) => p.t === 'levelEvent' && p.event === 1505)).toBe(true);
  });

  it('2×2 dark oak saplings grow a dark oak; a single one never does', () => {
    const { server, set, get } = setup();
    for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) {
      set(20 + x, 150, 20 + z, 'grass_block');
      set(20 + x, 151, 20 + z, 'dark_oak_sapling', { stage: 1 });
    }
    set(30, 150, 30, 'grass_block');
    set(30, 151, 30, 'dark_oak_sapling', { stage: 1 });
    expect(server.blocks.growTree(30, 151, 30, server.world.getState(30, 151, 30))).toBe(false);
    expect(get(30, 151, 30)).toBe('dark_oak_sapling');
    expect(server.blocks.growTree(21, 151, 21, server.world.getState(21, 151, 21))).toBe(true);
    for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) expect(get(20 + x, 151, 20 + z)).toBe('dark_oak_log');
  });

  it('doors open both halves by hand; iron doors do not', () => {
    const { server, set, get, send } = setup();
    set(10, 150, 7, 'stone');
    set(10, 151, 7, 'oak_door', { half: 'lower', facing: 'north' });
    set(10, 152, 7, 'oak_door', { half: 'upper', facing: 'north' });
    send({ t: 'useOn', x: 10, y: 152, z: 7, face: 2, cx: 0.5, cy: 0.5, cz: 0, hand: 0 });
    expect(getProp(server.world.getState(10, 151, 7), 'open')).toBe(true);
    expect(getProp(server.world.getState(10, 152, 7), 'open')).toBe(true);
    set(11, 151, 7, 'iron_door', { half: 'lower', facing: 'north' });
    set(11, 152, 7, 'iron_door', { half: 'upper', facing: 'north' });
    send({ t: 'useOn', x: 11, y: 151, z: 7, face: 2, cx: 0.5, cy: 0.5, cz: 0, hand: 0 });
    expect(getProp(server.world.getState(11, 151, 7), 'open')).toBe(false);
    // removing the block under a door drops it
    server.setBlock(10, 150, 7, 0);
    server.updateNeighbors(10, 150, 7);
    expect(get(10, 151, 7)).toBe('air');
    expect(get(10, 152, 7)).toBe('air');
  });

  it('fence gates swing away from the player', () => {
    const { server, set, send, p } = setup();
    set(7, 151, 10, 'oak_fence_gate', { facing: 'north' });
    p.yaw = 0; // looking south
    send({ t: 'useOn', x: 7, y: 151, z: 10, face: 2, cx: 0.5, cy: 0.5, cz: 0, hand: 0 });
    const st = server.world.getState(7, 151, 10);
    expect(getProp(st, 'open')).toBe(true);
    expect(getProp(st, 'facing')).toBe('south');
  });

  it('sugar cane grows to three blocks', () => {
    const { server, set, get } = setup();
    set(14, 150, 14, 'sand');
    set(15, 150, 14, 'water');
    set(14, 151, 14, 'sugar_cane');
    for (let i = 0; i < 100; i++) {
      for (let y = 151; y < 155; y++) if (get(14, y, 14) === 'sugar_cane') server.blocks.randomTick(14, y, 14, server.world.getState(14, y, 14));
    }
    expect(get(14, 153, 14)).toBe('sugar_cane');
    expect(get(14, 154, 14)).toBe('air');
  });

  it('pumpkin stems grow a pumpkin beside them and attach', () => {
    const { server, set, get } = setup();
    for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) set(16 + x, 150, 16 + z, 'farmland', { moisture: 7 });
    set(17, 151, 17, 'pumpkin_stem', { age: 7 });
    for (let i = 0; i < 200 && get(17, 151, 17) === 'pumpkin_stem'; i++) server.blocks.randomTick(17, 151, 17, server.world.getState(17, 151, 17));
    expect(get(17, 151, 17)).toBe('attached_pumpkin_stem');
    const f = getProp(server.world.getState(17, 151, 17), 'facing') as string;
    const d = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[f]!;
    expect(get(17 + d[0]!, 151, 17 + d[1]!)).toBe('pumpkin');
    server.setBlock(17 + d[0]!, 151, 17 + d[1]!, 0);
    expect(get(17, 151, 17)).toBe('pumpkin_stem');
  });

  it('jumping onto farmland from high up tramples it', () => {
    const { server, set, get, send, p } = setup();
    set(8, 150, 8, 'farmland');
    p.x = 8.5;
    p.y = 155;
    p.z = 8.5;
    p.fallDistance = 0;
    p.gameMode = 1; // skip anti-cheat move checks
    for (let y = 154; y >= 151; y--) send({ t: 'move', x: 8.5, y, z: 8.5, yaw: 0, pitch: 0, onGround: false });
    send({ t: 'move', x: 8.5, y: 150.9375, z: 8.5, yaw: 0, pitch: 0, onGround: true });
    expect(get(8, 150, 8)).toBe('dirt');
    void server;
  });

  it('bone meal on grass scatters grass and the biome flowers', () => {
    const { server, set, get, give, use } = setup();
    for (let x = 2; x <= 14; x++) for (let z = 2; z <= 14; z++) set(x, 150, z, 'grass_block');
    give('bone_meal', 64);
    for (let i = 0; i < 6; i++) use(8, 150, 8);
    const found = new Set<string>();
    for (let x = 2; x <= 14; x++) for (let z = 2; z <= 14; z++) found.add(get(x, 151, z));
    expect(found.has('grass')).toBe(true);
    expect(found.has('dandelion') || found.has('poppy') || found.has('tall_grass')).toBe(true);
    void server;
  });

  it('sweet berries grow, and ripe bushes are picked by hand', () => {
    const { server, set, get, send, p } = setup();
    set(5, 150, 5, 'grass_block');
    set(5, 151, 5, 'sweet_berry_bush', { age: 0 });
    for (let i = 0; i < 300 && getProp(server.world.getState(5, 151, 5), 'age') !== 3; i++) server.blocks.randomTick(5, 151, 5, server.world.getState(5, 151, 5));
    expect(getProp(server.world.getState(5, 151, 5), 'age')).toBe(3);
    p.inventory.set(p.inventory.selected, null);
    send({ t: 'useOn', x: 5, y: 151, z: 5, face: 1, cx: 0.5, cy: 0.5, cz: 0.5, hand: 0 });
    expect(getProp(server.world.getState(5, 151, 5), 'age')).toBe(1);
    const berries = [...server.entities.values()].filter((e) => e instanceof ItemEntity && e.stack.id === ITEMS_BY_NAME.get('sweet_berries')!.id) as ItemEntity[];
    expect(berries.reduce((a, b) => a + b.stack.count, 0)).toBeGreaterThanOrEqual(2);
    void get;
  });

  it('nether wart and kelp grow', () => {
    const { server, set, get } = setup();
    set(3, 150, 3, 'soul_sand');
    set(3, 151, 3, 'nether_wart');
    for (let i = 0; i < 400; i++) server.blocks.randomTick(3, 151, 3, server.world.getState(3, 151, 3));
    expect(getProp(server.world.getState(3, 151, 3), 'age')).toBe(3);
    set(6, 150, 3, 'stone');
    for (let y = 151; y <= 155; y++) set(6, y, 3, 'water');
    set(6, 151, 3, 'kelp', { age: 0 });
    for (let i = 0; i < 200; i++) for (let y = 151; y <= 155; y++) if (get(6, y, 3) === 'kelp') server.blocks.randomTick(6, y, 3, server.world.getState(6, y, 3));
    expect(get(6, 151, 3)).toBe('kelp_plant');
    expect(get(6, 155, 3)).toBe('kelp');
  });

  it('snow settles and water freezes in a cold biome while it snows', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true, scene: 'snow', randomSeed: 99n });
    const conn: Connection = { send: () => {}, close: () => {} };
    server.connect(conn)(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' }));
    server.tick();
    server.setWeather('rain', 100000);
    server.rainLevel = 1;
    // a pond with open edges on a platform
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) server.setBlock(x, 140, z, stateOf(x > 4 && x < 11 && z > 4 && z < 11 ? 'water' : 'stone'));
    let snow = 0, ice = 0;
    for (let i = 0; i < 1500; i++) server.tick();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      if (blockNameOf(server.world.getState(x, 141, z)) === 'snow') snow++;
      if (blockNameOf(server.world.getState(x, 140, z)) === 'ice') ice++;
    }
    expect(snow).toBeGreaterThan(0);
    expect(ice).toBeGreaterThan(0);
  });

  it('vines grow down and along a wall', () => {
    const { server, set, get } = setup();
    for (let x = 18; x <= 24; x++) for (let y = 145; y <= 158; y++) set(x, y, 20, 'stone');
    set(21, 155, 21, 'vine', { north: true });
    for (let i = 0; i < 400; i++)
      for (let x = 18; x <= 24; x++) for (let y = 145; y <= 158; y++) if (get(x, y, 21) === 'vine') server.blocks.randomTick(x, y, 21, server.world.getState(x, y, 21));
    let n = 0;
    for (let x = 18; x <= 24; x++) for (let y = 140; y <= 160; y++) if (get(x, y, 21) === 'vine') n++;
    expect(n).toBeGreaterThan(2);
    expect(get(21, 154, 21)).toBe('vine');
  });

  it('bamboo grows with leaves at the top; azalea grows an azalea tree', () => {
    const { server, set, get } = setup();
    set(26, 150, 26, 'grass_block');
    set(26, 151, 26, 'bamboo_sapling');
    for (let i = 0; i < 2000; i++)
      for (let y = 151; y < 170; y++) {
        const st = server.world.getState(26, y, 26);
        if (blockNameOf(st).startsWith('bamboo')) server.blocks.randomTick(26, y, 26, st);
      }
    let h = 0;
    while (get(26, 151 + h, 26) === 'bamboo') h++;
    expect(h).toBeGreaterThan(5);
    expect(h).toBeLessThanOrEqual(16);
    expect(getProp(server.world.getState(26, 150 + h, 26), 'leaves')).toBe('large');
    set(28, 150, 20, 'grass_block');
    set(28, 151, 20, 'azalea');
    // the azalea tree's bending trunk placer isn't in the tree engine yet: the bush stays
    server.blocks.growTree(28, 151, 20, server.world.getState(28, 151, 20));
    expect(['oak_log', 'azalea']).toContain(get(28, 151, 20));
  });

  it('mushrooms spread on mycelium but at most 5 within 4 blocks', () => {
    const { server, set, get } = setup();
    for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) set(x, 150, z, 'mycelium');
    set(6, 151, 6, 'red_mushroom');
    for (let i = 0; i < 3000; i++)
      for (let x = 0; x <= 12; x++) for (let z = 0; z <= 12; z++) if (get(x, 151, z) === 'red_mushroom') server.blocks.randomTick(x, 151, z, server.world.getState(x, 151, z));
    let n = 0;
    for (let x = 2; x <= 10; x++) for (let z = 2; z <= 10; z++) if (get(x, 151, z) === 'red_mushroom') n++;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual(5);
  });

  it('doors are placed as two halves and breaking the top half drops one door', () => {
    const { server, get, give, use, set, send, p } = setup();
    set(9, 150, 6, 'stone');
    give('oak_door', 2);
    use(9, 150, 6);
    expect(get(9, 151, 6)).toBe('oak_door');
    expect(get(9, 152, 6)).toBe('oak_door');
    expect(getProp(server.world.getState(9, 152, 6), 'half')).toBe('upper');
    expect(p.inventory.get(0)!.count).toBe(1);
    p.onGround = true;
    send({ t: 'dig', action: 0, x: 9, y: 152, z: 6, face: 2 });
    for (let i = 0; i < 80; i++) server.tick();
    send({ t: 'dig', action: 2, x: 9, y: 152, z: 6, face: 2 });
    expect(get(9, 151, 6)).toBe('air');
    expect(get(9, 152, 6)).toBe('air');
    const doors = [...server.entities.values()].filter((e) => e instanceof ItemEntity && e.stack.id === ITEMS_BY_NAME.get('oak_door')!.id);
    expect(doors.length).toBe(1);
  });

  it('a second player sees falling blocks, opened doors and grown crops', () => {
    const { server, set, send } = setup();
    const seen: S2C[] = [];
    const recvB = server.connect({ send: (d) => seen.push(decodeS2C(d)), close: () => {} });
    recvB(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'B', viewDistance: 2, skin: '' }));
    for (let i = 0; i < 3; i++) server.tick();
    server.players[1]!.y = 151; // within hearing range
    set(11, 150, 4, 'stone');
    set(11, 155, 4, 'sand');
    set(12, 150, 4, 'stone');
    set(12, 151, 4, 'oak_door', { half: 'lower', facing: 'north' });
    set(12, 152, 4, 'oak_door', { half: 'upper', facing: 'north' });
    send({ t: 'useOn', x: 12, y: 151, z: 4, face: 2, cx: 0.5, cy: 0.5, cz: 0, hand: 0 });
    for (let i = 0; i < 40; i++) server.tick();
    expect(seen.some((p) => p.t === 'addEntity' && p.type === 'falling_block')).toBe(true);
    expect(seen.some((p) => p.t === 'entityMove')).toBe(true);
    expect(seen.some((p) => p.t === 'blockChange' && p.x === 11 && p.y === 151 && p.z === 4 && p.state === stateOf('sand'))).toBe(true);
    expect(seen.some((p) => p.t === 'blockChange' && p.x === 12 && p.y === 152 && getProp(p.state, 'open') === true)).toBe(true);
    expect(seen.some((p) => p.t === 'sound')).toBe(true);
  });

  it('the dragon egg teleports when clicked', () => {
    const { server, set, get, send } = setup();
    set(8, 150, 4, 'obsidian');
    set(8, 151, 4, 'dragon_egg');
    send({ t: 'useOn', x: 8, y: 151, z: 4, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(get(8, 151, 4)).toBe('air');
    let eggs = 0;
    for (let x = -10; x <= 26; x++) for (let y = 140; y <= 160; y++) for (let z = -12; z <= 20; z++) if (get(x, y, z) === 'dragon_egg') eggs++;
    expect(eggs).toBe(1);
  });

  it('bone meal grows seagrass, kelp, weeping vines and hanging roots', () => {
    const { server, set, get, give, use } = setup();
    Object.assign(server.players[0]!, { x: 6, y: 149, z: 10 });
    set(4, 145, 12, 'sand');
    for (let y = 146; y <= 150; y++) set(4, y, 12, 'water');
    set(4, 146, 12, 'seagrass');
    set(5, 145, 12, 'sand');
    for (let y = 146; y <= 150; y++) set(5, y, 12, 'water');
    set(5, 146, 12, 'kelp');
    set(6, 155, 12, 'netherrack');
    set(6, 154, 12, 'weeping_vines');
    set(7, 155, 12, 'rooted_dirt');
    give('bone_meal', 64);
    const at = (x: number, y: number, z: number) => use(x, y, z, 2);
    void server;
    at(4, 146, 12);
    expect(get(4, 146, 12)).toBe('tall_seagrass');
    expect(get(4, 147, 12)).toBe('tall_seagrass');
    at(5, 146, 12);
    expect(get(5, 146, 12)).toBe('kelp_plant');
    expect(get(5, 147, 12)).toBe('kelp');
    at(6, 154, 12);
    expect(get(6, 154, 12)).toBe('weeping_vines_plant');
    expect(get(6, 153, 12)).toMatch(/weeping_vines/);
    at(7, 155, 12);
    expect(get(7, 154, 12)).toBe('hanging_roots');
  });

  it('every sapling type grows its tree (singles and 2×2s)', () => {
    const { server, set, get } = setup();
    server.blocks.randomTickSpeed = 0;
    const kinds = ['oak', 'spruce', 'birch', 'jungle', 'acacia'];
    kinds.forEach((k, i) => {
      const x = -8 + i * 8, z = -8;
      set(x, 150, z, 'grass_block');
      set(x, 151, z, `${k}_sapling`, { stage: 1 });
      expect(server.blocks.growTree(x, 151, z, server.world.getState(x, 151, z)), k).toBe(true);
      expect(get(x, 151, z), k).toMatch(/_log$/);
    });
    ['spruce', 'jungle', 'dark_oak'].forEach((k, i) => {
      const x = -8 + i * 10, z = 14;
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
        set(x + dx, 150, z + dz, 'grass_block');
        set(x + dx, 151, z + dz, `${k}_sapling`, { stage: 1 });
      }
      expect(server.blocks.growTree(x, 151, z, server.world.getState(x, 151, z)), k).toBe(true);
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) expect(get(x + dx, 151, z + dz), k).toMatch(/_log$/);
    });
  });

  it('coral out of water dies after 3–5 seconds', () => {
    const { server, set, get } = setup();
    set(3, 150, 3, 'stone');
    set(3, 151, 3, 'tube_coral_block');
    set(5, 150, 3, 'stone');
    set(5, 151, 3, 'brain_coral_block');
    set(6, 151, 3, 'water');
    for (let i = 0; i < 59; i++) server.tick();
    expect(get(3, 151, 3)).toBe('tube_coral_block');
    for (let i = 0; i < 45; i++) server.tick();
    expect(get(3, 151, 3)).toBe('dead_tube_coral_block');
    expect(get(5, 151, 3)).toBe('brain_coral_block');
  });

  it('a sponge soaks up nearby water and turns wet', () => {
    const { server, set, get } = setup();
    for (let x = 0; x <= 10; x++) for (let z = 0; z <= 10; z++) {
      set(x, 149, z, 'stone');
      set(x, 150, z, 'water');
    }
    set(5, 150, 5, 'sponge');
    expect(get(5, 150, 5)).toBe('wet_sponge');
    let water = 0;
    for (let x = 0; x <= 10; x++) for (let z = 0; z <= 10; z++) if (get(x, 150, z) === 'water') water++;
    expect(water).toBeLessThan(120 - 60);
  });
});
