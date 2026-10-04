import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { ITEMS_BY_NAME } from '@shared/data';
import { getProp, stateOf } from '@shared/world/blockstate';

function serverSetup() {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true, randomSeed: 1234n });
  const conn: Connection = { send: (d) => void decodeS2C(d), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' }));
  for (let i = 0; i < 3; i++) server.tick();
  const p = server.players[0]!;
  p.x = 8.5;
  p.y = 151;
  p.z = 8.5;
  const send = (m: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(m));
  const give = (item: string, count = 1) => {
    p.inventory.selected = 0;
    p.inventory.set(0, { id: ITEMS_BY_NAME.get(item)!.id, count, damage: 0 });
  };
  const get = (x: number, y: number, z: number, prop: string) => getProp(server.world.getState(x, y, z), prop);
  return { server, p, send, give, get };
}

describe('redstone on the server', () => {
  it('player-placed dust connects and carries a lever signal to a lamp', () => {
    const { server, p, send, give, get } = serverSetup();
    const y = 150;
    for (let x = 4; x <= 12; x++) server.setBlock(x, y - 1, 12, stateOf('stone'));
    p.gameMode = 0;
    give('redstone', 64);
    for (let x = 6; x <= 10; x++) send({ t: 'useOn', x, y: y - 1, z: 12, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(get(8, y, 12, 'east')).toBe('side');
    expect(get(8, y, 12, 'north')).toBe('none');
    server.setBlock(11, y, 12, stateOf('redstone_lamp'));
    server.setBlock(5, y, 12, stateOf('lever', { face: 'floor', facing: 'east' }));
    send({ t: 'useOn', x: 5, y, z: 12, face: 1, cx: 0.5, cy: 0.1, cz: 0.5, hand: 0 });
    expect(get(5, y, 12, 'powered')).toBe(true);
    expect([6, 7, 8, 9, 10].map((x) => get(x, y, 12, 'power'))).toEqual([15, 14, 13, 12, 11]);
    expect(get(11, y, 12, 'lit')).toBe(true);
    send({ t: 'useOn', x: 5, y, z: 12, face: 1, cx: 0.5, cy: 0.1, cz: 0.5, hand: 0 });
    expect(get(10, y, 12, 'power')).toBe(0);
    for (let i = 0; i < 4; i++) server.tick();
    expect(get(11, y, 12, 'lit')).toBe(false);
  });

  it('a player on a stone pressure plate powers it until 20 ticks after leaving', () => {
    const { server, p, get } = serverSetup();
    const y = 150;
    server.setBlock(8, y - 1, 8, stateOf('stone'));
    server.setBlock(8, y, 8, stateOf('stone_pressure_plate'));
    p.gameMode = 0;
    p.x = 8.5;
    p.y = y;
    p.z = 8.5;
    server.tick();
    expect(get(8, y, 8, 'powered')).toBe(true);
    p.x = 20.5;
    for (let i = 0; i < 25; i++) server.tick();
    expect(get(8, y, 8, 'powered')).toBe(false);
  });

  it('a comparator reads a chest through its block entity', () => {
    const { server, get } = serverSetup();
    const y = 150;
    for (let x = 6; x <= 9; x++) server.setBlock(x, y - 1, 6, stateOf('stone'));
    server.setBlock(6, y, 6, stateOf('chest', { facing: 'north' }));
    const c = server.world.getChunk(0, 0)!;
    const items = new Array(27).fill(null);
    for (let i = 0; i < 14; i++) items[i] = { id: ITEMS_BY_NAME.get('stone')!.id, count: 64, damage: 0 };
    c.blockEntities.set((y << 8) | (6 << 4) | 6, { id: 'chest', items });
    server.setBlock(7, y, 6, stateOf('comparator', { facing: 'west' }));
    server.setBlock(8, y, 6, stateOf('redstone_wire'));
    server.redstone.placed(7, y, 6);
    for (let i = 0; i < 4; i++) server.tick();
    // 14 full slots of 27: floor(14/27 * 14) + 1 = 8
    expect(get(8, y, 6, 'power')).toBe(8);
  });
});
