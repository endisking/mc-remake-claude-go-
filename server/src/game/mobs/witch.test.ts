import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { stateOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME } from '@shared/data';
import { Witch } from './witch';
import { ZombieVillager } from './monsters';

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

describe('witches', () => {
  it('throws slowness at a far player; the splash applies it; weakness splashes reach mobs', () => {
    const { server, p } = setup();
    const w = server.mobs.spawn('witch', p.x + 9, 64, p.z, 'command') as Witch;
    expect(w.maxHealth).toBe(26);
    server.tick();
    w.throwPotionAt(p, 9);
    for (let i = 0; i < 60 && !p.living.effects.has('slowness'); i++) server.tick();
    expect(p.living.effects.has('slowness')).toBe(true);
    const zv = server.mobs.spawn('zombie_villager', p.x + 3, 64, p.z + 3, 'command') as ZombieVillager;
    const e = { item: 0, ownerId: -1 } as never;
    server.items.splash(e, { x: zv.x, y: zv.y + 0.5, z: zv.z, target: null }, 'weakness');
    expect(zv.hasMobEffect('weakness')).toBe(true);
  });

  it('takes 15 % of magic damage', () => {
    const { server, p } = setup();
    const w = server.mobs.spawn('witch', p.x + 5, 64, p.z, 'command') as Witch;
    w.hurt({ id: 'indirectMagic', bypassArmor: true }, 10, null);
    expect(w.health).toBeCloseTo(26 - 1.5);
  });
});
