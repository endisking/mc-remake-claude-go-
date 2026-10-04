/**
 * Nether portals on the server (vanilla 1.17.1 BaseFireBlock.onPlace, NetherPortalBlock,
 * Entity.handleInsidePortal / handleNetherPortal, ServerPlayer.changeDimension, PortalForcer):
 * lighting frames, breaking portals when the frame breaks, the 80-tick wait (1 tick for
 * invulnerable players), the player portal cooldown, 8:1 travel, the exit-portal search
 * (16 blocks into the Nether, 128 out of it) and new portals with a platform.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import type { ServerLevel } from './level';
import { ItemEntity, ExperienceOrb, type ServerEntity } from './entity';
import { blockNameOf } from '@shared/world/blockstate';
import { DX, DY, DZ } from '@shared/game/placement';
import {
  findEmptyPortalShape, shapeBlocks, portalState, isPortal, portalAxis, portalSurvives, scaledTarget, portalSearchRadius,
  portalRectangle, relativePortalPosition, portalArrival, planPortal, type Axis, type FoundRectangle,
} from '@shared/game/portalshape';

interface PortalState {
  portalTime: number;
  cooldown: number;
  inside: boolean;
  entrance: [number, number, number] | null;
}

/** Player.getDimensionChangingDelay (players; other entities use 300) */
export const PLAYER_PORTAL_COOLDOWN = 10;
/** Player.getPortalWaitTime: 80 ticks, 1 when abilities.invulnerable (creative, spectator) */
export const portalWaitTime = (gameMode: number) => (gameMode === 1 || gameMode === 3 ? 1 : 80);

