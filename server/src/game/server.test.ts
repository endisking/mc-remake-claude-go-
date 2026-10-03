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
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: gameMode, scene: 'models' });
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
    // the drop is picked up after its 10-tick delay once it lands near the player
    for (let i = 0; i < 40; i++) server.tick();
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
});
