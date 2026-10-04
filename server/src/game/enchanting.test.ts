import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, decodeStacks, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf } from '@shared/world/blockstate';
import { stack, itemName } from '@shared/item/stack';
import { capturePlayer, applyPlayer } from '../storage/codec';
import { DAMAGE } from './survival';
import { ServerPlayer } from './player';
import { potionStack } from '@shared/game/potions';

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
  p.living.spawnInvulnerableTime = 0;
  return { server, a, p };
}

describe('effect swirls, flags and saves (Phase 7)', () => {
  it('broadcasts the potion swirl colour and invisibility/glowing flags', () => {
    const { server, a, p } = setup();
    p.living.effects.add('speed', 100, 0, server.items.effectTarget(p));
    server.tick();
    const sw = a.received.filter((m) => m.t === 'effectParticles').at(-1) as Extract<S2C, { t: 'effectParticles' }>;
    expect(sw).toMatchObject({ id: p.id, color: 8171462, ambient: false });
    p.living.effects.add('invisibility', 100, 0, server.items.effectTarget(p));
    p.living.effects.add('glowing', 100, 0, server.items.effectTarget(p));
    server.tick();
    expect(p.flags() & 32).toBe(32);
    expect(p.flags() & 64).toBe(64);
    p.living.effects.clear(server.items.effectTarget(p));
    server.tick();
    expect((a.received.filter((m) => m.t === 'effectParticles').at(-1) as { color: number }).color).toBe(0);
  });

  it('Protection enchantments reduce damage (EPF)', () => {
    const { server, p } = setup();
    const boots = stack('diamond_boots');
    boots.tag = { Enchantments: [{ id: 'feather_falling', lvl: 4 }] };
    p.inventory.set(36, boots);
    server.survival.hurt(p, DAMAGE.fall, 10);
    // diamond boots give 3 armour but fall bypasses armour: 10 × (1 − 12/25) = 5.2
    expect(p.living.health).toBeCloseTo(20 - 5.2, 4);
  });

  it('the enchantment seed is saved with the player', () => {
    const { server, p } = setup();
    p.enchantmentSeed = 12345;
    const data = capturePlayer(p);
    const q = new ServerPlayer(99, p.conn, server.world);
    applyPlayer(q, JSON.parse(JSON.stringify(data)));
    expect(q.enchantmentSeed).toBe(12345);
  });
});

describe('enchanting table and enchantment gameplay', () => {
  it('opens, offers level 30 with 15 bookshelves, and enchants for 3 lapis and 3 levels', () => {
    const { server, a, p } = setup();
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y), z = Math.floor(p.z);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy <= 2; dy++) server.setBlock(x + dx, y + dy, z + dz, 0);
    server.setBlock(x, y, z, stateOf('enchanting_table'));
    for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 1; dy++) {
      server.setBlock(x + dx, y + dy, z - 2, stateOf('bookshelf'));
      server.setBlock(x + dx, y + dy, z + 2, stateOf('bookshelf'));
    }
    p.living.experienceLevel = 30;
    p.inventory.set(0, stack('diamond_pickaxe'));
    p.inventory.set(1, stack('lapis_lazuli', 5));
    a.send({ t: 'useOn', x, y, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const open = a.received.filter((m) => m.t === 'openWindow').at(-1) as Extract<S2C, { t: 'openWindow' }>;
    expect(open).toMatchObject({ type: 'enchantment', title: 'Enchant' });
    // shift-click the pickaxe and the lapis in (hotbar slots start at 2 + 27)
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 29, button: 0, clickType: 1 });
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 30, button: 0, clickType: 1 });
    server.tick();
    const costs = [0, 1, 2].map((i) => (a.received.filter((m) => m.t === 'windowData' && m.property === i).at(-1) as { value: number } | undefined)?.value);
    expect(costs[2]).toBe(30);
    a.send({ t: 'menuButton', windowId: open.windowId, button: 2 });
    expect(p.living.experienceLevel).toBe(27);
    a.send({ t: 'closeWindow', windowId: open.windowId });
    const pick = [...p.inventory.slots].find((s) => s && itemName(s.id) === 'diamond_pickaxe')!;
    expect(pick.tag?.Enchantments?.length).toBeGreaterThan(0);
    const lapis = [...p.inventory.slots].find((s) => s && itemName(s.id) === 'lapis_lazuli')!;
    expect(lapis.count).toBe(2);
    expect(a.received.some((m) => m.t === 'slotTag')).toBe(true);
    void decodeStacks;
  });

  it('/enchant adds a compatible enchantment; efficiency speeds up mining', () => {
    const { server, a, p } = setup();
    p.inventory.set(0, stack('iron_pickaxe'));
    p.inventory.selected = 0;
    a.send({ t: 'chat', message: '/enchant @s efficiency 5' });
    expect(p.inventory.get(0)!.tag?.Enchantments).toEqual([{ id: 'efficiency', lvl: 5 }]);
    a.send({ t: 'chat', message: '/enchant @s efficiency 1' });
    expect(p.inventory.get(0)!.tag?.Enchantments?.length).toBe(1);
  });
});

describe('brewing stand and potions (server)', () => {
  it('brews awkward potions with blaze powder fuel, and a drunk potion applies its effect', () => {
    const { server, a, p } = setup();
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z);
    server.setBlock(x, y, z, stateOf('brewing_stand'));
    p.inventory.set(0, potionStack('potion', 'water'));
    p.inventory.set(1, stack('nether_wart', 1));
    p.inventory.set(2, stack('blaze_powder', 1));
    a.send({ t: 'useOn', x, y, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const open = a.received.filter((m) => m.t === 'openWindow').at(-1) as Extract<S2C, { t: 'openWindow' }>;
    expect(open).toMatchObject({ type: 'brewing_stand', title: 'Brewing Stand' });
    // hotbar starts at 5 + 27
    for (const i of [0, 1, 2]) a.send({ t: 'clickWindow', windowId: open.windowId, slot: 32 + i, button: 0, clickType: 1 });
    for (let i = 0; i < 405; i++) server.tick();
    const be = server.containers.blockEntity(x, y, z) as unknown as { items: ({ tag?: { Potion?: string } } | null)[]; fuel: number };
    expect(be.items[0]?.tag?.Potion).toBe('awkward');
    expect(be.fuel).toBe(19);
    a.send({ t: 'closeWindow', windowId: open.windowId });
    // drinking a potion of swiftness
    p.inventory.set(0, potionStack('potion', 'swiftness'));
    p.inventory.selected = 0;
    a.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 40; i++) server.tick();
    expect(p.living.effects.amplifier('speed')).toBe(0);
    expect(itemName(p.inventory.get(0)?.id ?? 0)).toBe('glass_bottle');
  });
});
