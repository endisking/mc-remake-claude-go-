import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Region, regionOf, regionFileName, parseRegionFileName } from './region';
import { writeZip, readZip, crc32 } from './zip';
import { encodeChunkRecord, decodeChunkRecord, capturePlayer, applyPlayer } from './codec';
import { MemoryStorage } from './memory';
import { DiskStorage } from './disk';
import { exportWorld, importWorld } from './archive';
import { Chunk } from '@shared/world/chunk';
import { stateOf } from '@shared/world/blockstate';
import { GameServer, HOST_PLAYER_KEY, AUTOSAVE_INTERVAL, type Connection } from '../game/server';
import { ServerPlayer } from '../game/player';
import { BlockWorld } from '@shared/world/world';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { ITEMS_BY_NAME } from '@shared/data';
import type { LevelMeta } from './types';

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

describe('region files', () => {
  it('round-trips chunks, including negative coordinates and multi-sector records', () => {
    const [rx, rz] = regionOf(-5, 40);
    expect([rx, rz]).toEqual([-1, 1]);
    const r = new Region(rx, rz);
    r.set(-5, 40, bytes(10, 1));
    r.set(-32, 32, bytes(9000, 2)); // three sectors
    r.set(-1, 63, bytes(1, 3));
    const enc = r.encode();
    expect(enc.length % 4096).toBe(0);
    const back = Region.decode(rx, rz, enc);
    expect(back.get(-5, 40)).toEqual(bytes(10, 1));
    expect(back.get(-32, 32)).toEqual(bytes(9000, 2));
    expect(back.get(-1, 63)).toEqual(bytes(1, 3));
    expect(back.get(-2, 63)).toBeNull();
    expect(back.coords().sort()).toEqual([[-32, 32], [-5, 40], [-1, 63]].sort());
    expect(parseRegionFileName(regionFileName(-1, 1))).toEqual([-1, 1]);
  });

  it('rejects files that are not region files', () => {
    expect(() => Region.decode(0, 0, new Uint8Array(9000))).toThrow();
  });
});

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips stored entries', async () => {
    const entries = [
      { name: 'w/level.json', data: new TextEncoder().encode('{"a":1}') },
      { name: 'w/region/r.0.0.bcr', data: bytes(20000, 5) },
      { name: 'w/empty', data: new Uint8Array(0) },
    ];
    const back = await readZip(writeZip(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) expect(back[i]!.data).toEqual(entries[i]!.data);
  });

  it('detects corruption', async () => {
    const z = writeZip([{ name: 'a', data: bytes(100, 1) }]);
    z[40] ^= 0xff;
    await expect(readZip(z)).rejects.toThrow();
  });
});

describe('chunk records', () => {
  it('keep blocks, light, heightmaps, generation stage and lit flag', async () => {
    const c = new Chunk(-3, 7);
    c.setState(1, 64, 2, stateOf('stone'));
    c.setState(15, 255, 15, stateOf('glowstone'));
    c.sections[4]!.setLight(5, 0x7a);
    c.stage = 2;
    c.lit = false;
    const rec = await encodeChunkRecord(c);
    const back = await decodeChunkRecord(rec);
    expect([back.x, back.z, back.stage, back.lit]).toEqual([-3, 7, 2, false]);
    expect(back.getState(1, 64, 2)).toBe(stateOf('stone'));
    expect(back.getState(15, 255, 15)).toBe(stateOf('glowstone'));
    expect(back.sections[4]!.getLight(5)).toBe(0x7a);
    expect(back.motionBlocking).toEqual(c.motionBlocking);
  });
});

