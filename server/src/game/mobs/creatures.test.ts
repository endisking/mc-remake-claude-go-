import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { Chunk } from '@shared/world/chunk';
import { stateOf } from '@shared/world/blockstate';
import { BIOMES_BY_NAME } from '@shared/data';
import { Cat, Ocelot, PolarBear, Rabbit, Turtle } from './creatures';
import { mobLoot } from '@shared/game/mobloot';
import { itemName } from '@shared/item/stack';

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

describe('cats, ocelots, rabbits, polar bears, turtles', () => {
  it('cats tame with raw fish (1 in 3), then sit/stand on right-click', () => {
    const { server, send, p } = setup();
    const c = server.mobs.spawn('cat', p.x + 1.5, 64, p.z, 'command') as Cat;
    server.tick();
    send({ t: 'chat', message: '/give @s cod 64' });
    let n = 0;
    while (!c.tame && n < 60) {
      send({ t: 'interactEntity', id: c.id, hand: 0 });
      n++;
    }
    expect(c.tame).toBe(true);
    expect(c.ownerName).toBe('A');
    expect(c.orderedToSit).toBe(true);
    send({ t: 'chat', message: '/clear @s' });
    send({ t: 'interactEntity', id: c.id, hand: 0 });
    expect(c.orderedToSit).toBe(false);
  });

  it('ocelots gain trust with fish; stats of polar bears, rabbits, turtles', () => {
    const { server, send, p } = setup();
    const o = server.mobs.spawn('ocelot', p.x + 1.5, 64, p.z, 'command') as Ocelot;
    server.tick();
    send({ t: 'chat', message: '/give @s salmon 64' });
    for (let i = 0; i < 60 && !o.trusting; i++) send({ t: 'interactEntity', id: o.id, hand: 0 });
    expect(o.trusting).toBe(true);
    const b = server.mobs.spawn('polar_bear', 8.5, 64, 8.5, 'command') as PolarBear;
    expect(b.maxHealth).toBe(30);
    expect(b.attackDamage).toBe(6);
    expect((server.mobs.spawn('rabbit', 5.5, 64, 5.5, 'command') as Rabbit).maxHealth).toBe(3);
    expect((server.mobs.spawn('turtle', 6.5, 64, 6.5, 'command') as Turtle).maxHealth).toBe(30);
  });

  it('rabbit loot: hide, meat and the rare foot', () => {
    let feet = 0;
    for (let i = 0; i < 2000; i++) if (mobLoot('rabbit', { random: Math.random, killedByPlayer: true, looting: 0, onFire: false }).some((s) => itemName(s.id) === 'rabbit_foot')) feet++;
    expect(feet).toBeGreaterThan(120);
    expect(feet).toBeLessThan(290);
  });
});
