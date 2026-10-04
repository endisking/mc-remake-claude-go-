import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { stateOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME } from '@shared/data';
import { stack } from '@shared/item/stack';
import type { Horse } from './mobs/horse';
import type { Pig } from './mobs/animals';
import { PLAYER_RIDING_OFFSET } from './riding';

class FlatGen {
  generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    c.biomes.fill(BIOMES_BY_NAME.get('plains')!.id);
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 63; y++) c.setState(x, y, z, stateOf('stone'));
        c.setState(x, 63, z, stateOf('grass_block', { snowy: false }));
      }
    c.computeHeightmaps();
    return c;
  }
}

function setup() {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 100, defaultGameMode: 0, devTerrain: true, randomSeed: 42n, spawnMobs: false });
  (server as unknown as { level: { generator: FlatGen } }).level.generator = new FlatGen();
  server.doDaylightCycle = false;
  server.dayTime = 6000;
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  const send = (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p));
  send({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' });
  const p = server.players[0]!;
  send({ t: 'chat', message: '/tp 0.5 64 0.5' });
  send({ t: 'move', x: 0.5, y: 64, z: 0.5, yaw: 0, pitch: 0, onGround: true });
  for (let i = 0; i < 61; i++) server.tick();
  return { server, p, send, received };
}

const steer = (forward: number, extra: Partial<{ strafe: number; jump: boolean; sneak: boolean; jumpPower: number }> = {}) =>
  ({ t: 'steerVehicle' as const, forward, strafe: extra.strafe ?? 0, jump: extra.jump ?? false, sneak: extra.sneak ?? false, jumpPower: extra.jumpPower ?? -1 });

function tamedSaddledHorse(server: GameServer, x: number, z: number, speed: number, jump: number): Horse {
  const h = server.mobs.spawn('horse', x, 64, z, 'command') as Horse;
  h.tame = true;
  h.saddled = true;
  h.movementSpeed = speed;
  h.jumpStrength = jump;
  return h;
}

/** LivingEntity.travel terminal ground distance per tick on a 0.6-friction block for input 0.98 × `input`: a / (1 − 0.546). */
function terminal(speed: number, input = 1): number {
  const f = 0.6 * 0.91;
  return (speed * 0.98 * input * (0.21600002 / (0.6 * 0.6 * 0.6))) / (1 - f);
}

describe('riding', () => {
  it('mounting sends setPassengers, the rider sits on the seat, sneaking dismounts beside the horse', () => {
    const { server, p, send, received } = setup();
    const h = tamedSaddledHorse(server, p.x + 1.5, p.z, 0.225, 0.7);
    server.tick();
    received.length = 0;
    send({ t: 'interactEntity', id: h.id, hand: 0 });
    expect(server.riding.vehicle(p)).toBe(h);
    const sp = received.find((m) => m.t === 'setPassengers') as Extract<S2C, { t: 'setPassengers' }> | undefined;
    expect(sp).toBeTruthy();
    expect(sp!.vehicle).toBe(h.id);
    expect(sp!.passengers).toEqual([p.id]);
    server.tick();
    // seat: vehicle y + bbHeight × 0.75 + Player.getMyRidingOffset (−0.35)
    expect(p.x).toBeCloseTo(h.x, 6);
    expect(p.y).toBeCloseTo(h.y + 1.6 * 0.75 + PLAYER_RIDING_OFFSET, 6);
    // client moves while riding are ignored (position comes from the seat)
    send({ t: 'move', x: p.x + 5, y: p.y, z: p.z, yaw: 90, pitch: 0, onGround: true });
    server.tick();
    expect(p.x).toBeCloseTo(h.x, 6);
    received.length = 0;
    send(steer(0, { sneak: true }));
    expect(server.riding.vehicle(p)).toBeNull();
    const off = received.find((m) => m.t === 'setPassengers') as Extract<S2C, { t: 'setPassengers' }>;
    expect(off.passengers).toEqual([]);
    expect(received.some((m) => m.t === 'teleport')).toBe(true);
    expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeGreaterThan(0.9);
    expect(p.y).toBeCloseTo(64, 3);
  });

  it('a steered horse reaches the terminal speed of its movement speed attribute, facing the rider', () => {
    const { server, p, send } = setup();
    const h = tamedSaddledHorse(server, p.x + 1.5, p.z, 0.3, 0.7);
    server.tick();
    send({ t: 'interactEntity', id: h.id, hand: 0 });
    send({ t: 'move', x: p.x, y: p.y, z: p.z, yaw: -90, pitch: 0, onGround: false }); // face +X
    for (let i = 0; i < 40; i++) {
      send(steer(1));
      server.tick();
    }
    expect(h.yaw).toBeCloseTo(-90, 3);
    let x0 = h.x;
    for (let i = 0; i < 20; i++) {
      send(steer(1));
      server.tick();
    }
    expect((h.x - x0) / 20).toBeCloseTo(terminal(0.3), 3);
    expect(p.x).toBeCloseTo(h.x, 6);
    // backwards: a quarter of the input
    for (let i = 0; i < 60; i++) {
      send(steer(-1));
      server.tick();
    }
    x0 = h.x;
    for (let i = 0; i < 20; i++) {
      send(steer(-1));
      server.tick();
    }
    expect((h.x - x0) / 20).toBeCloseTo(-terminal(0.3, 0.25), 3);
  });

  it('a charged jump uses jump strength × the pending scale (power ≥ 90 → full)', () => {
    const { server, p, send } = setup();
    const h = tamedSaddledHorse(server, p.x + 1.5, p.z, 0.2, 0.8);
    server.tick();
    send({ t: 'interactEntity', id: h.id, hand: 0 });
    for (let i = 0; i < 10; i++) server.tick();
    expect(h.onGround).toBe(true);
    send(steer(0, { jumpPower: 100 }));
    const y0 = h.y;
    let peak = y0;
    for (let i = 0; i < 30; i++) {
      server.tick();
      peak = Math.max(peak, h.y);
    }
    let vy = 0.8, y = 0, top = 0;
    for (let i = 0; i < 30; i++) {
      y += vy;
      top = Math.max(top, y);
      vy = (vy - 0.08) * 0.98;
    }
    expect(peak - y0).toBeCloseTo(top, 1);
    h.onPlayerJump(45);
    expect(h.playerJumpPendingScale).toBeCloseTo(0.6, 6);
  });

  it('untamed horses buck the rider off, raising temper by 5 (or accept them)', () => {
    const { server, p, send } = setup();
    const h = server.mobs.spawn('horse', p.x + 1.5, 64, p.z, 'command') as Horse;
    server.tick();
    send({ t: 'interactEntity', id: h.id, hand: 0 });
    expect(server.riding.vehicle(p)).toBe(h);
    let t = 0;
    while (server.riding.vehicle(p) && !h.tame && t++ < 3000) server.tick();
    expect(h.tame || h.temper === 5).toBe(true);
  });

  it('pigs: saddled pigs are mounted; a carrot on a stick steers (speed × 0.225) and boosts for 7 durability', () => {
    const { server, p, send } = setup();
    const pig = server.mobs.spawn('pig', p.x + 1.5, 64, p.z, 'command') as Pig;
    pig.saddled = true;
    server.tick();
    send({ t: 'interactEntity', id: pig.id, hand: 0 });
    expect(server.riding.vehicle(p)).toBe(pig);
    p.inventory.set(p.inventory.selected, stack('carrot_on_a_stick'));
    send({ t: 'move', x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, onGround: false }); // face +Z
    for (let i = 0; i < 40; i++) server.tick();
    const z0 = pig.z;
    for (let i = 0; i < 20; i++) server.tick();
    expect((pig.z - z0) / 20).toBeCloseTo(terminal(0.25 * 0.225, 1 / 0.98), 3);
    send({ t: 'useItem', hand: 0 });
    expect(pig.boosting).toBe(true);
    expect(pig.boostTimeTotal).toBeGreaterThanOrEqual(140);
    expect(p.inventory.get(p.inventory.selected)!.damage).toBe(7);
  });
});
