import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { stateOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME } from '@shared/data';
import { Horse, Donkey, Mule, breedResult } from './horse';

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
  return { server, p, send };
}

describe('horses, donkeys, mules', () => {
  it('random stats within vanilla ranges; donkeys have 0.175 speed and 0.5 jump', () => {
    const { server } = setup();
    for (let i = 0; i < 20; i++) {
      const h = server.mobs.spawn('horse', 3.5 + i, 64, 3.5, 'command') as Horse;
      expect(h.maxHealth).toBeGreaterThanOrEqual(15);
      expect(h.maxHealth).toBeLessThanOrEqual(30);
      expect(h.health).toBe(h.maxHealth);
      expect(h.movementSpeed).toBeGreaterThanOrEqual(0.1125);
      expect(h.movementSpeed).toBeLessThanOrEqual(0.3375);
      expect(h.jumpStrength).toBeGreaterThanOrEqual(0.4);
      expect(h.jumpStrength).toBeLessThanOrEqual(1);
      h.removed = true;
    }
    const d = server.mobs.spawn('donkey', 3.5, 64, 3.5, 'command') as Donkey;
    expect(d.movementSpeed).toBe(0.175);
    expect(d.jumpStrength).toBe(0.5);
  });

  it('mount attempts raise temper by 5 until the horse is tamed; then saddle and chest', () => {
    const { server, send, p } = setup();
    const h = server.mobs.spawn('horse', p.x + 1.5, 64, p.z, 'command') as Horse;
    server.tick();
    let tries = 0;
    while (!h.tame && tries < 100) {
      const before = h.temper;
      // riding: an empty hand mounts; the horse bucks (temper + 5) or accepts within ~50 ticks
      h.x = p.x + 1.5;
      h.z = p.z;
      send({ t: 'interactEntity', id: h.id, hand: 0 });
      expect(server.riding.vehicle(p)).toBe(h);
      let t = 0;
      while (server.riding.vehicle(p) && !h.tame && t++ < 2000) server.tick();
      tries++;
      if (!h.tame) expect(h.temper).toBe(Math.min(100, before + 5));
    }
    expect(h.tame).toBe(true);
    send({ t: 'steerVehicle', forward: 0, strafe: 0, jump: false, sneak: true, jumpPower: -1 });
    expect(server.riding.vehicle(p)).toBeNull();
    expect(h.ownerName).toBe('A');
    send({ t: 'chat', message: '/give @s saddle 1' });
    send({ t: 'interactEntity', id: h.id, hand: 0 });
    expect(h.saddled).toBe(true);
    const d = server.mobs.spawn('donkey', p.x - 1.5, 64, p.z, 'command') as Donkey;
    server.tick();
    send({ t: 'chat', message: '/give @s chest 1' });
    send({ t: 'interactEntity', id: d.id, hand: 0 });
    expect(d.hasChest).toBe(false); // untamed: a mount attempt instead
    d.tame = true;
    send({ t: 'interactEntity', id: d.id, hand: 0 });
    expect(d.hasChest).toBe(true);
  });

  it('feeding wheat raises temper by 3; horse × donkey breeds a mule; mules are sterile', () => {
    const { server, send, p } = setup();
    const h = server.mobs.spawn('horse', p.x + 1.5, 64, p.z, 'command') as Horse;
    server.tick();
    send({ t: 'chat', message: '/give @s wheat 1' });
    send({ t: 'interactEntity', id: h.id, hand: 0 });
    expect(h.temper).toBe(3);
    const d = server.mobs.spawn('donkey', 4.5, 64, 3.5, 'command') as Donkey;
    const m = server.mobs.spawn('mule', 5.5, 64, 3.5, 'command') as Mule;
    expect(breedResult(h, d)).toBe('mule');
    expect(breedResult(h, h)).toBe('horse');
    expect(breedResult(m, h)).toBeNull();
    h.tame = d.tame = true;
    h.setInLove(null);
    d.setInLove(null);
    expect(h.canMate(d)).toBe(true);
    h.breedWith(d);
    const foal = server.mobs.mobs().find((x) => x.type === 'mule' && x.isBaby()) as Mule | undefined;
    expect(foal).toBeTruthy();
    expect(foal!.maxHealth).toBeGreaterThanOrEqual(15);
  });
});
