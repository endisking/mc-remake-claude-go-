import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf, getProp } from '@shared/world/blockstate';

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

  it('worldgen springs schedule fluid ticks when their chunk is decorated', () => {
    const server = new GameServer({ seed: 12345n, chunkGenBudget: 100 });
    client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    expect(server.fluids.size).toBeGreaterThan(0);
  }, 60000);
});
