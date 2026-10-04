/**
 * Beds, sleeping and spawn points (vanilla BedBlock.use, ServerPlayer.startSleepInBed /
 * stopSleepInBed, ServerLevel sleep status, BedBlock.findStandUpPosition, respawn search).
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { blockNameOf, getProp, withProp } from '@shared/world/blockstate';
import { DIRS, DX, DZ } from '@shared/game/placement';
import { isSuffocating } from '@shared/world/blockprops';
import { isDay } from '@shared/world/daylight';
import { collisionBoxes } from '@shared/world/shapes';
import { AABB, noCollision } from '@shared/entity/aabb';

const MSG = {
  occupied: 'This bed is occupied',
  tooFar: 'You may not rest now; the bed is too far away',
  obstructed: 'This bed is obstructed',
  noSleep: 'You can sleep only at night or during thunderstorms',
  notSafe: 'You may not rest now; there are monsters nearby',
  setSpawn: 'Respawn point set',
  notValid: 'You have no home bed or charged respawn anchor, or it was obstructed',
};

type Dir = (typeof DIRS)[number];
const step = (d: Dir) => [DX[DIRS.indexOf(d)]!, DZ[DIRS.indexOf(d)]!] as const;
const CLOCKWISE: Record<string, Dir> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/** Blocks that hurt to stand in (EntityType.isBlockDangerous for players). */
function dangerous(name: string): boolean {
  return name === 'fire' || name === 'soul_fire' || name === 'lava' || name === 'magma_block' || name === 'campfire' ||
    name === 'soul_campfire' || name === 'sweet_berry_bush' || name === 'cactus' || name === 'powder_snow' || name === 'wither_rose';
}

export class Sleep {
  constructor(private readonly s: GameServer) {}

  private isBed(state: number): boolean {
    return blockNameOf(state).endsWith('_bed');
  }

  /** BedBlock.use. Returns true if the click was consumed (no block placement). */
  useBed(p: ServerPlayer, x: number, y: number, z: number): boolean {
    let st = this.s.world.getState(x, y, z);
    if (!this.isBed(st)) return false;
    if (getProp(st, 'part') !== 'head') {
      const [dx, dz] = step(getProp(st, 'facing') as Dir);
      x += dx;
      z += dz;
      st = this.s.world.getState(x, y, z);
      if (!this.isBed(st)) return true;
    }
    if (getProp(st, 'occupied') === true) {
      this.s.actionBar(p, MSG.occupied);
      return true;
    }
    const problem = this.startSleeping(p, x, y, z);
    if (problem) this.s.actionBar(p, problem);
    return true;
  }

  /** ServerPlayer.startSleepInBed: returns a problem message, or null when asleep. */
  private startSleeping(p: ServerPlayer, x: number, y: number, z: number): string | null {
    if (p.sleepingPos || p.living.dead) return '';
    const facing = getProp(this.s.world.getState(x, y, z), 'facing') as Dir;
    if (!this.bedInRange(p, x, y, z, facing)) return MSG.tooFar;
    if (this.bedBlocked(x, y, z, facing)) return MSG.obstructed;
    this.setRespawn(p, x, y, z, p.yaw, true);
    if (isDay(this.s.dayTime, this.s.rainLevel, this.s.thunderLevel * this.s.rainLevel)) return MSG.noSleep;
    // (monsters within 8×5×8 block rest; they arrive with Phase 6)
    // LivingEntity.startSleeping
    this.setOccupied(x, y, z, facing, true);
    p.sleepingPos = [x, y, z];
    p.sleepCounter = 0;
    p.x = x + 0.5;
    p.y = y + 0.6875;
    p.z = z + 0.5;
    p.pose = 'sleeping';
    p.stateDirty = true;
    p.living.timeSinceRest = 0;
    this.s.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    this.announce();
    return null;
  }

  private setOccupied(x: number, y: number, z: number, facing: Dir, occupied: boolean): void {
    const w = this.s.world;
    const head = w.getState(x, y, z);
    if (this.isBed(head)) this.s.setBlock(x, y, z, withProp(head, 'occupied', occupied));
    const [dx, dz] = step(facing);
    const foot = w.getState(x - dx, y, z - dz);
    if (this.isBed(foot)) this.s.setBlock(x - dx, y, z - dz, withProp(foot, 'occupied', occupied));
  }

  private bedInRange(p: ServerPlayer, x: number, y: number, z: number, facing: Dir): boolean {
    const near = (bx: number, bz: number) => Math.abs(p.x - (bx + 0.5)) <= 3 && Math.abs(p.y - y) <= 2 && Math.abs(p.z - (bz + 0.5)) <= 3;
    const [dx, dz] = step(facing);
    return near(x, z) || near(x - dx, z - dz);
  }

