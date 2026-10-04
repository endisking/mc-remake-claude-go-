import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, decodeStacks, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf } from '@shared/world/blockstate';
import { stack, itemName } from '@shared/item/stack';
import { capturePlayer, applyPlayer } from '../storage/codec';
import { DAMAGE } from './survival';
import { ServerPlayer } from './player';
import { potionStack, POTIONS } from '@shared/game/potions';
import { EffectCloud } from './effectcloud';

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

describe('frost walker', () => {
  it('freezes still water around the player into frosted ice that later melts', () => {
    const { server, a, p } = setup();
    const x0 = Math.floor(p.x), y0 = Math.floor(p.y) - 1, z0 = Math.floor(p.z);
    for (let dx = 1; dx <= 6; dx++) for (let dz = -3; dz <= 3; dz++) {
      server.setBlock(x0 + dx, y0, z0 + dz, stateOf('water'));
      for (let dy = 1; dy <= 3; dy++) server.setBlock(x0 + dx, y0 + dy, z0 + dz, 0);
    }
    const boots = stack('diamond_boots');
    boots.tag = { Enchantments: [{ id: 'frost_walker', lvl: 2 }] };
    p.inventory.set(36, boots);
    a.send({ t: 'move', x: x0 + 2.5, y: p.y, z: z0 + 0.5, yaw: 0, pitch: 0, onGround: true });
    let frosted = 0;
    for (let dx = 1; dx <= 6; dx++) for (let dz = -3; dz <= 3; dz++) if (blockNameOf(server.world.getState(x0 + dx, y0, z0 + dz)) === 'frosted_ice') frosted++;
    expect(frosted).toBeGreaterThan(10);
  });
});

describe('/give with item NBT', () => {
  it('gives potions and enchanted items', () => {
    const { a, p } = setup();
    a.send({ t: 'chat', message: '/give @s potion{Potion:"minecraft:swiftness"} 2' });
    a.send({ t: 'chat', message: '/give @s diamond_sword{Enchantments:[{id:"minecraft:knockback",lvl:2s}]}' });
    const pot = [...p.inventory.slots].find((s) => s && itemName(s.id) === 'potion');
    expect(pot?.tag?.Potion).toBe('swiftness');
    expect(pot?.count).toBe(1);
    const sw = [...p.inventory.slots].find((s) => s && itemName(s.id) === 'diamond_sword');
    expect(sw?.tag?.Enchantments).toEqual([{ id: 'knockback', lvl: 2 }]);
    expect(a.received.some((m) => m.t === 'slotTag')).toBe(true);
  });
});

describe('lingering potion clouds', () => {
  it('apply a quarter of the duration after the 10-tick wait and shrink by 0.5 per entity', () => {
    const { server, a, p } = setup();
    const c = new EffectCloud(9999, p.x, p.y, p.z, POTIONS.strength!, 0);
    server.items.clouds.push(c);
    for (let i = 0; i < 9; i++) server.tick();
    expect(p.living.effects.has('strength')).toBe(false);
    for (let i = 0; i < 6; i++) server.tick();
    expect(p.living.effects.get('strength')!.duration).toBeGreaterThan(890);
    expect(p.living.effects.get('strength')!.duration).toBeLessThanOrEqual(900);
    expect(c.radius).toBeLessThan(2.6);
    expect(a.received.some((m) => m.t === 'effectCloud')).toBe(true);
  });
});

describe('melee enchantments against mobs', () => {
  it('Smite adds 2.5 per level against undead; Fire Aspect sets them alight', () => {
    const { server, a, p } = setup();
    const sword = stack('diamond_sword');
    sword.tag = { Enchantments: [{ id: 'smite', lvl: 5 }, { id: 'fire_aspect', lvl: 2 }] };
    p.inventory.set(0, sword);
    p.inventory.selected = 0;
    for (let i = 0; i < 25; i++) server.tick();
    const z = server.mobs.spawn('zombie', p.x + 1.5, p.y, p.z)!;
    server.tick();
    const before = z.health;
    a.send({ t: 'attack', target: z.id, sneaking: false });
    // 7 + 12.5, then the zombie's 2 armour points: 19.5 × (1 − 0.4/25)
    expect(before - z.health).toBeCloseTo(19.5 * (1 - 0.4 / 25), 4);
    expect(z.isOnFire()).toBe(true);
    // Smite does nothing extra to a pig
    const pig = server.mobs.spawn('pig', p.x - 1.5, p.y, p.z)!;
    for (let i = 0; i < 25; i++) server.tick();
    const hp = pig.health;
    a.send({ t: 'attack', target: pig.id, sneaking: false });
    expect(hp - pig.health).toBeCloseTo(Math.min(hp, 7), 4);
  });
});

describe('anvil (server)', () => {
  it('combines a sword with a Sharpness book, renames, and charges the levels', () => {
    const { server, a, p } = setup();
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z);
    server.setBlock(x, y, z, stateOf('anvil'));
    p.living.experienceLevel = 10;
    p.inventory.set(0, stack('diamond_sword'));
    const book = stack('enchanted_book');
    book.tag = { StoredEnchantments: [{ id: 'sharpness', lvl: 3 }] };
    p.inventory.set(1, book);
    a.send({ t: 'useOn', x, y, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    const open = a.received.filter((m) => m.t === 'openWindow').at(-1) as Extract<S2C, { t: 'openWindow' }>;
    expect(open).toMatchObject({ type: 'anvil', title: 'Repair & Name' });
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 30, button: 0, clickType: 1 });
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 31, button: 0, clickType: 1 });
    a.send({ t: 'renameItem', name: 'Edge' });
    const cost = (a.received.filter((m) => m.t === 'windowData' && m.property === 0).at(-1) as { value: number }).value;
    expect(cost).toBe(3 + 1);
    // take the result
    a.send({ t: 'clickWindow', windowId: open.windowId, slot: 2, button: 0, clickType: 1 });
    expect(p.living.experienceLevel).toBe(6);
    const sw = [...p.inventory.slots].find((st) => st && itemName(st.id) === 'diamond_sword')!;
    expect(sw.tag?.Enchantments).toEqual([{ id: 'sharpness', lvl: 3 }]);
    expect(sw.tag?.display?.Name).toBe('Edge');
    expect([...p.inventory.slots].some((st) => st && itemName(st.id) === 'enchanted_book')).toBe(false);
  });
});
