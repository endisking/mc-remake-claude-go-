import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { ITEMS_BY_NAME } from '@shared/data';
import { getProp, stateOf } from '@shared/world/blockstate';
import type { ItemStack } from '@shared/item/stack';

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
  const item = (name: string, count: number): ItemStack => ({ id: ITEMS_BY_NAME.get(name)!.id, count, damage: 0 });
  const items = (x: number, y: number, z: number) => server.containers.blockEntity(x, y, z)!.items as (ItemStack | null)[];
  const total = (x: number, y: number, z: number) => items(x, y, z).reduce((a, s) => a + (s?.count ?? 0), 0);
  return { server, item, items, total };
}

describe('hoppers', () => {
  it('push one item every 8 ticks into the container below', () => {
    const { server, item, items, total } = setup();
    const y = 150;
    server.setBlock(8, y - 1, 8, stateOf('chest'));
    server.containers.ensureItems(8, y - 1, 8, 'chest', 27);
    server.setBlock(8, y, 8, stateOf('hopper', { facing: 'down' }));
    items(8, y, 8)[0] = item('cobblestone', 10);
    server.tick();
    expect(total(8, y - 1, 8)).toBe(1);
    for (let i = 0; i < 7; i++) server.tick();
    expect(total(8, y - 1, 8)).toBe(1);
    server.tick();
    expect(total(8, y - 1, 8)).toBe(2);
    for (let i = 0; i < 16; i++) server.tick();
    expect(total(8, y - 1, 8)).toBe(4);
    expect(total(8, y, 8)).toBe(6);
  });

  it('a powered hopper is locked', () => {
    const { server, item, items, total } = setup();
    const y = 150;
    server.setBlock(8, y - 1, 8, stateOf('chest'));
    server.containers.ensureItems(8, y - 1, 8, 'chest', 27);
    server.setBlock(8, y, 8, stateOf('hopper', { facing: 'down' }));
    server.setBlock(9, y, 8, stateOf('redstone_block'));
    expect(getProp(server.world.getState(8, y, 8), 'enabled')).toBe(false);
    items(8, y, 8)[0] = item('cobblestone', 10);
    for (let i = 0; i < 20; i++) server.tick();
    expect(total(8, y - 1, 8)).toBe(0);
    server.setBlock(9, y, 8, stateOf('air'));
    expect(getProp(server.world.getState(8, y, 8), 'enabled')).toBe(true);
    server.tick();
    expect(total(8, y - 1, 8)).toBe(1);
  });

  it('pulls one item from the container above', () => {
    const { server, item, total } = setup();
    const y = 150;
    server.setBlock(8, y + 1, 8, stateOf('barrel'));
    server.containers.ensureItems(8, y + 1, 8, 'barrel', 27)[3] = item('coal', 2);
    server.setBlock(8, y, 8, stateOf('hopper', { facing: 'down' }));
    server.tick();
    expect(total(8, y + 1, 8)).toBe(1);
    expect(total(8, y, 8)).toBe(1);
  });

  it('a side hopper fuels a furnace, a top hopper fills its input', () => {
    const { server, item, items } = setup();
    const y = 150;
    server.setBlock(9, y, 8, stateOf('furnace'));
    server.containers.ensureItems(9, y, 8, 'furnace', 3);
    server.setBlock(8, y, 8, stateOf('hopper', { facing: 'east' }));
    server.setBlock(9, y + 1, 8, stateOf('hopper', { facing: 'down' }));
    items(8, y, 8)[0] = item('stick', 1);
    items(9, y + 1, 8)[0] = item('sand', 1);
    server.tick();
    const f = items(9, y, 8);
    expect(f[1]?.id).toBe(ITEMS_BY_NAME.get('stick')!.id);
    expect(f[0]?.id).toBe(ITEMS_BY_NAME.get('sand')!.id);
  });

  it('picks up whole item entities above it', () => {
    const { server, total } = setup();
    const y = 150;
    server.setBlock(8, y, 8, stateOf('hopper', { facing: 'down' }));
    server.spawnItem(8.5, y + 1.2, 8.5, { id: ITEMS_BY_NAME.get('stick')!.id, count: 5, damage: 0 }, 0, 0, 0);
    for (let i = 0; i < 4; i++) server.tick();
    expect(total(8, y, 8)).toBe(5);
  });
});