  private bedBlocked(x: number, y: number, z: number, facing: Dir): boolean {
    const [dx, dz] = step(facing);
    return isSuffocating(this.s.world.getState(x, y + 1, z)) || isSuffocating(this.s.world.getState(x - dx, y + 1, z - dz));
  }

  /** ServerPlayer.setRespawnPosition (sends "Respawn point set" when it changes). */
  setRespawn(p: ServerPlayer, x: number, y: number, z: number, angle: number, message: boolean): void {
    const r = p.respawn;
    const same = r && r.x === x && r.y === y && r.z === z;
    p.respawn = { x, y, z, angle };
    if (message && !same) this.s.send(p, { t: 'chat', json: JSON.stringify({ text: MSG.setSpawn }) });
  }

  /** Player.tick sleep part + ServerLevel night skipping; call once per server tick. */
  tick(): void {
    for (const p of this.s.players) {
      if (p.sleepingPos) {
        if (p.sleepCounter < 100) p.sleepCounter++;
        const [x, y, z] = p.sleepingPos;
        // the bed vanished, or it became day: wake up
        if (!this.isBed(this.s.world.getState(x, y, z)) || isDay(this.s.dayTime, this.s.rainLevel, this.s.thunderLevel * this.s.rainLevel)) this.wake(p, false);
      } else if (p.sleepCounter > 0) {
        p.sleepCounter++;
        if (p.sleepCounter >= 110) p.sleepCounter = 0;
      }
      if (!p.sleepingPos && (p.gameMode === 0 || p.gameMode === 2)) p.living.timeSinceRest++;
    }
    const pct = this.s.playersSleepingPercentage;
    const active = this.s.players.filter((p) => p.gameMode !== 3);
    if (!active.length) return;
    const needed = Math.max(1, Math.ceil((active.length * pct) / 100));
    const sleeping = active.filter((p) => p.sleepingPos).length;
    const deep = active.filter((p) => p.sleepingPos && p.sleepCounter >= 100).length;
    if (sleeping >= needed && deep >= needed) {
      if (this.s.doDaylightCycle) {
        const t = this.s.dayTime + 24000;
        this.s.setDayTime(t - (t % 24000));
      }
      for (const p of this.s.players) if (p.sleepingPos) this.wake(p, false);
      if (this.s.doWeatherCycle) this.s.resetWeatherCycle();
    }
  }

  /** ServerLevel.announceSleepStatus (multiplayer only). */
  announce(): void {
    if (this.s.players.length < 2) return;
    const active = this.s.players.filter((p) => p.gameMode !== 3);
    const needed = Math.max(1, Math.ceil((active.length * this.s.playersSleepingPercentage) / 100));
    const sleeping = active.filter((p) => p.sleepingPos).length;
    const msg = sleeping >= needed ? 'Sleeping through this night' : `${sleeping}/${needed} players sleeping`;
    for (const p of this.s.players) this.s.actionBar(p, msg);
  }

  /** Player.stopSleepInBed: stand up next to the bed. */
  wake(p: ServerPlayer, immediately: boolean): void {
    if (!p.sleepingPos) return;
    const [x, y, z] = p.sleepingPos;
    const st = this.s.world.getState(x, y, z);
    let pos: [number, number, number] = [x + 0.5, y + 1.1, z + 0.5];
    if (this.isBed(st)) {
      const facing = getProp(st, 'facing') as Dir;
      this.setOccupied(x, y, z, facing, false);
      pos = this.standUpPosition(x, y, z, p.yaw) ?? pos;
      // face the bed
      const vx = x + 0.5 - pos[0], vz = z + 0.5 - pos[2];
      p.yaw = ((((Math.atan2(vz, vx) * 180) / Math.PI - 90) % 360) + 540) % 360 - 180;
      p.pitch = 0;
    }
    p.sleepingPos = null;
    p.sleepCounter = immediately ? 0 : 100;
    [p.x, p.y, p.z] = pos;
    p.pose = 'standing';
    p.stateDirty = true;
    this.s.broadcastToTrackers(p, { t: 'animate', id: p.id, action: 2 }, true);
    this.s.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    this.announce();
  }

