import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { stateOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME } from '@shared/data';
import { Pillager, Vindicator } from './illagers';
import { itemName } from '@shared/item/stack';
import { Villager } from './villager';

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

describe('pillagers and vindicators', () => {
  it('spawn with a crossbow / iron axe; 24 HP; vindicator hits for 5 + axe', () => {
    const { server } = setup();
    const pl = server.mobs.spawn('pillager', 5.5, 64, 5.5, 'command') as Pillager;
    const v = server.mobs.spawn('vindicator', 7.5, 64, 5.5, 'command') as Vindicator;
    expect(pl.maxHealth).toBe(24);
    expect(itemName(pl.mainHand!.id)).toBe('crossbow');
    expect(itemName(v.mainHand!.id)).toBe('iron_axe');
    expect(v.meleeDamage()).toBe(13);
  });

  it('a pillager charges its crossbow and shoots a survival player within range', () => {
    const { server, p } = setup();
    const pl = server.mobs.spawn('pillager', p.x + 6, 64, p.z, 'command') as Pillager;
    const hp = p.living.health;
    for (let i = 0; i < 200 && p.living.health === hp; i++) server.tick();
    expect(pl.target).toBe(p);
    expect(p.living.health).toBeLessThan(hp);
  });

  it('vindicators go after villagers', () => {
    const { server, p } = setup();
    p.gameMode = 1;
    const v = server.mobs.spawn('vindicator', 10.5, 64, 10.5, 'command') as Vindicator;
    const vil = server.mobs.spawn('villager', 13.5, 64, 10.5, 'command') as Villager;
    for (let i = 0; i < 100 && !v.target; i++) server.tick();
    expect(v.target).toBe(vil);
  });
});
