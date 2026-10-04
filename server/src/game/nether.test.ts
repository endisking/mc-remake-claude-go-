import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf } from '@shared/world/blockstate';
import { MemoryStorage } from '../storage/memory';

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn, true);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

const OBS = stateOf('obsidian');

/** Build a 2×3 obsidian frame (axis x) above the player and return its bottom-left interior block. */
function buildFrame(server: GameServer, x: number, y: number, z: number): void {
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) if (i === -1 || i === 2 || j === -1 || j === 3) server.setBlock(x + i, y + j, z, OBS);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) server.setBlock(x + i, y + j, z, 0);
}

describe('nether portals on the server', () => {
  it('fire in a frame lights it; breaking the frame breaks the portal', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 1, z = Math.floor(p.z);
    buildFrame(server, x, y, z);
    server.setBlock(x, y, z, stateOf('fire'));
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) expect(blockNameOf(server.world.getState(x + i, y + j, z))).toBe('nether_portal');
    server.setBlock(x + 2, y + 1, z, 0);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) expect(server.world.getState(x + i, y + j, z)).toBe(0);
  });

  it('flint and steel lights a frame', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y) + 1, z = Math.floor(p.z);
    buildFrame(server, x, y, z);
    a.send({ t: 'chat', message: '/give @s flint_and_steel' });
    a.send({ t: 'useOn', x, y: y - 1, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(blockNameOf(server.world.getState(x + 1, y + 2, z))).toBe('nether_portal');
    expect(p.inventory.selectedStack?.damage).toBe(1);
  });

  it('standing in a portal for 80 ticks (survival) takes you to the nether at 1/8 scale with a new portal; 1 tick in creative', () => {
    const storage = new MemoryStorage();
    const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true, storage });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    // move to x 400 so the nether target is at x 50
    a.send({ t: 'chat', message: '/tp @s 400 100 0' });
    for (let i = 0; i < 5; i++) server.tick();
    const gy = server.world.getChunk(25, 0)!.motionBlocking[0]!;
    const y = gy + 1;
    buildFrame(server, 400, y, 0);
    server.setBlock(400, y, 0, stateOf('fire'));
    p.x = 400.5;
    p.y = y;
    p.z = 0.5;
    for (let i = 0; i < 79; i++) server.tick();
    expect(p.dimension).toBe('overworld');
    for (let i = 0; i < 3; i++) server.tick();
    expect(p.dimension).toBe('the_nether');
    const dim = a.received.find((m) => m.t === 'dimension') as Extract<S2C, { t: 'dimension' }>;
    expect(dim.dimension).toBe('the_nether');
    expect(Math.abs(dim.x - 50.5)).toBeLessThan(17);
    // a portal was built where we arrived, and chunks of the nether stream in
    const nether = server.levels.get('the_nether')!;
    expect(blockNameOf(nether.world.getState(Math.floor(dim.x), Math.floor(dim.y), Math.floor(dim.z)))).toBe('nether_portal');
    for (let i = 0; i < 5; i++) server.tick();
    expect(a.received.slice(a.received.indexOf(dim)).filter((m) => m.t === 'chunk').length).toBe(49);
    // the cooldown keeps us from bouncing straight back while we stay in the portal
    for (let i = 0; i < 100; i++) server.tick();
    expect(p.dimension).toBe('the_nether');
    // creative: one tick after stepping out and back in
    a.send({ t: 'chat', message: '/gamemode creative' });
    p.x += 5;
    for (let i = 0; i < 15; i++) server.tick();
    p.x -= 5;
    for (let i = 0; i < 3; i++) server.tick();
    expect(p.dimension).toBe('overworld');
    // back near the original portal (search radius 128 in the overworld)
    expect(Math.abs(p.x - 400.5)).toBeLessThan(3);
    // nether chunks are saved in their own namespace
    return server.save().then(() => {
      expect([...storage.chunks.keys()].some((k) => k.startsWith('DIM-1:'))).toBe(true);
      expect([...storage.chunks.keys()].some((k) => !k.includes(':'))).toBe(true);
    });
  });
});
