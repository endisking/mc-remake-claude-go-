import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf, getProp } from '@shared/world/blockstate';
import { ITEMS_BY_NAME } from '@shared/data';
import { soundName } from '@shared/sound/events';
import { Arrow } from './arrow';
import { ItemEntity } from './entity';

const id = (n: string) => ITEMS_BY_NAME.get(n)!.id;

function setup(players = 1) {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, randomSeed: 1n });
  const clients = [];
  for (let i = 0; i < players; i++) {
    const received: S2C[] = [];
    const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
    const recv = server.connect(conn);
    recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: `P${i}`, viewDistance: 2, skin: '' }));
    clients.push({ received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)) });
  }
  for (let i = 0; i < 3; i++) server.tick();
  // past the spawn invulnerability
  for (const p of server.players) p.living.spawnInvulnerableTime = 0;
  return { server, clients, p: server.players[0]!, c: clients[0]! };
}

const sounds = (r: S2C[]) => r.filter((x) => x.t === 'sound').map((x) => soundName((x as Extract<S2C, { t: 'sound' }>).event));

describe('eating', { timeout: 60000 }, () => {
  it('takes 32 ticks, feeds and returns the bowl from stew', () => {
    const { server, p, c } = setup();
    p.living.food.foodLevel = 10;
    p.living.food.saturationLevel = 0;
    p.inventory.set(0, { id: id('mushroom_stew'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    expect(server.items.isUsing(p)).toBe(true);
    for (let i = 0; i < 31; i++) server.tick();
    expect(p.living.food.foodLevel).toBe(10);
    server.tick();
    expect(p.living.food.foodLevel).toBe(16);
    expect(p.living.food.saturationLevel).toBeCloseTo(7.2, 4);
    expect(p.inventory.get(0)?.id).toBe(id('bowl'));
    expect(c.received.some((x) => x.t === 'entityEvent' && x.event === 9)).toBe(true);
    expect(sounds(c.received)).toContain('entity.player.burp');
  });

  it('dried kelp takes 16 ticks; full players cannot eat bread but can eat golden apples', () => {
    const { server, p, c } = setup();
    p.living.food.foodLevel = 19;
    p.inventory.set(0, { id: id('dried_kelp'), count: 2, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 16; i++) server.tick();
    expect(p.inventory.get(0)?.count).toBe(1);
    expect(p.living.food.foodLevel).toBe(20);
    p.inventory.set(0, { id: id('bread'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    expect(server.items.isUsing(p)).toBe(false);
    p.inventory.set(0, { id: id('golden_apple'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 32; i++) server.tick();
    expect(p.living.effects.get('regeneration')).toMatchObject({ amplifier: 1 });
    expect(p.living.absorption).toBe(4);
    expect(c.received.some((x) => x.t === 'mobEffect')).toBe(true);
    expect(c.received.some((x) => x.t === 'absorption' && x.amount === 4)).toBe(true);
  });

  it('a click that arrives just before the previous bite finishes keeps eating', () => {
    const { server, p, c } = setup();
    p.living.food.foodLevel = 2;
    p.inventory.set(0, { id: id('bread'), count: 2, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 31; i++) server.tick();
    c.send({ t: 'useItem', hand: 0 });
    server.tick();
    expect(p.inventory.get(0)?.count).toBe(1);
    expect(server.items.isUsing(p)).toBe(true);
    for (let i = 0; i < 32; i++) server.tick();
    expect(p.inventory.get(0)).toBeNull();
    expect(p.living.food.foodLevel).toBe(12);
  });

  it('switching slots interrupts eating; milk clears effects', () => {
    const { server, p, c } = setup();
    p.living.food.foodLevel = 5;
    p.inventory.set(0, { id: id('bread'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    server.tick();
    c.send({ t: 'heldSlot', slot: 1 });
    server.tick();
    expect(server.items.isUsing(p)).toBe(false);
    p.living.effects.add('poison', 200, 0, server.items.effectTarget(p));
    p.inventory.set(1, { id: id('milk_bucket'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 32; i++) server.tick();
    expect(p.living.effects.active.size).toBe(0);
    expect(p.inventory.get(1)?.id).toBe(id('bucket'));
  });
});

describe('durability', { timeout: 60000 }, () => {
  it('pickaxe loses 1 per mined block and breaks with the break event', () => {
    const { server, p } = setup();
    const x = Math.floor(p.x), z = Math.floor(p.z), y = Math.floor(p.y) - 1;
    server.setBlock(x, y, z, stateOf('stone'));
    server.setBlock(x + 1, y, z, stateOf('stone'));
    p.inventory.set(0, { id: id('golden_pickaxe'), count: 1, damage: 30 });
    server.destroyBlock(x, y, z, p, true);
    expect(p.inventory.get(0)?.damage).toBe(31);
    server.destroyBlock(x + 1, y, z, p, true);
    expect(p.inventory.get(0)).toBeNull();
  });

  it('armour reduces damage and loses durability', () => {
    const { server, p } = setup();
    p.inventory.set(38, { id: id('iron_chestplate'), count: 1, damage: 0 });
    p.inventory.set(37, { id: id('iron_leggings'), count: 1, damage: 0 });
    // 11 armour vs 8 damage: 11 - 8/2 = 7 → 28% reduction
    server.survival.hurt(p, { id: 'generic-test' }, 8);
    expect(p.living.health).toBeCloseTo(20 - 8 * (1 - 7 / 25), 4);
    expect(p.inventory.get(38)?.damage).toBe(2);
    // bypass-armour sources ignore it
    p.living.invulnerableTime = 0;
    const h = p.living.health;
    server.survival.hurt(p, { id: 'starve', bypassArmor: true }, 1);
    expect(p.living.health).toBeCloseTo(h - 1, 4);
  });

  it('right-click equips armour into an empty slot', () => {
    const { server, p, c } = setup();
    p.inventory.set(0, { id: id('diamond_helmet'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    expect(p.inventory.get(39)?.id).toBe(id('diamond_helmet'));
    expect(p.inventory.get(0)).toBeNull();
    expect(server.items.armorOf(p).armor).toBe(3);
  });
});

describe('buckets and flint and steel', { timeout: 60000 }, () => {
  it('places and picks up water sources', () => {
    const { server, p, c } = setup();
    p.pitch = 90;
    p.inventory.set(0, { id: id('water_bucket'), count: 1, damage: 0 });
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    c.send({ t: 'useItem', hand: 0 });
    expect(blockNameOf(server.world.getState(x, y, z))).toBe('water');
    expect(p.inventory.get(0)?.id).toBe(id('bucket'));
    c.send({ t: 'useItem', hand: 0 });
    expect(server.world.getState(x, y, z)).toBe(0);
    expect(p.inventory.get(0)?.id).toBe(id('water_bucket'));
    expect(sounds(c.received)).toEqual(expect.arrayContaining(['item.bucket.empty', 'item.bucket.fill']));
  });

  it('flint and steel lights fire on the ground and wears', () => {
    const { server, p, c } = setup();
    const x = Math.floor(p.x) + 2, z = Math.floor(p.z), y = Math.floor(p.y) - 1;
    server.setBlock(x, y, z, stateOf('stone'));
    server.setBlock(x, y + 1, z, 0);
    p.inventory.set(0, { id: id('flint_and_steel'), count: 1, damage: 0 });
    c.send({ t: 'useOn', x, y, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    expect(blockNameOf(server.world.getState(x, y + 1, z))).toBe('fire');
    expect(p.inventory.get(0)?.damage).toBe(1);
  });
});

describe('shears', { timeout: 60000 }, () => {
  it('carve pumpkins (4 seeds) and wear by 1 per block', () => {
    const { server, p, c } = setup();
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z);
    server.setBlock(x, y, z, stateOf('pumpkin'));
    p.inventory.set(0, { id: id('shears'), count: 1, damage: 0 });
    c.send({ t: 'useOn', x, y, z, face: 4, cx: 0, cy: 0.5, cz: 0.5, hand: 0 });
    expect(blockNameOf(server.world.getState(x, y, z))).toBe('carved_pumpkin');
    expect(getProp(server.world.getState(x, y, z), 'facing')).toBe('west');
    expect([...server.entities.values()].some((e) => e instanceof ItemEntity && e.stack.id === id('pumpkin_seeds') && e.stack.count === 4)).toBe(true);
    server.setBlock(x, y + 1, z, stateOf('oak_leaves'));
    server.destroyBlock(x, y + 1, z, p, true);
    expect(p.inventory.get(0)?.damage).toBe(2);
    // shears keep the leaves
    expect([...server.entities.values()].some((e) => e instanceof ItemEntity && e.stack.id === id('oak_leaves'))).toBe(true);
  });
});

describe('bow', { timeout: 60000 }, () => {
  it('a full draw shoots a critical arrow at speed 3 and uses an arrow', () => {
    const { server, p, c } = setup();
    p.inventory.set(0, { id: id('bow'), count: 1, damage: 0 });
    p.inventory.set(5, { id: id('arrow'), count: 3, damage: 0 });
    p.pitch = -10;
    c.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 25; i++) server.tick();
    c.send({ t: 'releaseUseItem' });
    const arrows = [...server.entities.values()].filter((e) => e instanceof Arrow) as Arrow[];
    expect(arrows.length).toBe(1);
    expect(arrows[0]!.crit).toBe(true);
    expect(Math.hypot(arrows[0]!.vx, arrows[0]!.vy, arrows[0]!.vz)).toBeCloseTo(3, 1);
    expect(p.inventory.get(5)?.count).toBe(2);
    expect(p.inventory.get(0)?.damage).toBe(1);
    // it flies, lands and sticks
    for (let i = 0; i < 100; i++) server.tick();
    expect(arrows[0]!.inGround || arrows[0]!.removed).toBe(true);
  });

  it('a tap does not shoot and nothing happens without arrows', () => {
    const { server, p, c } = setup();
    p.inventory.set(0, { id: id('bow'), count: 1, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    expect(server.items.isUsing(p)).toBe(false);
    p.inventory.set(5, { id: id('arrow'), count: 3, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    server.tick();
    c.send({ t: 'releaseUseItem' });
    expect([...server.entities.values()].some((e) => e instanceof Arrow)).toBe(false);
  });

  it('arrows hurt other players', () => {
    const { server, clients } = setup(2);
    const [a, b] = server.players as [typeof server.players[0], typeof server.players[0]];
    b.x = a.x;
    b.z = a.z + 6;
    b.y = a.y;
    a.yaw = 0;
    a.pitch = 0;
    a.inventory.set(0, { id: id('bow'), count: 1, damage: 0 });
    a.inventory.set(1, { id: id('arrow'), count: 1, damage: 0 });
    clients[0]!.send({ t: 'useItem', hand: 0 });
    for (let i = 0; i < 20; i++) server.tick();
    clients[0]!.send({ t: 'releaseUseItem' });
    for (let i = 0; i < 10; i++) server.tick();
    expect(b.living.health).toBeLessThan(20);
    // 3 blocks/tick × 2 base damage = 6, crit adds 0–4
    expect(20 - b.living.health).toBeGreaterThanOrEqual(5);
  });
});

describe('thrown items', { timeout: 60000 }, () => {
  it('an ender pearl teleports its thrower and costs 5 fall damage', () => {
    const { server, p, c } = setup();
    const x0 = p.x, z0 = p.z, y = Math.floor(p.y);
    // a wall 6 blocks ahead (+Z at yaw 0)
    for (let dy = -1; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) server.setBlock(Math.floor(x0) + dx, y + dy, Math.floor(z0) + 6, stateOf('stone'));
    p.yaw = 0;
    p.pitch = 0;
    p.inventory.set(0, { id: id('ender_pearl'), count: 2, damage: 0 });
    c.send({ t: 'useItem', hand: 0 });
    expect(p.inventory.get(0)?.count).toBe(1);
    // cooldown: a second throw right away does nothing
    c.send({ t: 'useItem', hand: 0 });
    expect(p.inventory.get(0)?.count).toBe(1);
    for (let i = 0; i < 10; i++) server.tick();
    expect(p.z).toBeGreaterThan(z0 + 3);
    expect(p.z).toBeLessThan(Math.floor(z0) + 6);
    expect(p.living.health).toBe(15);
  });
});

describe('shields', { timeout: 60000 }, () => {
  it('a raised shield blocks a frontal hit after 5 ticks; an axe disables it', () => {
    const { server, clients } = setup(2);
    const [a, b] = server.players as [typeof server.players[0], typeof server.players[0]];
    // b stands 2 blocks south of a, facing north toward a
    b.x = a.x; b.y = a.y; b.z = a.z + 2;
    b.yaw = 180; b.pitch = 0;
    b.inventory.set(40, { id: id('shield'), count: 1, damage: 0 });
    clients[1]!.send({ t: 'useItem', hand: 1 });
    for (let i = 0; i < 5; i++) server.tick();
    expect(server.items.isBlocking(b)).toBe(true);
    a.inventory.set(0, { id: id('iron_sword'), count: 1, damage: 0 });
    a.attackStrengthTicker = 100;
    clients[0]!.send({ t: 'attack', target: b.id, sneaking: false });
    expect(b.living.health).toBe(20);
    expect(b.inventory.get(40)?.damage).toBe(7); // 1 + floor(6)
    a.inventory.set(0, { id: id('iron_axe'), count: 1, damage: 0 });
    a.attackStrengthTicker = 100;
    server.tick();
    a.attackStrengthTicker = 100;
    clients[0]!.send({ t: 'attack', target: b.id, sneaking: false });
    expect(server.items.isUsing(b)).toBe(false);
    clients[1]!.send({ t: 'useItem', hand: 1 });
    expect(server.items.isUsing(b)).toBe(false); // cooldown
  });
});

describe('totem of undying', { timeout: 60000 }, () => {
  it('saves a dying player from the off hand, not from the void', () => {
    const { server, p } = setup();
    p.inventory.set(40, { id: id('totem_of_undying'), count: 1, damage: 0 });
    server.survival.hurt(p, { id: 'generic', bypassArmor: true }, 50);
    expect(p.living.dead).toBe(false);
    expect(p.living.health).toBe(1);
    expect(p.inventory.get(40)).toBeNull();
    expect(p.living.effects.get('regeneration')).toMatchObject({ amplifier: 1, duration: 900 });
    expect(p.living.absorption).toBe(8);
    p.inventory.set(0, { id: id('totem_of_undying'), count: 1, damage: 0 });
    p.living.invulnerableTime = 0;
    server.survival.hurt(p, { id: 'outOfWorld', bypassArmor: true, bypassInvul: true }, 100);
    expect(p.living.dead).toBe(true);
  });
});

describe('item entities', { timeout: 60000 }, () => {
  it('burn in lava', () => {
    const { server, p } = setup();
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y), z = Math.floor(p.z);
    server.setBlock(x, y, z, stateOf('lava'));
    server.popResource(x, y, z, { id: id('stick'), count: 1, damage: 0 });
    const e = [...server.entities.values()].find((v) => v instanceof ItemEntity)!;
    for (let i = 0; i < 5; i++) server.tick();
    expect(e.removed || !server.entities.has(e.id)).toBe(true);
    void getProp;
  });
});
