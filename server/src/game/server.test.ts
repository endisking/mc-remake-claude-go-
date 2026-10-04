import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, getProp, blockNameOf } from '@shared/world/blockstate';
import { ITEMS_BY_NAME } from '@shared/data';
import { itemName } from '@shared/item/stack';

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

describe('multiplayer server', () => {
  it('streams chunks to two players and syncs block changes between them', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100 });
    const a = client(server, 'A');
    const b = client(server, 'B');
    for (let i = 0; i < 5; i++) server.tick();
    expect(a.received.find((p) => p.t === 'login')).toBeTruthy();
    expect(a.received.filter((p) => p.t === 'chunk').length).toBe(49); // view distance 2 + 1 ring
    expect(b.received.filter((p) => p.t === 'chunk').length).toBe(49);
    const stone = stateOf('stone');
    a.send({ t: 'setBlock', x: 3, y: 120, z: 3, state: stone });
    const changeAtB = b.received.find((p) => p.t === 'blockChange');
    expect(changeAtB).toMatchObject({ x: 3, y: 120, z: 3, state: stone });
    // light changed below the new block; both get section light updates
    server.tick();
    expect(b.received.some((p) => p.t === 'sectionLight')).toBe(true);
  });

  it('unloads far chunks when a player moves away and stops sending to disconnected players', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100 });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    a.send({ t: 'chat', message: '/tp 500 100 500' });
    for (let i = 0; i < 3; i++) server.tick();
    expect(a.received.filter((p) => p.t === 'unloadChunk').length).toBeGreaterThan(0);
    server.disconnect(a.conn);
    const n = a.received.length;
    for (let i = 0; i < 25; i++) server.tick();
    expect(a.received.length).toBe(n);
  });

  it('rejects moving too quickly and into solid blocks, but accepts normal moves', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100 });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const login = a.received.find((p) => p.t === 'login') as Extract<typeof a.received[number], { t: 'login' }>;
    const p = server.players[0]!;
    // normal walk step
    a.send({ t: 'move', x: login.x + 0.2, y: login.y, z: login.z, yaw: 0, pitch: 0, onGround: true });
    expect(p.x).toBeCloseTo(login.x + 0.2, 6);
    // 20 blocks in one packet: too quick
    a.send({ t: 'move', x: login.x + 20, y: login.y, z: login.z, yaw: 0, pitch: 0, onGround: true });
    expect(p.x).toBeCloseTo(login.x + 0.2, 6);
    expect(a.received.at(-1)?.t).toBe('teleport');
    // into the ground: rejected
    a.send({ t: 'move', x: p.x, y: p.y - 3, z: p.z, yaw: 0, pitch: 0, onGround: true });
    expect(p.rejectedMoves).toBe(2);
  });

  it('shows players to each other and removes them when they leave', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100 });
    const a = client(server, 'A');
    const b = client(server, 'B');
    server.tick();
    expect(a.received.some((p) => p.t === 'addPlayer' && p.name === 'B')).toBe(true);
    b.send({ t: 'playerState', sneaking: true, sprinting: false, flying: false });
    server.tick();
    expect(a.received.some((p) => p.t === 'entityState' && p.pose === 'crouching')).toBe(true);
    server.disconnect(b.conn);
    expect(a.received.at(-1)).toMatchObject({ t: 'removeEntities' });
  });
});

