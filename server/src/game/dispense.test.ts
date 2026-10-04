import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { ITEMS_BY_NAME } from '@shared/data';
import { blockNameOf, getProp, stateOf } from '@shared/world/blockstate';
import type { ItemStack } from '@shared/item/stack';
import { Arrow } from './arrow';

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
  const item = (name: string, count = 1): ItemStack => ({ id: ITEMS_BY_NAME.get(name)!.id, count, damage: 0 });
  const y = 150;
  /** a dispenser at (8, y, 8) facing east, fired by a redstone block placed above */
  const fire = (stack: ItemStack) => {
    server.setBlock(8, y, 8, stateOf('dispenser', { facing: 'east' }));
    const items = server.containers.ensureItems(8, y, 8, 'dispenser', 9);
    items.fill(null);
    items[0] = stack;
    server.setBlock(8, y + 1, 8, stateOf('redstone_block'));
    for (let i = 0; i < 5; i++) server.tick();
    server.setBlock(8, y + 1, 8, stateOf('air'));
    server.tick();
    return items;
  };
  return { server, item, fire, y };
}

describe('dispenser behaviours', () => {
  it('shoots an arrow out of its face', () => {
    const { server, item, fire } = setup();
    const before = [...server.entities.values()].filter((e) => e instanceof Arrow).length;
    const items = fire(item('arrow', 3));
    const arrows = [...server.entities.values()].filter((e) => e instanceof Arrow) as Arrow[];
    expect(arrows.length).toBe(before + 1);
    expect(arrows[arrows.length - 1]!.vx).toBeGreaterThan(0.5);
    expect(items[0]!.count).toBe(2);
  });

  it('empties a water bucket in front and keeps the empty bucket', () => {
    const { server, item, fire, y } = setup();
    server.setBlock(9, y, 8, 0);
    const items = fire(item('water_bucket'));
    expect(blockNameOf(server.world.getState(9, y, 8))).toBe('water');
    expect(items[0]!.id).toBe(ITEMS_BY_NAME.get('bucket')!.id);
  });

  it('scoops a lava source with an empty bucket', () => {
    const { server, item, fire, y } = setup();
    server.setBlock(9, y, 8, stateOf('lava'));
    const items = fire(item('bucket'));
    expect(blockNameOf(server.world.getState(9, y, 8))).toBe('air');
    expect(items[0]!.id).toBe(ITEMS_BY_NAME.get('lava_bucket')!.id);
  });

  it('bone meal grows a crop in front and is used up', () => {
    const { server, item, fire, y } = setup();
    server.setBlock(9, y - 1, 8, stateOf('farmland', { moisture: 7 }));
    server.setBlock(9, y, 8, stateOf('wheat'));
    const items = fire(item('bone_meal', 2));
    expect(getProp(server.world.getState(9, y, 8), 'age') as number).toBeGreaterThanOrEqual(2);
    expect(items[0]!.count).toBe(1);
  });

  it('fails (keeps the item) when bone meal has nothing to grow', () => {
    const { server, item, fire, y } = setup();
    server.setBlock(9, y, 8, stateOf('stone'));
    const items = fire(item('bone_meal', 2));
    expect(items[0]!.count).toBe(2);
  });
});
