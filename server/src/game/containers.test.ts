import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, decodeStacks, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { getProp, blockNameOf, stateOf } from '@shared/world/blockstate';
import { stack, itemName } from '@shared/item/stack';
import { ItemEntity } from './entity';

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

function setup() {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, randomSeed: 1n });
  const a = client(server, 'A');
  for (let i = 0; i < 3; i++) server.tick();
  const p = server.players[0]!;
  p.yaw = 0;
  const gx = Math.floor(p.x), gz = Math.floor(p.z);
  const gy = Math.floor(p.y) - 1;
  for (let dx = 1; dx <= 4; dx++) {
    server.setBlock(gx + dx, gy, gz, stateOf('stone'));
    for (let dy = 1; dy <= 3; dy++) server.setBlock(gx + dx, gy + dy, gz, 0);
  }
  return { server, a, p, gx, gy, gz };
}

describe('containers', () => {
  it('chests placed side by side merge into a double chest (54 slots) and split when broken', () => {
    const { server, a, p, gx, gy, gz } = setup();
    p.inventory.set(0, stack('chest', 2));
    a.send({ t: 'useOn', x: gx + 2, y: gy, z: gz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    a.send({ t: 'useOn', x: gx + 3, y: gy, z: gz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const s1 = server.world.getState(gx + 2, gy + 1, gz), s2 = server.world.getState(gx + 3, gy + 1, gz);
    expect(blockNameOf(s1)).toBe('chest');
    expect(getProp(s1, 'facing')).toBe('north');
    expect([getProp(s1, 'type'), getProp(s2, 'type')]).toEqual(['left', 'right']);
    // open: a 6-row window
    a.send({ t: 'useOn', x: gx + 2, y: gy + 1, z: gz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const open = a.received.filter((m) => m.t === 'openWindow').at(-1) as Extract<S2C, { t: 'openWindow' }>;
    expect(open).toMatchObject({ type: 'generic_9x6', title: 'Large Chest' });
    // put a stack into the first slot (the right half's first slot)
    p.inventory.set(5, stack('diamond', 7));
    const hot = 54 + 27 + 5;
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: hot, button: 0, clickType: 1 });
    const items = a.received.filter((m) => m.t === 'windowItems').at(-1) as Extract<S2C, { t: 'windowItems' }>;
    const list = decodeStacks(items.items);
    expect(list.length).toBe(54 + 36 + 1);
    expect(itemName(list[0]!.id)).toBe('diamond');
    expect(p.inventory.get(5)).toBeNull();
    a.send({ t: 'closeWindow', windowId: open.windowId });
    // the contents survive closing and live in the right half's block entity
    const be = server.containers.blockEntity(gx + 3, gy + 1, gz)!;
    expect((be.items as ({ id: number } | null)[])[0]?.id).toBe(stack('diamond').id);
    // breaking the right half drops the diamonds and turns the left half single again
    server.destroyBlock(gx + 3, gy + 1, gz, null, false);
    expect(getProp(server.world.getState(gx + 2, gy + 1, gz), 'type')).toBe('single');
    const drops = [...server.entities.values()].filter((e) => e instanceof ItemEntity) as ItemEntity[];
    expect(drops.reduce((n, e) => n + (e.stack.id === stack('diamond').id ? e.stack.count : 0), 0)).toBe(7);
  });

  it('crafting table: 3×3 recipe, result taken, grid returned on close', () => {
    const { server, a, p, gx, gy, gz } = setup();
    server.setBlock(gx + 2, gy + 1, gz, stateOf('crafting_table'));
    a.send({ t: 'useOn', x: gx + 2, y: gy + 1, z: gz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const open = a.received.filter((m) => m.t === 'openWindow').at(-1) as Extract<S2C, { t: 'openWindow' }>;
    expect(open.type).toBe('crafting');
    p.inventory.set(9, stack('cobblestone', 9));
    // pick up, drag-split over the 8 furnace ring slots (left drag)
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 10, button: 0, clickType: 0 });
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: -999, button: 0, clickType: 5 });
    for (const s of [1, 2, 3, 4, 6, 7, 8, 9]) a.send({ t: 'clickWindow', windowId: open.windowId, slot: s, button: 1, clickType: 5 });
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: -999, button: 2, clickType: 5 });
    let list = decodeStacks((a.received.filter((m) => m.t === 'windowItems').at(-1) as Extract<S2C, { t: 'windowItems' }>).items);
    expect(itemName(list[0]!.id)).toBe('furnace');
    expect(list.at(-1)?.count).toBe(1); // one cobblestone still carried
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 0, button: 0, clickType: 1 }); // shift-click result
    expect(p.inventory.find(stack('furnace').id)).toBeGreaterThanOrEqual(0);
    list = decodeStacks((a.received.filter((m) => m.t === 'windowItems').at(-1) as Extract<S2C, { t: 'windowItems' }>).items);
    expect(list[0]).toBeNull();
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 5, button: 0, clickType: 0 }); // drop the carried one in the centre
    a.send({ t: 'closeWindow', windowId: open.windowId });
    expect(p.inventory.find(stack('cobblestone').id)).toBeGreaterThanOrEqual(0);
  });

  it('furnace smelts over server ticks, lights up, and pays XP when the result is taken', () => {
    const { server, a, p, gx, gy, gz } = setup();
    const fpos = [gx + 2, gy + 1, gz] as const;
    server.setBlock(fpos[0], fpos[1], fpos[2], stateOf('furnace'));
    a.send({ t: 'useOn', x: fpos[0], y: fpos[1], z: fpos[2], face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const open = a.received.filter((m) => m.t === 'openWindow').at(-1) as Extract<S2C, { t: 'openWindow' }>;
    expect(open).toMatchObject({ type: 'furnace', title: 'Furnace' });
    p.inventory.set(9, stack('raw_iron', 3));
    p.inventory.set(10, stack('coal', 1));
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 3, button: 0, clickType: 1 });
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 4, button: 0, clickType: 1 });
    server.tick();
    expect(getProp(server.world.getState(fpos[0], fpos[1], fpos[2]), 'lit')).toBe(true);
    for (let i = 0; i < 99; i++) server.tick();
    const data = (prop: number) => (a.received.filter((m) => m.t === 'windowData' && m.property === prop).at(-1) as Extract<S2C, { t: 'windowData' }>).value;
    expect([data(0), data(1), data(2), data(3)]).toEqual([1600 - 99, 1600, 100, 200]);
    for (let i = 0; i < 501; i++) server.tick();
    const slots = a.received.filter((m) => m.t === 'windowSlot' && m.slot === 2) as Extract<S2C, { t: 'windowSlot' }>[];
    expect(slots.at(-1)?.count).toBe(3);
    expect(a.received.some((m) => m.t === 'windowData' && m.property === 2 && m.value > 0)).toBe(true);
    const orbsBefore = [...server.entities.values()].filter((e) => e.type === 'experience_orb').length;
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 2, button: 0, clickType: 1 });
    expect(p.inventory.find(stack('iron_ingot').id)).toBeGreaterThanOrEqual(0);
    // 3 × 0.7 = 2.1 XP → 2 (or 3)
    expect([...server.entities.values()].filter((e) => e.type === 'experience_orb').length).toBeGreaterThan(orbsBefore);
    // walking away closes the window
    p.x += 20;
    server.tick();
    expect(a.received.some((m) => m.t === 'closeWindow')).toBe(true);
  });
});
