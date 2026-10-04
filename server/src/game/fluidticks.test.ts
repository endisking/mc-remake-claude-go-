import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf, getProp } from '@shared/world/blockstate';
import { BlockWorld } from '@shared/world/world';
import { Chunk } from '@shared/world/chunk';
import { ItemEntity } from './entity';

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

describe('server fluid ticks', () => {
  it('water placed on a platform flows out over the following ticks and clients see it', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    const a = client(server, 'A');
    for (let i = 0; i < 5; i++) server.tick();
    const stone = stateOf('stone');
    for (let x = -3; x <= 9; x++) for (let z = -3; z <= 9; z++) server.world.setStateRaw(x, 119, z, stone);
    a.send({ t: 'setBlock', x: 3, y: 120, z: 3, state: stateOf('water') });
    expect(blockNameOf(server.world.getState(4, 120, 3))).toBe('air');
    for (let i = 0; i < 5; i++) server.tick();
    expect(getProp(server.world.getState(4, 120, 3), 'level')).toBe(1);
    for (let i = 0; i < 40; i++) server.tick();
    expect(getProp(server.world.getState(9, 120, 3), 'level')).toBe(6);
    // over the platform edge it falls
    expect(getProp(server.world.getState(3, 119, -4), 'level')).toBe(8);
    expect(a.received.some((p) => p.t === 'blockChange' && p.x === 9 && p.y === 120 && p.z === 3)).toBe(true);
  });

  it('lava hardens when water reaches it, with a fizz event', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    const a = client(server, 'A');
    for (let i = 0; i < 5; i++) server.tick();
    const stone = stateOf('stone');
    for (let x = -3; x <= 9; x++) for (let z = -3; z <= 9; z++) server.world.setStateRaw(x, 119, z, stone);
    a.send({ t: 'setBlock', x: 3, y: 120, z: 3, state: stateOf('lava') });
    a.send({ t: 'setBlock', x: 3, y: 121, z: 3, state: stateOf('water') });
    expect(blockNameOf(server.world.getState(3, 120, 3))).toBe('obsidian');
    expect(a.received.some((p) => p.t === 'levelEvent' && p.event === 1501)).toBe(true);
  });

  it('clients end up with the server state when lava hardens inside its own update', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    const a = client(server, 'A');
    for (let i = 0; i < 5; i++) server.tick();
    const stone = stateOf('stone');
    for (let x = -2; x <= 10; x++) for (let z = -3; z <= 3; z++) {
      server.world.setStateRaw(x, 119, z, stone);
      if (z === -3 || z === 3 || x === -2 || x === 10) server.world.setStateRaw(x, 120, z, stone);
    }
    a.send({ t: 'setBlock', x: 0, y: 120, z: 0, state: stateOf('lava') });
    a.send({ t: 'setBlock', x: 8, y: 120, z: 0, state: stateOf('water') });
    a.send({ t: 'setBlock', x: 0, y: 120, z: 2, state: stateOf('lava') });
    for (let i = 0; i < 300; i++) server.tick();
    const last = new Map<string, number>();
    for (const p of a.received) if (p.t === 'blockChange') last.set(`${p.x},${p.y},${p.z}`, p.state);
    let cobble = 0;
    for (const [k, s] of last) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      expect(s, k).toBe(server.world.getState(x, y, z));
      if (blockNameOf(s) === 'cobblestone') cobble++;
    }
    const rows: string[] = [];
    for (let z = -2; z <= 2; z++) { const r: string[] = []; for (let x = -1; x <= 9; x++) r.push(blockNameOf(server.world.getState(x, 120, z)).slice(0, 4)); rows.push(r.join(' ')); }
    expect(cobble, rows.join('\n')).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('worldgen springs schedule fluid ticks when their chunk is decorated', () => {
    const server = new GameServer({ seed: 12345n, chunkGenBudget: 100 });
    client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    expect(server.fluids.size).toBeGreaterThan(0);
    // the ones in ticking chunks run (delay 0) and the springs start flowing
    for (let i = 0; i < 40; i++) server.tick();
    expect(server.fluids.processed).toBeGreaterThan(0);
    let flowing = 0;
    for (const c of server.world.chunks.values()) {
      for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const lvl = getProp(c.getState(x, y, z), 'level');
        if (typeof lvl === 'number' && lvl > 0) flowing++;
      }
    }
    expect(flowing).toBeGreaterThan(0);
  }, 120000);

  it('flowing water carries dropped items downstream', () => {
    const world = new BlockWorld();
    world.addChunk(new Chunk(0, 0));
    const stone = stateOf('stone');
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.setStateRaw(x, 63, z, stone);
    // a source at x=2 flowing east: levels 1..7 along x=3..9
    world.setStateRaw(2, 64, 8, stateOf('water'));
    for (let d = 1; d <= 7; d++) world.setStateRaw(2 + d, 64, 8, stateOf('water', { level: d }));
    const e = new ItemEntity(1, { id: 1, count: 1, damage: 0 });
    e.x = 4.5;
    e.y = 64;
    e.z = 8.5;
    for (let i = 0; i < 40; i++) e.tick(world);
    expect(e.x).toBeGreaterThan(5);
    expect(Math.abs(e.z - 8.5)).toBeLessThan(0.05);
  });
});
