import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf } from '@shared/world/blockstate';
import { EndCrystal, EnderDragon, DragonPhase, DragonFireball } from './dragon';

function setup() {
  const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true });
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn, true);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 2, skin: '' }));
  for (let i = 0; i < 3; i++) server.tick();
  const p = server.players[0]!;
  p.gameMode = 0;
  const dragon = server.mobs.spawn('ender_dragon', p.x + 10, p.y + 20, p.z, 'command') as EnderDragon;
  dragon.host = { fountainTop: () => Math.floor(p.y) + 19, previouslyKilled: () => false, onDragonKilled: () => {} };
  dragon.setPhase(DragonPhase.SITTING_SCANNING);
  return { server, p, dragon, received };
}

describe('end crystals', () => {
  it('heal a dragon within 32 blocks, 1 HP every 10 ticks, and beam at it', () => {
    const { server, dragon } = setup();
    const c = server.mobs.spawn('end_crystal', dragon.x + 10, dragon.y, dragon.z, 'command') as EndCrystal;
    expect(c).toBeInstanceOf(EndCrystal);
    dragon.health = 100;
    for (let i = 0; i < 60; i++) server.tick();
    expect(dragon.nearestCrystal).toBe(c);
    expect(c.beamTarget).toBe(dragon.id);
    expect(dragon.health).toBeGreaterThan(101);
    expect(dragon.health).toBeLessThanOrEqual(106);
  });

  it('explode when hit, hurting the dragon they were healing by 10', () => {
    const { server, p, dragon } = setup();
    const c = server.mobs.spawn('end_crystal', dragon.x + 10, dragon.y, dragon.z, 'command') as EndCrystal;
    for (let i = 0; i < 60; i++) server.tick();
    expect(dragon.nearestCrystal).toBe(c);
    dragon.invulnerableTime = 0;
    const hp = dragon.health;
    expect(c.hurt({ id: 'player' }, 1, p)).toBe(true);
    expect(c.removed).toBe(true);
    expect(dragon.health).toBe(hp - 10);
    // the dragon can't blow crystals up
    const c2 = server.mobs.spawn('end_crystal', dragon.x - 10, dragon.y, dragon.z, 'command') as EndCrystal;
    expect(c2.hurt({ id: 'mob' }, 5, dragon)).toBe(false);
    expect(c2.removed).toBe(false);
  });
});

describe('ender dragon', () => {
  it('has 200 HP, breaks non-immune blocks it flies through, keeps obsidian', () => {
    const { server, dragon } = setup();
    expect(dragon.health).toBe(200);
    const x = Math.floor(dragon.x), y = Math.floor(dragon.y) + 1, z = Math.floor(dragon.z);
    server.setBlock(x, y, z, stateOf('stone'));
    server.setBlock(x + 1, y, z, stateOf('obsidian'));
    server.tick();
    expect(server.world.getState(x, y, z)).toBe(0);
    expect(blockNameOf(server.world.getState(x + 1, y, z))).toBe('obsidian');
  });

  it('shoots fireballs that burst into breath clouds', () => {
    const { server, p, dragon } = setup();
    const f = dragon.shootFireball(p);
    expect(f).toBeInstanceOf(DragonFireball);
    const before = server.items.clouds.length;
    for (let i = 0; i < 100 && !f.removed; i++) server.tick();
    expect(f.removed).toBe(true);
    expect(server.items.clouds.length).toBe(before + 1);
    expect(server.items.clouds[before]!.effects[0]!.effect).toBe('instant_damage');
  });

  it('sends boss bar add / update / remove packets', () => {
    const { server, dragon, received } = setup();
    server.tick();
    server.tick();
    const ev = () => received.filter((m) => m.t === 'bossEvent') as Extract<S2C, { t: 'bossEvent' }>[];
    expect(ev()[0]).toMatchObject({ op: 0, id: dragon.id, progress: 1 });
    dragon.hurt({ id: 'player' }, 50, server.players[0]!);
    server.tick();
    expect(ev().pop()).toMatchObject({ op: 2, progress: 0.75 });
    dragon.invulnerableTime = 0;
    dragon.hurt({ id: 'player' }, 500, server.players[0]!);
    for (let i = 0; i < 205; i++) server.tick();
    expect(dragon.removed).toBe(true);
    expect(ev().pop()!.op).toBe(1);
  });
});