describe('player data', () => {
  it('round-trips position, inventory, health, food, xp, game mode and spawn point', () => {
    const conn: Connection = { send: () => {}, close: () => {} };
    const p = new ServerPlayer(1, conn, new BlockWorld());
    Object.assign(p, { x: 10.5, y: 70, z: -3.25, yaw: 90, pitch: -10, gameMode: 1, flying: true });
    p.living.health = 13;
    p.living.food.foodLevel = 9;
    p.living.food.saturationLevel = 1.5;
    p.living.experienceLevel = 7;
    p.living.experienceProgress = 0.25;
    p.living.totalExperience = 120;
    p.inventory.set(0, { id: ITEMS_BY_NAME.get('diamond_pickaxe')!.id, count: 1, damage: 12 });
    p.inventory.set(40, { id: ITEMS_BY_NAME.get('torch')!.id, count: 33, damage: 0 });
    p.inventory.selected = 4;
    p.respawn = { x: 1, y: 65, z: 2, angle: 90 };
    const json = JSON.parse(JSON.stringify(capturePlayer(p)));
    const q = new ServerPlayer(2, conn, new BlockWorld());
    applyPlayer(q, json);
    expect([q.x, q.y, q.z, q.yaw, q.pitch, q.gameMode, q.flying]).toEqual([10.5, 70, -3.25, 90, -10, 1, true]);
    expect([q.living.health, q.living.food.foodLevel, q.living.food.saturationLevel]).toEqual([13, 9, 1.5]);
    expect([q.living.experienceLevel, q.living.experienceProgress, q.living.totalExperience]).toEqual([7, 0.25, 120]);
    expect(q.inventory.get(0)).toEqual({ id: ITEMS_BY_NAME.get('diamond_pickaxe')!.id, count: 1, damage: 12 });
    expect(q.inventory.get(40)?.count).toBe(33);
    expect(q.inventory.selected).toBe(4);
    expect(q.respawn).toEqual({ x: 1, y: 65, z: 2, angle: 90 });
  });
});

const meta = (name: string): LevelMeta => ({
  version: 1, name, seed: '-42', defaultGameMode: 0, gameTime: 5, dayTime: 6, doDaylightCycle: true, doWeatherCycle: true,
  raining: false, thundering: false, rainTime: 0, thunderTime: 0, clearWeatherTime: 0, rainLevel: 0, thunderLevel: 0,
  worldSpawn: [8, 70, 8], gameRules: {} as LevelMeta['gameRules'], difficulty: 2, playersSleepingPercentage: 100, spawnRadius: 10,
  pvp: true, lastPlayed: 1, createdAt: 1,
});

describe('storage backends', () => {
  it('disk storage keeps chunks in region files, level data and players', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bc-world-'));
    try {
      const s = new DiskStorage(dir);
      await s.putChunks([{ cx: 0, cz: 0, data: bytes(50, 1) }, { cx: 31, cz: -1, data: bytes(70, 2) }, { cx: 32, cz: 0, data: bytes(5, 3) }]);
      await s.putChunks([{ cx: 0, cz: 0, data: bytes(60, 4) }]); // rewrite in place
      await s.putMeta(meta('Disk'));
      await s.putPlayer(HOST_PLAYER_KEY, { name: 'x' } as never);
      await s.close();
      expect(readdirSync(join(dir, 'region')).sort()).toEqual(['r.0.-1.bcr', 'r.0.0.bcr', 'r.1.0.bcr']);
      const t = new DiskStorage(dir);
      expect((await t.listChunks()).sort()).toEqual([[0, 0], [31, -1], [32, 0]].sort());
      expect(await t.getChunk(0, 0)).toEqual(bytes(60, 4));
      expect(await t.getChunk(31, -1)).toEqual(bytes(70, 2));
      expect(await t.getChunk(1, 1)).toBeNull();
      expect((await t.getMeta())?.name).toBe('Disk');
      expect(await t.listPlayers()).toEqual([HOST_PLAYER_KEY]);
      expect((await t.getPlayer(HOST_PLAYER_KEY))?.name).toBe('x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports a world to a zip and imports it into another storage', async () => {
    const a = new MemoryStorage();
    await a.putMeta(meta('Exported'));
    await a.putChunks([{ cx: -40, cz: 3, data: bytes(300, 1) }, { cx: 2, cz: 2, data: bytes(10, 2) }]);
    await a.putPlayer('Steve', { name: 'Steve', x: 1 } as never);
    const zip = await exportWorld(a);
    const b = new MemoryStorage();
    const m = await importWorld(zip, b);
    expect(m.name).toBe('Exported');
    expect(await b.getChunk(-40, 3)).toEqual(bytes(300, 1));
    expect(await b.getChunk(2, 2)).toEqual(bytes(10, 2));
    expect((await b.getPlayer('Steve'))?.x).toBe(1);
    // the zip unpacks into a dedicated-server world folder
    const names = (await readZip(zip)).map((e) => e.name).sort();
    expect(names).toEqual(['Exported/level.json', 'Exported/players/Steve.json', 'Exported/region/r.-2.0.bcr', 'Exported/region/r.0.0.bcr']);
  });
});

// ------------------------------------------------------------------ server load/save
function client(server: GameServer, name: string, owner = true) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn, owner);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

const settle = () => new Promise((r) => setTimeout(r, 5));
async function run(server: GameServer, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    server.tick();
    await settle();
  }
}