const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class Portals {
  private readonly states = new WeakMap<ServerPlayer, PortalState>();
  /** nether portal POIs per dimension ("x,y,z"), kept in the level data */
  private readonly pois = new Map<string, Set<string>>();
  private busy = false;
  /** where each player was just sent by a dimension change, until its client confirms (game time limit) */
  private readonly arrivals = new WeakMap<ServerPlayer, { x: number; y: number; z: number; until: number }>();

  constructor(private readonly s: GameServer) {}

  state(p: ServerPlayer): PortalState {
    let st = this.states.get(p);
    if (!st) this.states.set(p, (st = { portalTime: 0, cooldown: 0, inside: false, entrance: null }));
    return st;
  }

  private poiSet(dim: string): Set<string> {
    let set = this.pois.get(dim);
    if (!set) this.pois.set(dim, (set = new Set()));
    return set;
  }

  saveIndex(): Record<string, string[]> {
    return Object.fromEntries([...this.pois].map(([d, set]) => [d, [...set]]));
  }

  loadIndex(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    for (const [d, list] of Object.entries(data as Record<string, unknown>)) if (Array.isArray(list)) for (const k of list) if (typeof k === 'string') this.poiSet(d).add(k);
  }

  /** In portal dimensions (overworld, nether) fire may light a portal (BaseFireBlock.inPortalDimension). */
  private inPortalDimension(): boolean {
    const id = this.s.level.id;
    return id === 'overworld' || id === 'the_nether';
  }

  /** Hook for every block change in the current dimension (after the write). */
  onBlockChanged(x: number, y: number, z: number, old: number, state: number): void {
    const w = this.s.world;
    if (isPortal(state)) this.poiSet(this.s.level.id).add(posKey(x, y, z));
    else if (isPortal(old)) this.poiSet(this.s.level.id).delete(posKey(x, y, z));
    // BaseFireBlock.onPlace: fire inside an empty frame becomes a portal
    if (!this.busy && (blockNameOf(state) === 'fire' || blockNameOf(state) === 'soul_fire') && blockNameOf(old) !== blockNameOf(state) && this.inPortalDimension()) {
      const sh = findEmptyPortalShape(w, x, y, z, 'x');
      if (sh) {
        this.busy = true;
        try {
          const ps = portalState(sh.axis);
          for (const [bx, by, bz] of shapeBlocks(sh)) this.s.setBlock(bx, by, bz, ps);
        } finally {
          this.busy = false;
        }
        return;
      }
    }
    if (this.busy) return;
    // NetherPortalBlock.updateShape on the six neighbours
    for (let f = 0; f < 6; f++) {
      const nx = x + DX[f]!, ny = y + DY[f]!, nz = z + DZ[f]!;
      const ns = w.getState(nx, ny, nz);
      if (!isPortal(ns)) continue;
      const dir = DX[f] ? 'x' : DY[f] ? 'y' : 'z';
      if (!portalSurvives(w, nx, ny, nz, ns, dir, state)) this.s.setBlock(nx, ny, nz, 0);
    }
  }

  // ------------------------------------------------------------------ travel
  arrived(p: ServerPlayer, x: number, y: number, z: number): void {
    this.arrivals.set(p, { x, y, z, until: this.s.gameTime + 100 });
  }

  /** Drop stale moves from before the client switched dimension (vanilla awaitingPositionFromClient). */
  ignoreMove(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const a = this.arrivals.get(p);
    if (!a) return false;
    if (this.s.gameTime > a.until || (x - a.x) ** 2 + (y - a.y) ** 2 + (z - a.z) ** 2 < 4) {
      this.arrivals.delete(p);
      return false;
    }
    return true;
  }

  /** Entity.checkInsideBlocks (portal part) + Entity.handleNetherPortal + processPortalCooldown, once per tick. */
  tickPlayer(p: ServerPlayer): void {
    const st = this.state(p);
    const w = this.s.world;
    if (p.gameMode !== 3 && !p.living.dead) {
      const half = 0.3 - 0.001, hgt = (p.pose === 'crouching' ? 1.5 : p.pose === 'swimming' || p.pose === 'fall_flying' ? 0.6 : 1.8) - 0.001;
      const x0 = Math.floor(p.x - half), x1 = Math.floor(p.x + half), y0 = Math.floor(p.y + 0.001), y1 = Math.floor(p.y + hgt), z0 = Math.floor(p.z - half), z1 = Math.floor(p.z + half);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            if (!isPortal(w.getState(x, y, z))) continue;
            // Entity.handleInsidePortal
            if (st.cooldown > 0) st.cooldown = PLAYER_PORTAL_COOLDOWN;
            else {
              st.entrance = [x, y, z];
              st.inside = true;
            }
          }
    }
    const wait = portalWaitTime(p.gameMode);
    if (st.inside) {
      if (st.portalTime++ >= wait) {
        st.portalTime = wait;
        st.cooldown = PLAYER_PORTAL_COOLDOWN;
        this.travel(p, st);
      }
      st.inside = false;
    } else {
      if (st.portalTime > 0) st.portalTime -= 4;
      if (st.portalTime < 0) st.portalTime = 0;
    }
    if (st.cooldown > 0) st.cooldown--;
  }

  private readonly entityCooldowns = new WeakMap<ServerEntity, number>();

  /**
   * Items and experience orbs in portals (Entity.handleNetherPortal with getPortalWaitTime 0 and a
   * 300-tick cooldown): they travel the moment they touch a portal block. Runs in the current level.
   */
  tickEntities(): void {
    const s = this.s, lv = s.level;
    if (lv.id !== 'overworld' && lv.id !== 'the_nether') return;
    for (const e of [...lv.entities.values()]) {
      if (e.removed || !(e instanceof ItemEntity || e instanceof ExperienceOrb)) continue;
      let cd = this.entityCooldowns.get(e) ?? 0;
      const b = e.bb().deflate(0.001);
      let entrance: [number, number, number] | null = null;
      for (let x = Math.floor(b.minX); x <= Math.floor(b.maxX) && !entrance; x++)
        for (let y = Math.floor(b.minY); y <= Math.floor(b.maxY) && !entrance; y++)
          for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ) && !entrance; z++) if (isPortal(lv.world.getState(x, y, z))) entrance = [x, y, z];
      if (entrance) {
        if (cd > 0) cd = 300;
        else if (this.travelEntity(e, entrance)) cd = 300;
      }
      if (cd > 0) cd--;
      this.entityCooldowns.set(e, cd);
    }
  }

  private travelEntity(e: ServerEntity, ent: [number, number, number]): boolean {
    const s = this.s, from = s.level;
    const toId = from.id === 'the_nether' ? 'overworld' : 'the_nether';
    const to = s.levels.get(toId);
    if (!to) return false;
    const [tx, ty, tz] = scaledTarget(e.x, e.y, e.z, from.type.coordinateScale, to.type.coordinateScale);
    const entState = from.world.getState(ent[0], ent[1], ent[2]);
    const entryAxis: Axis = portalAxis(entState) ?? 'x';
    const rel = relativePortalPosition(portalRectangle(from.world, ent[0], ent[1], ent[2]), entryAxis, e.x, e.y, e.z, e.width, e.height);
    const exit = s.inLevel(to, () => this.findOrCreateExit(to, tx, ty, tz, toId === 'the_nether', entryAxis));
    if (!exit) return false;
    const exitAxis = portalAxis(to.world.getState(exit.x, exit.y, exit.z)) ?? 'x';
    const a = portalArrival(exit, exitAxis, entryAxis, rel, e.width, e.height, e.yaw);
    // leave this level (trackers forget it), join the other one where its trackers pick it up
    from.entities.delete(e.id);
    for (const p of from.players) if (p.tracking.delete(e.id)) s.send(p, { t: 'removeEntities', ids: [e.id] });
    if (entryAxis !== exitAxis) [e.vx, e.vz] = [e.vz, -e.vx];
    e.x = a.x;
    e.y = a.y;
    e.z = a.z;
    e.yaw = a.yaw;
    e.sentX = e.sentY = e.sentZ = NaN;
    to.entities.set(e.id, e);
    return true;
  }

  /** Teleport through the portal the player stands in (findDimensionEntryPoint + changeDimension). */
  travel(p: ServerPlayer, st: PortalState = this.state(p)): boolean {
    const s = this.s;
    const from = s.levelOf(p);
    const toId = from.id === 'the_nether' ? 'overworld' : 'the_nether';
    const to = s.levels.get(toId);
    if (!to || (from.id !== 'overworld' && from.id !== 'the_nether')) return false;
    const toNether = toId === 'the_nether';
    const [tx, ty, tz] = scaledTarget(p.x, p.y, p.z, from.type.coordinateScale, to.type.coordinateScale);
    // where in the entrance portal the player stands
    const ent = st.entrance ?? [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    const entState = from.world.getState(ent[0], ent[1], ent[2]);
    const entryAxis: Axis = portalAxis(entState) ?? 'x';
    const height = p.pose === 'crouching' ? 1.5 : 1.8;
    const rel: [number, number, number] = isPortal(entState)
      ? relativePortalPosition(portalRectangle(from.world, ent[0], ent[1], ent[2]), entryAxis, p.x, p.y, p.z, 0.6, height)
      : [0.5, 0, 0];
    const exit = s.inLevel(to, () => this.findOrCreateExit(to, tx, ty, tz, toNether, entryAxis));
    if (!exit) return false;
    const exitAxis = s.inLevel(to, () => portalAxis(to.world.getState(exit.x, exit.y, exit.z))) ?? 'x';
    const a = portalArrival(exit, exitAxis, entryAxis, rel, 0.6, height, p.yaw);
    s.changeDimension(p, toId, a.x, a.y, a.z, a.yaw, p.pitch);
    // ServerPlayer.changeDimension: level event 1032 (portal travel sound) to the traveller
    s.send(p, { t: 'levelEvent', event: 1032, x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z), data: 0 });
    return true;
  }

  /** PortalForcer.findPortalAround, else ServerPlayer.getExitPortal's createPortal. Runs in the destination level. */
  findOrCreateExit(lv: ServerLevel, x: number, y: number, z: number, toNether: boolean, axis: Axis): FoundRectangle | null {
    const s = this.s;
    const r = portalSearchRadius(toNether);
    // candidates: the POI index plus portal blocks in loaded chunks within the square
    const cands = new Set<string>();
    for (const k of this.poiSet(lv.id)) {
      const [px, , pz] = k.split(',').map(Number) as [number, number, number];
      if (Math.abs(px - x) <= r && Math.abs(pz - z) <= r) cands.add(k);
    }
    const cr = (r >> 4) + 1;
    for (let cx = (x >> 4) - cr; cx <= (x >> 4) + cr; cx++)
      for (let cz = (z >> 4) - cr; cz <= (z >> 4) + cr; cz++) {
        const c = lv.world.getChunk(cx, cz);
        if (!c) continue;
        for (let sy = 0; sy < 16; sy++) {
          const sec = c.sections[sy]!;
          if (!sec.blocks || sec.nonAir === 0) continue;
          const b = sec.blocks;
          for (let i = 0; i < 4096; i++) {
            if (!isPortal(b[i]!)) continue;
            const bx = (cx << 4) | (i & 15), by = (sy << 4) | (i >> 8), bz = (cz << 4) | ((i >> 4) & 15);
            if (Math.abs(bx - x) <= r && Math.abs(bz - z) <= r) cands.add(posKey(bx, by, bz));
          }
        }
      }
    const list = [...cands].map((k) => k.split(',').map(Number) as [number, number, number]);
    const d2 = (p: [number, number, number]) => (p[0] + 0.5 - x) ** 2 + (p[1] + 0.5 - y) ** 2 + (p[2] + 0.5 - z) ** 2;
    list.sort((a, b) => d2(a) - d2(b) || a[1] - b[1]);
    for (const p of list) {
      s.ensureStage(p[0] >> 4, p[2] >> 4, 3);
      if (isPortal(lv.world.getState(p[0], p[1], p[2]))) return portalRectangle(lv.world, p[0], p[1], p[2]);
      this.poiSet(lv.id).delete(posKey(p[0], p[1], p[2]));
    }
    // none: build one (needs the 16-block spiral generated)
    for (let cx = ((x - 18) >> 4); cx <= ((x + 18) >> 4); cx++) for (let cz = ((z - 18) >> 4); cz <= ((z + 18) >> 4); cz++) s.ensureStage(cx, cz, 3);
    const plan = planPortal(
      {
        getState: (a, b, c) => lv.world.getState(a, b, c),
        motionBlockingHeight: (a, c) => lv.world.getChunk(a >> 4, c >> 4)?.motionBlocking[((c & 15) << 4) | (a & 15)] ?? 0,
      },
      x, y, z, axis, lv.type.logicalHeight,
    );
    this.busy = true;
    try {
      for (const [a, b, c, st] of plan.writes) s.setBlock(a, b, c, st);
    } finally {
      this.busy = false;
    }
    return plan.rect;
  }
}