describe('block interaction', () => {
  function setup(gameMode = 0) {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: gameMode, scene: 'models', randomSeed: 42n });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    a.send({ t: 'chat', message: '/tp 31.5 101 7.5' });
    a.send({ t: 'move', x: 31.5, y: 101, z: 7.5, yaw: 0, pitch: 0, onGround: true });
    return { server, a, p };
  }

  it('survival: breaking stone by hand takes 150 ticks and drops nothing; with a pickaxe it drops cobblestone', () => {
    const { server, a, p } = setup(0);
    const stone = stateOf('stone');
    // stone floor below the player at (30,100,7)
    a.send({ t: 'dig', action: 0, x: 30, y: 100, z: 7, face: 1 });
    for (let i = 0; i < 50; i++) server.tick();
    a.send({ t: 'dig', action: 2, x: 30, y: 100, z: 7, face: 1 });
    expect(server.world.getState(30, 100, 7)).toBe(stone); // too early: rejected
    a.send({ t: 'dig', action: 0, x: 30, y: 100, z: 7, face: 1 });
    for (let i = 0; i < 150; i++) server.tick();
    a.send({ t: 'dig', action: 2, x: 30, y: 100, z: 7, face: 1 });
    expect(server.world.getState(30, 100, 7)).toBe(0);
    for (let i = 0; i < 5; i++) server.tick();
    expect([...server.entities.values()].map((e) => itemName((e as never as { stack: { id: number } }).stack.id))).toEqual([]);
    // with a wooden pickaxe (23 ticks), on a stone block standing on the floor beside the player
    server.setBlock(32, 101, 7, stone);
    p.inventory.set(0, { id: ITEMS_BY_NAME.get('wooden_pickaxe')!.id, count: 1, damage: 0 });
    a.send({ t: 'dig', action: 0, x: 32, y: 101, z: 7, face: 4 });
    for (let i = 0; i < 23; i++) server.tick();
    a.send({ t: 'dig', action: 2, x: 32, y: 101, z: 7, face: 4 });
    expect(server.world.getState(32, 101, 7)).toBe(0);
    server.tick();
    const drops = [...server.entities.values()];
    expect(drops.length).toBe(1);
    // the drop is picked up after its 10-tick delay once the player is near it (its random
    // toss can land it just out of reach, so step next to it)
    for (let i = 0; i < 30; i++) server.tick();
    const d = drops[0]!;
    a.send({ t: 'move', x: Math.min(d.x, 32.3), y: 101, z: d.z, yaw: 0, pitch: 0, onGround: true });
    for (let i = 0; i < 10; i++) server.tick();
    expect(p.inventory.slots.some((s) => s?.id === ITEMS_BY_NAME.get('cobblestone')!.id)).toBe(true);
  });

  it('placing blocks uses the held stack, follows placement rules and updates neighbours', () => {
    const { server, a, p } = setup(0);
    p.inventory.set(0, { id: ITEMS_BY_NAME.get('oak_fence')!.id, count: 2, damage: 0 });
    a.send({ t: 'useOn', x: 32, y: 100, z: 6, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    a.send({ t: 'useOn', x: 33, y: 100, z: 6, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(getProp(server.world.getState(32, 101, 6), 'east')).toBe(true);
    expect(getProp(server.world.getState(33, 101, 6), 'west')).toBe(true);
    expect(p.inventory.get(0)).toBeNull();
    // breaking the stone below a torch pops the torch off
    p.inventory.set(1, { id: ITEMS_BY_NAME.get('torch')!.id, count: 1, damage: 0 });
    p.inventory.selected = 1;
    a.send({ t: 'useOn', x: 34, y: 100, z: 6, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(blockNameOf(server.world.getState(34, 101, 6))).toBe('torch');
    server.destroyBlock(34, 100, 6, null, false);
    expect(server.world.getState(34, 101, 6)).toBe(0);
  });

  it('/give fills the inventory (selected slot first) and pick block swaps owned items into the hotbar', () => {
    const { server, a, p } = setup(0);
    const stone = ITEMS_BY_NAME.get('stone')!.id;
    // matching stacks fill from the selected slot first, then empty slots from 0
    p.inventory.selected = 4;
    p.inventory.set(2, { id: stone, count: 60, damage: 0 });
    p.inventory.set(4, { id: stone, count: 60, damage: 0 });
    a.send({ t: 'chat', message: '/give @s stone 70' });
    expect(p.inventory.get(4)!.count).toBe(64);
    expect(p.inventory.get(2)!.count).toBe(64);
    expect(p.inventory.get(0)).toEqual({ id: stone, count: 62, damage: 0 });
    p.inventory.set(2, null);
    // survival pick block of an item that's only in the main inventory: swapped into a free hotbar slot
    p.inventory.set(0, null);
    p.inventory.set(4, null);
    p.inventory.set(1, { id: ITEMS_BY_NAME.get('dirt')!.id, count: 1, damage: 0 });
    p.inventory.set(20, { id: stone, count: 9, damage: 0 });
    p.inventory.selected = 1;
    a.send({ t: 'pickBlock', x: 30, y: 100, z: 7 }); // stone floor
    expect(p.inventory.selected).toBe(2);
    expect(p.inventory.get(2)).toEqual({ id: stone, count: 9, damage: 0 });
    expect(p.inventory.get(20)).toBeNull();
    // survival: not owned → nothing happens
    p.inventory.set(2, null);
    a.send({ t: 'pickBlock', x: 30, y: 100, z: 7 });
    expect(p.inventory.find(stone)).toBe(-1);
    void server;
  });
});

describe('survival', () => {
  function setup() {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: 0, scene: 'models' });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    a.send({ t: 'chat', message: '/tp 31.5 101 7.5' });
    a.send({ t: 'move', x: 31.5, y: 101, z: 7.5, yaw: 0, pitch: 0, onGround: true });
    for (let i = 0; i < 61; i++) server.tick(); // spawn invulnerability
    return { server, a, p };
  }
  // like vanilla, the landing tick's own descent isn't counted: falls here count (height − 0.5)
  const fall = (a: ReturnType<typeof client>, from: number) => {
    for (let y = 101; y <= from; y += 0.5) a.send({ t: 'move', x: 31.5, y, z: 7.5, yaw: 0, pitch: 0, onGround: false });
    for (let y = from; y > 101; y -= 0.5) a.send({ t: 'move', x: 31.5, y, z: 7.5, yaw: 0, pitch: 0, onGround: false });
    a.send({ t: 'move', x: 31.5, y: 101, z: 7.5, yaw: 0, pitch: 0, onGround: true });
  };

  it('fall damage is ceil(distance − 3), with 10 ticks of invulnerability frames', () => {
    const { server, a, p } = setup();
    // no natural regeneration during the test
    p.living.food.foodLevel = 17;
    p.living.food.saturationLevel = 0;
    fall(a, 111); // 10 blocks: ceil(9.5 − 3) = 7
    expect(p.living.health).toBe(13);
    server.tick();
    expect((a.received.filter((m) => m.t === 'health').at(-1) as Extract<S2C, { t: 'health' }>).health).toBe(13);
    // a smaller hit inside the invulnerability window is ignored, a bigger one deals the difference
    fall(a, 105); // 4 blocks → 1 damage, ignored
    expect(p.living.health).toBe(13);
    fall(a, 113); // 12 blocks → 9, deals 9 − 7 = 2
    expect(p.living.health).toBe(11);
    // hay bales reduce fall damage to 20%
    for (let i = 0; i < 20; i++) server.tick();
    server.setBlock(31, 100, 7, stateOf('hay_block'));
    fall(a, 121); // 20 blocks: ceil(17·0.2) = 4
    expect(p.living.health).toBe(7);
  });

  it('drowning: 15 s of air, then 2 damage every second', () => {
    const { server, p } = setup();
    p.living.food.foodLevel = 17;
    p.living.food.saturationLevel = 0;
    server.setBlock(31, 101, 7, stateOf('water'));
    server.setBlock(31, 102, 7, stateOf('water'));
    server.setBlock(31, 103, 7, stateOf('water'));
    for (let i = 0; i < 319; i++) server.tick();
    expect(p.living.health).toBe(20);
    server.tick();
    expect(p.living.health).toBe(18);
    for (let i = 0; i < 20; i++) server.tick();
    expect(p.living.health).toBe(16);
  });

  it('death drops the inventory, shows the death screen and respawns with full health', () => {
    const { server, a, p } = setup();
    p.inventory.set(0, { id: ITEMS_BY_NAME.get('stone')!.id, count: 5, damage: 0 });
    a.send({ t: 'chat', message: '/kill' });
    expect(p.living.dead).toBe(true);
    const died = a.received.find((m) => m.t === 'playerDied') as Extract<S2C, { t: 'playerDied' }>;
    expect(died.message).toBe('A fell out of the world');
    expect(p.inventory.get(0)).toBeNull();
    expect([...server.entities.values()].length).toBe(1);
    // moves are ignored while dead
    a.send({ t: 'move', x: 33.5, y: 101, z: 7.5, yaw: 0, pitch: 0, onGround: true });
    expect(p.x).toBe(31.5);
    a.send({ t: 'respawn' });
    expect(p.living.health).toBe(20);
    expect(a.received.some((m) => m.t === 'respawn')).toBe(true);
  });

  it('lava burns and sets the player on fire; water puts it out', () => {
    const { server, p } = setup();
    server.setBlock(31, 101, 7, stateOf('lava'));
    server.tick();
    expect(p.living.health).toBe(16);
    expect(p.living.remainingFireTicks).toBeGreaterThan(200);
    server.setBlock(31, 101, 7, stateOf('water'));
    server.tick();
    expect(p.living.remainingFireTicks).toBeLessThanOrEqual(0);
  });

  it('creative players take no fall damage', () => {
    const { a, p } = setup();
    a.send({ t: 'chat', message: '/gamemode creative' });
    fall(a, 131);
    expect(p.living.health).toBe(20);
  });

  // players have 20 fire-immune ticks, so the strike itself only counts one of them down
  // (vanilla Entity.thunderHit); they catch fire from the fire blocks the bolt places
  it('lightning strikes deal 5 damage', () => {
    const { server, a, p } = setup();
    p.living.food.foodLevel = 17;
    p.living.food.saturationLevel = 0;
    a.send({ t: 'chat', message: '/summon lightning_bolt ~ ~ ~' });
    server.tick();
    expect(p.living.health).toBe(15);
    expect(p.living.remainingFireTicks).toBe(-19);
    expect(a.received.some((m) => m.t === 'addEntity' && m.type === 'lightning_bolt')).toBe(true);
  });

  it('entities outside the simulation distance are frozen', () => {
    const { server, p } = setup();
    server.simulationDistance = 2;
    p.isOwner = false;
    server.popResource(Math.floor(p.x) + 16 * 5, 120, Math.floor(p.z), { id: ITEMS_BY_NAME.get('stone')!.id, count: 1, damage: 0 });
    const e = [...server.entities.values()].at(-1)!;
    const y = e.y;
    for (let i = 0; i < 10; i++) server.tick();
    expect(e.y).toBe(y);
    server.simulationDistance = 8;
    for (let i = 0; i < 10; i++) server.tick();
    expect(e.y).toBeLessThan(y);
  });

  it('PvP: charged fist hits deal 1 damage and knock the victim back; spam hits are weaker', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: 0, scene: 'models', randomSeed: 1n });
    const a = client(server, 'A');
    const b = client(server, 'B');
    for (let i = 0; i < 3; i++) server.tick();
    const [pa, pb] = server.players as [typeof server.players[0], typeof server.players[0]];
    a.send({ t: 'chat', message: '/tp 31.5 101 7.5' });
    a.send({ t: 'move', x: 31.5, y: 101, z: 7.5, yaw: 0, pitch: 0, onGround: true });
    b.send({ t: 'chat', message: '/tp 31.5 101 9.5' });
    b.send({ t: 'move', x: 31.5, y: 101, z: 9.5, yaw: 180, pitch: 0, onGround: true });
    for (let i = 0; i < 61; i++) server.tick();
    pb.living.food.foodLevel = 17;
    pb.living.food.saturationLevel = 0;
    a.send({ t: 'attack', target: pb.id, sneaking: false });
    expect(pb.living.health).toBe(19);
    server.tick();
    const motion = b.received.filter((m) => m.t === 'entityMotion').at(-1) as Extract<S2C, { t: 'entityMotion' }>;
    expect(motion.vz).toBeCloseTo(0.4); // pushed away from A (A is at lower z)
    expect(motion.vy).toBeCloseTo(0.4);
    // immediately again: inside the invulnerability window and with an uncharged fist
    a.send({ t: 'attack', target: pb.id, sneaking: false });
    expect(pb.living.health).toBe(19);
    // pvp off
    for (let i = 0; i < 20; i++) server.tick();
    server.pvp = false;
    a.send({ t: 'attack', target: pb.id, sneaking: false });
    expect(pb.living.health).toBe(19);
    server.pvp = true;
    for (let i = 0; i < 10; i++) server.tick(); // recharge (the blocked swing reset the cooldown)
    pb.living.health = 1;
    a.send({ t: 'attack', target: pb.id, sneaking: false });
    expect(pb.living.dead).toBe(true);
    const died = b.received.find((m) => m.t === 'playerDied') as Extract<S2C, { t: 'playerDied' }>;
    expect(died.message).toBe('B was slain by A');
    void pa;
  });

  it('beds: sleeping by night skips to morning; by day only sets the spawn; respawn at the bed', () => {
    const { server, a, p } = setup();
    p.inventory.set(0, { id: ITEMS_BY_NAME.get('red_bed')!.id, count: 1, damage: 0 });
    p.inventory.selected = 0;
    // facing south (yaw 0): foot at (31,101,8), head at (31,101,9)
    a.send({ t: 'useOn', x: 31, y: 100, z: 8, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(blockNameOf(server.world.getState(31, 101, 8))).toBe('red_bed');
    expect(getProp(server.world.getState(31, 101, 9), 'part')).toBe('head');
    server.setDayTime(6000);
    a.send({ t: 'useOn', x: 31, y: 101, z: 9, face: 1, cx: 0.5, cy: 0.5, cz: 0.5, hand: 0 });
    expect(p.sleepingPos).toBeNull();
    expect(p.respawn).toEqual({ x: 31, y: 101, z: 9, angle: 0 });
    expect(a.received.some((m) => m.t === 'actionBar' && m.text === 'You can sleep only at night or during thunderstorms')).toBe(true);
    server.setDayTime(18000);
    a.send({ t: 'useOn', x: 31, y: 101, z: 8, face: 1, cx: 0.5, cy: 0.5, cz: 0.5, hand: 0 });
    expect(p.sleepingPos).toEqual([31, 101, 9]);
    expect(getProp(server.world.getState(31, 101, 9), 'occupied')).toBe(true);
    server.tick();
    expect(p.pose).toBe('sleeping');
    for (let i = 0; i < 99; i++) server.tick();
    expect(p.sleepingPos).toBeNull();
    expect(server.dayTime % 24000).toBeLessThan(10);
    expect(getProp(server.world.getState(31, 101, 9), 'occupied')).toBe(false);
    // die and respawn next to the bed
    a.send({ t: 'chat', message: '/kill' });
    a.send({ t: 'respawn' });
    expect(Math.abs(p.x - 31.5) <= 2 && Math.abs(p.z - 9.5) <= 3).toBe(true);
  });

  it('XP orbs: death drops 7 per level as orbs that fly to and are collected by players', () => {
    const { server, a, p } = setup();
    a.send({ t: 'chat', message: '/xp add @s 5 levels' });
    a.send({ t: 'chat', message: '/kill' });
    const orbs = () => [...server.entities.values()].filter((e) => e.type === 'experience_orb') as unknown as { value: number; count: number }[];
    expect(orbs().reduce((s, o) => s + o.value * o.count, 0)).toBe(35);
    expect(p.living.experienceLevel).toBe(0);
    a.send({ t: 'respawn' });
    // walk back to the orbs and collect them
    a.send({ t: 'chat', message: '/tp 31.5 101 7.5' });
    a.send({ t: 'move', x: 31.5, y: 101, z: 7.5, yaw: 0, pitch: 0, onGround: true });
    for (let i = 0; i < 200; i++) server.tick();
    expect(orbs().length).toBe(0);
    expect(p.living.totalExperience).toBe(35);
    expect(a.received.some((m) => m.t === 'takeItem')).toBe(true);
  });

  it('mining coal ore gives 0–2 XP', () => {
    const { server, p } = setup();
    let total = 0;
    for (let i = 0; i < 30; i++) {
      server.setBlock(33, 101, 7, stateOf('coal_ore'));
      p.inventory.set(0, { id: ITEMS_BY_NAME.get('wooden_pickaxe')!.id, count: 1, damage: 0 });
      server.destroyBlock(33, 101, 7, p, true);
      const xp = [...server.entities.values()].filter((e) => e.type === 'experience_orb') as unknown as { value: number; count: number; removed: boolean }[];
      for (const o of xp) {
        total += o.value * o.count;
        o.removed = true;
      }
      server.tick();
    }
    expect(total).toBeGreaterThan(10);
    expect(total).toBeLessThanOrEqual(60);
  });

  it('powder snow freezes after 7 s, then 1 damage every 2 s; thaws twice as fast', () => {
    const { server, p } = setup();
    p.living.food.foodLevel = 17;
    p.living.food.saturationLevel = 0;
    server.setBlock(31, 101, 7, stateOf('powder_snow'));
    server.setBlock(31, 102, 7, stateOf('powder_snow'));
    for (let i = 0; i < 140; i++) server.tick();
    expect(p.living.ticksFrozen).toBe(140);
    for (let i = 0; i < 80; i++) server.tick();
    expect(p.living.health).toBe(18);
    server.setBlock(31, 101, 7, 0);
    server.setBlock(31, 102, 7, 0);
    for (let i = 0; i < 70; i++) server.tick();
    expect(p.living.ticksFrozen).toBe(0);
  });
});
