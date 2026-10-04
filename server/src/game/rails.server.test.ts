import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { blockNameOf, getProp, stateOf } from '@shared/world/blockstate';

function setup() {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true, randomSeed: 1234n });
  const conn: Connection = { send: (d) => void decodeS2C(d), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' }));
  for (let i = 0; i < 3; i++) server.tick();
  const p = server.players[0]!;
  p.x = 8.5;
  p.y = 200;
  p.z = 8.5;
  p.gameMode = 1;
  return server;
}

describe('rails on the server', () => {
  it('rails connect, powered rails follow a redstone block, unsupported rails pop off', () => {
    const server = setup();
    const y = 150;
    for (let x = 2; x <= 14; x++) server.setBlock(x, y - 1, 8, stateOf('stone'));
    for (let x = 3; x <= 13; x++) server.setBlock(x, y, 8, stateOf('powered_rail'));
    expect(getProp(server.world.getState(8, y, 8), 'shape')).toBe('east_west');
    server.setBlock(2, y, 8, stateOf('redstone_block'));
    const powered = [];
    for (let x = 3; x <= 13; x++) powered.push(getProp(server.world.getState(x, y, 8), 'powered'));
    expect(powered).toEqual([true, true, true, true, true, true, true, true, true, false, false]);
    server.setBlock(2, y, 8, stateOf('air'));
    expect(getProp(server.world.getState(8, y, 8), 'powered')).toBe(false);
    server.setBlock(13, y - 1, 8, stateOf('air'));
    expect(blockNameOf(server.world.getState(13, y, 8))).toBe('air');
  });
});
