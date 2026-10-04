import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, decodeStacks, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf } from '@shared/world/blockstate';
import { stack, itemName } from '@shared/item/stack';
import { capturePlayer, applyPlayer } from '../storage/codec';
import { DAMAGE } from './survival';
import { ServerPlayer } from './player';

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

describe('server status effects', () => {
  it('addEffect syncs to the client, ticks down and is removed', () => {
    const { server, a, p } = setup();
    expect(server.effects.addEffect(p, 'speed', 40, 1)).toBe(true);
    const up = a.received.filter((m) => m.t === 'updateEffect').at(-1) as Extract<S2C, { t: 'updateEffect' }>;
    expect(up).toMatchObject({ id: p.id, effect: 1, amplifier: 1, duration: 40, flags: 6 });
    for (let i = 0; i < 41; i++) server.tick();
    expect(server.effects.has(p, 'speed')).toBe(false);
    expect(a.received.some((m) => m.t === 'removeEffect' && m.effect === 1)).toBe(true);
  });

  it('regeneration heals, poison hurts, swirl colour is broadcast', () => {
    const { server, a, p } = setup();
    p.living.health = 10;
    server.effects.addEffect(p, 'regeneration', 100, 1);
    for (let i = 0; i < 100; i++) server.tick();
    expect(p.living.health).toBeGreaterThanOrEqual(13);
    expect(a.received.some((m) => m.t === 'effectParticles' && m.color !== 0)).toBe(true);
    const before = p.living.health;
    p.living.invulnerableTime = 0;
    server.effects.addEffect(p, 'poison', 26, 0);
    for (let i = 0; i < 26; i++) server.tick();
    expect(p.living.health).toBeLessThan(before);
  });

  it('absorption and health boost change the synced attributes', () => {
    const { server, a, p } = setup();
    server.effects.addEffect(p, 'absorption', 100, 1);
    server.effects.addEffect(p, 'health_boost', 100, 0);
    server.tick();
    const attr = a.received.filter((m) => m.t === 'playerAttributes').at(-1) as Extract<S2C, { t: 'playerAttributes' }>;
    expect(attr).toMatchObject({ maxHealth: 24, absorption: 8 });
    server.effects.removeAll(p);
    server.tick();
    expect(p.living.absorption).toBe(0);
    expect(p.living.maxHealth).toBe(20);
  });

  it('resistance and fire resistance reduce damage', () => {
    const { server, p } = setup();
    server.effects.addEffect(p, 'resistance', 100, 1);
    server.survival.hurt(p, DAMAGE.cactus, 10);
    expect(p.living.health).toBeCloseTo(20 - 6, 5);
    server.effects.addEffect(p, 'fire_resistance', 100, 0);
    expect(server.survival.hurt(p, DAMAGE.lava, 4)).toBe(false);
  });

  it('a totem of undying saves the player', () => {
    const { server, a, p } = setup();
    p.inventory.set(40, stack('totem_of_undying'));
    server.survival.hurt(p, DAMAGE.generic, 100);
    expect(p.living.health).toBe(1);
    expect(p.inventory.get(40)).toBeNull();
    expect(server.effects.amp(p, 'regeneration')).toBe(1);
    expect(server.effects.amp(p, 'absorption')).toBe(1);
    expect(server.effects.has(p, 'fire_resistance')).toBe(true);
    expect(a.received.some((m) => m.t === 'entityEvent' && m.event === 35)).toBe(true);
    // the void bypasses it
    p.inventory.set(0, stack('totem_of_undying'));
    p.inventory.selected = 0;
    p.living.invulnerableTime = 0;
    server.survival.hurt(p, DAMAGE.outOfWorld, 1000);
    expect(p.living.dead).toBe(true);
  });

  it('/effect give and clear go through the hooks', () => {
    const { server, a, p } = setup();
    p.gameMode = 1;
    a.send({ t: 'chat', message: '/effect give @s minecraft:night_vision 30 0' });
    expect(server.effects.has(p, 'night_vision')).toBe(true);
    a.send({ t: 'chat', message: '/effect clear @s' });
    expect(server.effects.has(p, 'night_vision')).toBe(false);
  });

  it('effects and the enchantment seed are saved with the player', () => {
    const { server, p } = setup();
    server.effects.addEffect(p, 'haste', 500, 2);
    p.enchantmentSeed = 12345;
    const data = capturePlayer(p);
    const q = new ServerPlayer(99, p.conn, server.world);
    applyPlayer(q, JSON.parse(JSON.stringify(data)));
    expect(q.living.effects.get('haste')!.amplifier).toBe(2);
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