function chunkState(received: S2C[], x: number, y: number, z: number): number | undefined {
  const pk = received.filter((p): p is Extract<S2C, { t: 'chunk' }> => p.t === 'chunk').reverse().find((p) => p.chunk.x === x >> 4 && p.chunk.z === z >> 4);
  return pk?.chunk.getState(x & 15, y, z & 15);
}

describe('server persistence', { timeout: 60000 }, () => {
  it('saves blocks, players and level data and restores them on reopen', async () => {
    const storage = new MemoryStorage();
    const s1 = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, storage, worldName: 'Test', randomSeed: 1n });
    await s1.load();
    expect(storage.meta?.name).toBe('Test');
    const a = client(s1, 'A');
    await run(s1, 3);
    a.send({ t: 'setBlock', x: 3, y: 120, z: 3, state: stateOf('stone') });
    a.send({ t: 'chat', message: '/give @s diamond 5' });
    a.send({ t: 'chat', message: '/time set 13000' });
    const p = s1.players[0]!;
    a.send({ t: 'move', x: p.x + 0.2, y: p.y, z: p.z, yaw: 45, pitch: 10, onGround: true });
    const pos = [p.x, p.y, p.z];
    await run(s1, 2);
    const gameTime = s1.gameTime;
    await s1.shutdown();
    expect(storage.chunks.size).toBeGreaterThan(0);
    expect(storage.meta?.dayTime).toBe(s1.dayTime);

    const s2 = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, storage });
    await s2.load();
    expect(s2.gameTime).toBe(gameTime);
    expect(s2.dayTime).toBe(s1.dayTime);
    const b = client(s2, 'A');
    await run(s2, 5);
    const login = b.received.find((x) => x.t === 'login') as Extract<S2C, { t: 'login' }>;
    expect([login.x, login.y, login.z]).toEqual(pos);
    expect(login.yaw).toBe(45);
    expect(chunkState(b.received, 3, 120, 3)).toBe(stateOf('stone'));
    expect(s2.world.getState(3, 120, 3)).toBe(stateOf('stone'));
    const slots = b.received.filter((x): x is Extract<S2C, { t: 'setSlot' }> => x.t === 'setSlot');
    expect(slots.some((x) => x.item === ITEMS_BY_NAME.get('diamond')!.id && x.count === 5)).toBe(true);
    s2.stop();
  });

  it('writes chunks that unload, and reads them back instead of regenerating', async () => {
    const storage = new MemoryStorage();
    const s1 = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, storage });
    await s1.load();
    const a = client(s1, 'A', false);
    await run(s1, 3);
    a.send({ t: 'setBlock', x: 5, y: 110, z: 5, state: stateOf('gold_block') });
    a.send({ t: 'chat', message: '/tp 800 100 800' });
    await run(s1, 45); // unload pass at gameTime % 40
    expect(s1.world.getChunk(0, 0)).toBeUndefined();
    await run(s1, 5);
    expect(storage.chunks.has('0,0')).toBe(true);
    // come back: the chunk is read from storage
    a.send({ t: 'chat', message: '/tp 5 111 5' });
    await run(s1, 10);
    expect(s1.world.getState(5, 110, 5)).toBe(stateOf('gold_block'));
    expect(chunkState(a.received, 5, 110, 5)).toBe(stateOf('gold_block'));
    // a non-host player is saved by name on disconnect
    s1.disconnect(a.conn);
    await settle();
    expect(storage.players.has('A')).toBe(true);
    s1.stop();
  });

  it('autosaves every 6000 ticks', async () => {
    expect(AUTOSAVE_INTERVAL).toBe(6000);
    const storage = new MemoryStorage();
    const s = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true, storage });
    await s.load();
    client(s, 'A');
    s.gameTime = AUTOSAVE_INTERVAL - 2;
    await run(s, 1);
    expect(storage.players.size).toBe(0);
    await run(s, 3);
    for (let i = 0; i < 200 && !storage.players.size; i++) await settle();
    expect(storage.chunks.size).toBeGreaterThan(0);
    expect(storage.players.has(HOST_PLAYER_KEY)).toBe(true);
    s.stop();
  });
});
