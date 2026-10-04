/**
 * Monster spawners (vanilla BaseSpawner, 1.17.1): while a player is within 16 blocks, every
 * 200–799 ticks (first after 20) try 4 spawns within ±4 blocks (y ±1), obeying the mob's spawn
 * rules (darkness for monsters), at most 6 of that type nearby.
 *
 * The chunk format has no block entities yet, so spawner blocks are found when their chunk loads
 * and the mob type is the dungeon distribution (skeleton ¼, zombie ½, spider ¼) picked from the
 * position, stable across reloads.
 */
import { AABB, noCollision } from '@shared/entity/aabb';
import { stateOf } from '@shared/world/blockstate';
import { ENTITIES_BY_NAME } from '@shared/data';
import type { Chunk } from '@shared/world/chunk';
import type { GameServer } from '../server';
import { Mob } from './mob';

const SPAWNER = stateOf('spawner');
const DUNGEON_MOBS = ['skeleton', 'zombie', 'zombie', 'spider'];

export interface Spawner {
  x: number;
  y: number;
  z: number;
  type: string;
  delay: number;
}

/** The dungeon mob for a spawner position (deterministic). */
export function spawnerTypeAt(x: number, y: number, z: number): string {
  let h = Math.imul(x, 73428767) ^ Math.imul(y, 912931) ^ Math.imul(z, 438289);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return DUNGEON_MOBS[((h ^ (h >>> 16)) >>> 0) % 4]!;
}

export class MobSpawners {
  readonly spawners = new Map<string, Spawner>();
  private readonly scanned = new Set<string>();

  constructor(private readonly s: GameServer) {}

  /** Find spawner blocks in a newly loaded chunk. */
  scanChunk(c: Chunk): void {
    const ck = c.x + ',' + c.z;
    if (this.scanned.has(ck)) return;
    this.scanned.add(ck);
    for (let sy = 0; sy < c.sections.length; sy++) {
      const b = c.sections[sy]!.blocks;
      if (!b) continue;
      let i = b.indexOf(SPAWNER);
      while (i >= 0) {
        const x = c.x * 16 + (i & 15), y = sy * 16 + (i >> 8), z = c.z * 16 + ((i >> 4) & 15);
        this.add(x, y, z, spawnerTypeAt(x, y, z));
        i = b.indexOf(SPAWNER, i + 1);
      }
    }
  }

  add(x: number, y: number, z: number, type: string): void {
    this.spawners.set(`${x},${y},${z}`, { x, y, z, type, delay: 20 });
  }

  dropChunk(cx: number, cz: number): void {
    this.scanned.delete(cx + ',' + cz);
    for (const [k, sp] of this.spawners) if (sp.x >> 4 === cx && sp.z >> 4 === cz) this.spawners.delete(k);
  }

  tick(): void {
    const s = this.s;
    for (const [k, sp] of this.spawners) {
      if (s.world.getState(sp.x, sp.y, sp.z) !== SPAWNER) {
        if (s.world.getChunk(sp.x >> 4, sp.z >> 4)) this.spawners.delete(k);
        continue;
      }
      if (!s.isTickingChunk(sp.x >> 4, sp.z >> 4)) continue;
      // isNearPlayer: requiredPlayerRange 16
      const cx = sp.x + 0.5, cy = sp.y + 0.5, cz = sp.z + 0.5;
      if (!s.players.some((p) => p.gameMode !== 3 && !p.living.dead && (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 < 256)) continue;
      if (sp.delay > 0) {
        sp.delay--;
        continue;
      }
      this.trySpawn(sp);
    }
  }

  private delay(sp: Spawner): void {
    sp.delay = 200 + this.s.rand.nextInt(600);
  }

  private trySpawn(sp: Spawner): void {
    const s = this.s, r = s.rand, w = s.world;
    const ent = ENTITIES_BY_NAME.get(sp.type);
    if (!ent) return this.delay(sp);
    let spawned = false;
    for (let i = 0; i < 4; i++) {
      const x = sp.x + (r.nextDouble() - r.nextDouble()) * 4 + 0.5;
      const y = sp.y + r.nextInt(3) - 1;
      const z = sp.z + (r.nextDouble() - r.nextDouble()) * 4 + 0.5;
      if (!noCollision(w, AABB.ofSize(x, y, z, ent.width, ent.height))) continue;
      if (!s.mobs.checkSpawnRules(sp.type, Math.floor(x), y, Math.floor(z), 'spawner', r)) continue;
      const box = new AABB(sp.x, sp.y, sp.z, sp.x + 1, sp.y + 1, sp.z + 1).inflate(4);
      const near = s.mobs.nearbyMobs(sp.x, sp.z, 6).filter((m: Mob) => m.type === sp.type && !m.dead && m.bb().intersects(box)).length;
      if (near >= 6) return this.delay(sp);
      const m = s.mobs.spawn(sp.type, x, y, z, 'spawner');
      if (!m) continue;
      // PathfinderMob.checkSpawnRules: monsters need a walk target value ≥ 0 (not bright)
      if (m.walkTargetValue(Math.floor(x), y, Math.floor(z)) < 0) {
        m.removed = true;
        continue;
      }
      for (const p of s.players) if ((p.x - sp.x) ** 2 + (p.z - sp.z) ** 2 < 64 * 64) s.send(p, { t: 'levelEvent', event: 2004, x: sp.x, y: sp.y, z: sp.z, data: 0 });
      spawned = true;
    }
    if (spawned) this.delay(sp);
  }
}
