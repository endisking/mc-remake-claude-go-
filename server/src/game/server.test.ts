import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf } from '@shared/world/blockstate';

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