  /** BedBlock.findStandUpPosition (single beds). */
  standUpPosition(x: number, y: number, z: number, yaw: number): [number, number, number] | null {
    const st = this.s.world.getState(x, y, z);
    if (!this.isBed(st)) return null;
    const d = getProp(st, 'facing') as Dir;
    const cw = CLOCKWISE[d]!;
    // Direction.isFacingAngle(yaw): use the clockwise side unless the player looks toward it
    const [cx, cz] = step(cw);
    const yr = (yaw * Math.PI) / 180;
    const facingCw = cx * -Math.sin(yr) + cz * Math.cos(yr) > 0;
    const d2 = facingCw ? (CLOCKWISE[CLOCKWISE[cw]!] as Dir) : cw;
    const [sx, sz] = step(d), [tx, tz] = step(d2);
    const offsets: [number, number][] = [
      [tx, tz], [tx - sx, tz - sz], [tx - sx * 2, tz - sz * 2], [-sx * 2, -sz * 2], [-tx - sx * 2, -tz - sz * 2],
      [-tx - sx, -tz - sz], [-tx, -tz], [-tx + sx, -tz + sz], [sx, sz], [tx + sx, tz + sz],
      [0, 0], [-sx, -sz],
    ];
    for (const safe of [true, false]) {
      for (const [ox, oz] of offsets) {
        const v = this.safeDismount(x + ox, y, z + oz, safe);
        if (v) return v;
      }
    }
    return null;
  }

  /** DismountHelper.findSafeDismountLocation for a player-sized box. */
  private safeDismount(x: number, y: number, z: number, avoidDanger: boolean): [number, number, number] | null {
    const w = this.s.world;
    const here = w.getState(x, y, z);
    if (avoidDanger && dangerous(blockNameOf(here))) return null;
    const top = (st: number) => {
      const boxes = collisionBoxes(st);
      return boxes.length ? Math.max(...boxes.map((b) => b[4]!)) : null;
    };
    let floor: number;
    const t = top(here);
    if (t !== null) floor = t;
    else {
      const b = top(w.getState(x, y - 1, z));
      if (b === null || b < 1) return null;
      floor = b - 1;
    }
    if (!(floor < 1)) return null;
    if (avoidDanger && floor <= 0 && dangerous(blockNameOf(w.getState(x, y - 1, z)))) return null;
    const px = x + 0.5, py = y + floor, pz = z + 0.5;
    const bb = new AABB(px - 0.3, py, pz - 0.3, px + 0.3, py + 1.8, pz + 0.3).deflate(1e-7);
    return noCollision(w, bb) ? [px, py, pz] : null;
  }

  /** PlayerList.respawn position: the bed (if still valid) or the world spawn with spawnRadius fuzz. */
  respawnPosition(p: ServerPlayer): { pos: [number, number, number]; yaw: number } {
    const r = p.respawn;
    if (r) {
      const v = this.standUpPosition(r.x, r.y, r.z, r.angle);
      if (v) {
        const vx = r.x + 0.5 - v[0], vz = r.z + 0.5 - v[2];
        return { pos: v, yaw: (Math.atan2(vz, vx) * 180) / Math.PI - 90 };
      }
      p.respawn = null;
      this.s.send(p, { t: 'chat', json: JSON.stringify({ text: MSG.notValid }) });
    }
    return { pos: this.fudgeSpawn(), yaw: 0 };
  }

  /** ServerPlayer.fudgeSpawnLocation: a random valid column within spawnRadius of the world spawn. */
  fudgeSpawn(): [number, number, number] {
    const [sx, , sz] = this.s.worldSpawn;
    const i = Math.max(0, this.s.spawnRadius);
    const k = i * 2 + 1;
    const n = k * k;
    // getCoprime: a step that visits every cell once
    const coprime = n <= 16 ? n - 1 : 17;
    const start = Math.floor(Math.random() * n);
    for (let l = 0; l < n; l++) {
      const idx = (start + coprime * l) % n;
      const x = sx + (idx % k) - i, z = sz + Math.floor(idx / k) - i;
      const y = this.overworldRespawnY(x, z);
      if (y !== null) {
        const bb = new AABB(x + 0.2, y, z + 0.2, x + 0.8, y + 1.8, z + 0.8);
        if (noCollision(this.s.world, bb)) return [x + 0.5, y, z + 0.5];
      }
    }
    return [sx + 0.5, this.s.worldSpawn[1], sz + 0.5];
  }

  /** PlayerRespawnLogic.getOverworldRespawnPos: top solid block not under water. */
  private overworldRespawnY(x: number, z: number): number | null {
    const c = this.s.ensureChunk(x >> 4, z >> 4);
    const top = c.motionBlocking[(z & 15) * 16 + (x & 15)]!;
    for (let y = top + 1; y >= 0; y--) {
      const st = this.s.world.getState(x, y, z);
      const n = blockNameOf(st);
      if (n === 'water' || n === 'lava') return null;
      const boxes = collisionBoxes(st);
      if (boxes.some((b) => b[4] === 1 && b[0] === 0 && b[2] === 0 && b[3] === 1 && b[5] === 1)) return y + 1;
    }
    return null;
  }
}
