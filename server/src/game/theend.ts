/**
 * The End on the server (vanilla 1.17.1): eyes of ender (EnderEyeItem.use / useOn, EyeOfEnder),
 * end portal activation (EndPortalFrameBlock.getOrCreatePortalShape's BlockPattern search),
 * travelling through end portals (EndPortalBlock.entityInside → ServerPlayer.changeDimension:
 * the obsidian arrival platform at END_SPAWN_POINT, and from the End back to the respawn point with
 * the win-game credits the first time), and the exit portal fountain (EndDragonFight's
 * EndPodiumFeature at the top of 0, 0).
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { ServerEntity, ItemEntity, ExperienceOrb } from './entity';
import type { BlockWorld } from '@shared/world/world';
import { stateOf, blockNameOf, getProp, withProp } from '@shared/world/blockstate';
import { IS_AIR } from '@shared/world/blockinfo';
import { JavaRandom } from '@shared/util/random';
import type { ItemStack } from '@shared/item/stack';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { locateStructure } from '@shared/worldgen/structures/placement';
import { createEndPlatform, placeEndPodium, placeGateway, setGatewayExit, END_SPAWN_POINT } from '@shared/worldgen/features/end';
import { EnderDragon } from './mobs/dragon';

const END_PORTAL = stateOf('end_portal');
const BEDROCK = stateOf('bedrock');

// ------------------------------------------------------------------ eye of ender entity
/** EyeOfEnder: floats toward its target 12 blocks at a time, then drops (80%) or shatters after 80 ticks. */
export class EyeOfEnder extends ServerEntity {
  readonly type = 'eye_of_ender';
  readonly width = 0.25;
  readonly height = 0.25;
  readonly trackRange = 64;
  tx = 0;
  ty = 0;
  tz = 0;
  life = 0;
  surviveAfterDeath = false;
  /** called once when its life runs out (the server drops the item or plays the break effect) */
  onDeath: ((e: EyeOfEnder) => void) | null = null;

  constructor(id: number, readonly item: number) {
    super(id);
  }

  /** EyeOfEnder.signalTo */
  signalTo(x: number, y: number, z: number, rand: { nextInt(n: number): number }): void {
    const dx = x - this.x, dz = z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 12) {
      this.tx = this.x + (dx / d) * 12;
      this.tz = this.z + (dz / d) * 12;
      this.ty = this.y + 8;
    } else {
      this.tx = x;
      this.ty = y;
      this.tz = z;
    }
    this.life = 0;
    this.surviveAfterDeath = rand.nextInt(5) > 0;
  }

  /** EyeOfEnder.tick (server side). */
  tick(_world: BlockWorld): void {
    this.age++;
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const h = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    const dx = this.tx - nx, dz = this.tz - nz;
    const f = Math.fround(Math.sqrt(dx * dx + dz * dz));
    const ang = Math.fround(Math.atan2(dz, dx));
    let speed = h + 0.0025 * (f - h);
    let vy = this.vy;
    if (f < 1) {
      speed *= 0.8;
      vy *= 0.8;
    }
    const j = this.y < this.ty ? 1 : -1;
    this.vx = Math.cos(ang) * speed;
    this.vy = vy + (j - vy) * Math.fround(0.015);
    this.vz = Math.sin(ang) * speed;
    this.x = nx;
    this.y = ny;
    this.z = nz;
    this.yaw = (Math.atan2(this.vx, this.vz) * 180) / Math.PI;
    if (++this.life > 80 && !this.removed) {
      this.removed = true;
      this.onDeath?.(this);
    }
  }
}

// ------------------------------------------------------------------ end portal frame pattern
/** Direction.values(): DOWN, UP, NORTH, SOUTH, WEST, EAST */
const DIRS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
/** EndPortalFrameBlock portal shape, aisle rows; v north-facing, ^ south, > west, < east (all with an eye). */
const PATTERN = ['?vvv?', '>???<', '>???<', '>???<', '?^^^?'];
const FACING_OF: Record<string, string> = { v: 'north', '^': 'south', '>': 'west', '<': 'east' };

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * BlockPattern.find for the end portal ring around (x, y, z): every origin in the 5-block cube
 * above/east/south of the position, every forwards/up pair; returns the front-top-left corner.
 */
export function findPortalFrame(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number): [number, number, number] | null {
  for (let oz = z; oz <= z + 4; oz++)
    for (let oy = y; oy <= y + 4; oy++)
      for (let ox = x; ox <= x + 4; ox++)
        for (const fw of DIRS)
          for (const up of DIRS) {
            if ((up[0] === fw[0] && up[1] === fw[1] && up[2] === fw[2]) || (up[0] === -fw[0] && up[1] === -fw[1] && up[2] === -fw[2])) continue;
            const side = cross(fw, up);
            let ok = true;
            for (let row = 0; row < 5 && ok; row++)
              for (let col = 0; col < 5 && ok; col++) {
                const ch = PATTERN[row]![col]!;
                if (ch === '?') continue;
                const bx = ox - up[0] * row + side[0] * col, by = oy - up[1] * row + side[1] * col, bz = oz - up[2] * row + side[2] * col;
                const s = get(bx, by, bz);
                ok = blockNameOf(s) === 'end_portal_frame' && getProp(s, 'eye') === true && getProp(s, 'facing') === FACING_OF[ch];
              }
            if (ok) return [ox, oy, oz];
          }
  return null;
}

// ------------------------------------------------------------------ server part
export class TheEnd {
  /** EndDragonFight.dragonKilled: the exit portal is lit */
  dragonKilled = false;
  /** EndDragonFight.previouslyKilled: the egg and 12000 XP were already given */
  previouslyKilledFlag = false;
  /** the flags came from level data (or were decided) */
  fightKnown = false;
  /** EndDragonFight.gateways: the 20 ring positions, shuffled per world, used one per kill */
  private gatewaysLeft: number[] | null = null;

  constructor(private readonly s: GameServer) {}

  previouslyKilled(): boolean {
    return this.previouslyKilledFlag;
  }

  private topCache = -1;

  /** The top bedrock of the fountain pillar at 0, 0 (runs in the End level; cached once found); 64 without a fountain. */
  fountainTop(): number {
    if (this.topCache >= 0) return this.topCache;
    const w = this.s.world;
    if (!w.getChunk(0, 0)) return 64;
    for (let y = 5; y < 124; y++)
      if (w.getState(0, y, 0) === BEDROCK && w.getState(0, y + 1, 0) === BEDROCK && w.getState(0, y + 2, 0) === BEDROCK && w.getState(0, y + 3, 0) === BEDROCK) {
        let t = y + 3;
        while (w.getState(0, t + 1, 0) === BEDROCK) t++;
        this.topCache = t;
        return t;
      }
    return 64;
  }

  /** EndDragonFight: the living dragon in the End level, if any. */
  findDragon(): EnderDragon | null {
    const end = this.s.levels.get('the_end');
    if (!end) return null;
    for (const e of end.entities.values()) if (e instanceof EnderDragon && !e.removed) return e;
    return null;
  }

  /** EndDragonFight.createNewDragon at (0, 128, 0) when the fight isn't won yet. Runs in the End level. */
  ensureDragon(): EnderDragon | null {
    if (this.dragonKilled) return null;
    const d = this.findDragon();
    if (d) return d;
    for (let cx = -1; cx <= 0; cx++) for (let cz = -1; cz <= 0; cz++) this.s.ensureStage(cx, cz, 3);
    const m = this.s.mobs.spawn('ender_dragon', 0, 128, 0, 'command');
    return m instanceof EnderDragon ? m : null;
  }

  /** EndDragonFight.setDragonKilled: light the exit portal, the egg (first time), a new gateway. Runs in the End level. */
  onDragonKilled(_d: EnderDragon): void {
    const s = this.s;
    for (let cx = -1; cx <= 0; cx++) for (let cz = -1; cz <= 0; cz++) s.ensureStage(cx, cz, 3);
    this.topCache = -1;
    const top = this.fountainTop();
    const w = s.world;
    placeEndPodium({ getState: (a, b, c) => w.getState(a, b, c), setState: (a, b, c, st) => s.setBlock(a, b, c, st) }, 0, top - 3, 0, true);
    this.spawnNewGateway();
    if (!this.previouslyKilledFlag) s.setBlock(0, top + 1, 0, stateOf('dragon_egg'));
    this.previouslyKilledFlag = true;
    this.dragonKilled = true;
    this.fightKnown = true;
  }

  /** EndDragonFight.spawnNewGateway: one of 20 positions on a radius-96 ring at y 75, each used once. */
  spawnNewGateway(): [number, number, number] | null {
    if (!this.gatewaysLeft) {
      const list = Array.from({ length: 20 }, (_, i) => i);
      // Collections.shuffle(list, new Random(seed))
      const r = new JavaRandom(this.s.opts.seed);
      for (let i = list.length; i > 1; i--) {
        const j = r.nextInt(i);
        [list[i - 1], list[j]] = [list[j]!, list[i - 1]!];
      }
      this.gatewaysLeft = list;
    }
    const i = this.gatewaysLeft.pop();
    if (i === undefined) return null;
    const a = 2 * (-Math.PI + 0.15707963267948966 * i);
    const x = Math.floor(96 * Math.cos(a)), z = Math.floor(96 * Math.sin(a)), y = 75;
    s_ensure(this.s, x, z);
    const w = this.s.world;
    placeGateway({ getState: (a2, b, c) => w.getState(a2, b, c), setState: (a2, b, c, st) => this.s.setBlock(a2, b, c, st) }, x, y, z);
    // EndGatewayBlockEntity: the exit is found by searching when first used (exit unset)
    void setGatewayExit;
    return [x, y, z];
  }

  /** EnderEyeItem.useOn: put an eye into an empty frame; completing the ring lights the portal. */
  useEyeOn(p: ServerPlayer, slot: number, held: ItemStack, x: number, y: number, z: number): boolean {
    const s = this.s;
    const st = s.world.getState(x, y, z);
    if (blockNameOf(st) !== 'end_portal_frame' || getProp(st, 'eye') === true) return false;
    s.setBlock(x, y, z, withProp(st, 'eye', true));
    // Block.pushEntitiesUp: the frame grows from 13/16 to a full block
    for (const o of s.players) {
      if (Math.floor(o.x) === x && Math.floor(o.z) === z && o.y >= y + 0.8125 - 1e-4 && o.y < y + 1) {
        o.y = y + 1;
        s.send(o, { t: 'teleport', x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch });
      }
    }
    if (p.gameMode !== 1) {
      held.count--;
      if (held.count <= 0) p.inventory.set(slot, null);
      s.syncSlot(p, slot);
    }
    // level event 1503: END_PORTAL_FRAME_FILL sound
    s.playSound(null, 'block.end_portal_frame.fill', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    this.tryActivate(x, y, z);
    return true;
  }

  /** The portal-shape search after an eye is placed; fills the 3×3 with end portal blocks. */
  tryActivate(x: number, y: number, z: number): boolean {
    const s = this.s;
    const o = findPortalFrame((a, b, c) => s.world.getState(a, b, c), x, y, z);
    if (!o) return false;
    const bx = o[0] - 3, bz = o[2] - 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s.setBlock(bx + i, o[1], bz + j, END_PORTAL);
    // global level event 1038: END_PORTAL_SPAWN, heard by everyone in the dimension at full volume
    for (const pl of s.players) s.playSound(null, 'block.end_portal.spawn', 'hostile', pl.x, pl.y + 1, pl.z, 1, 1);
    return true;
  }

  /** EnderEyeItem.use: launch an eye toward the nearest stronghold (only where strongholds generate). */
  throwEye(p: ServerPlayer, slot: number, stack: ItemStack): boolean {
    const s = this.s;
    const gen = s.generator;
    if (!(gen instanceof OverworldGenerator)) return false;
    const loc = locateStructure(gen, 'stronghold', Math.floor(p.x), Math.floor(p.z));
    if (!loc) return false;
    // ChunkGenerator.findNearestMapFeature: the middle of the start chunk at y 32
    const tx = ((loc.x >> 4) << 4) + 8, tz = ((loc.z >> 4) << 4) + 8;
    const e = new EyeOfEnder(s.newEntityId(), stack.id);
    e.x = p.x;
    e.y = p.y + 0.9; // getY(0.5)
    e.z = p.z;
    e.signalTo(tx, 32, tz, s.rand);
    e.onDeath = (eye) => {
      s.playSound(null, 'entity.ender_eye.death', 'neutral', eye.x, eye.y, eye.z, 1, 1);
      if (eye.surviveAfterDeath) {
        const r = s.rand;
        s.spawnItem(eye.x, eye.y, eye.z, { id: eye.item, count: 1, damage: 0 }, r.nextDouble() * 0.2 - 0.1, 0.2, r.nextDouble() * 0.2 - 0.1);
      } else s.send(p, { t: 'levelEvent', event: 2003, x: Math.floor(eye.x), y: Math.floor(eye.y), z: Math.floor(eye.z), data: 0 });
    };
    s.spawnEntity(e);
    const r = s.rand;
    s.playSound(null, 'entity.ender_eye.launch', 'neutral', p.x, p.y, p.z, 0.5, 0.4 / (r.nextFloat() * 0.4 + 0.8));
    if (p.gameMode !== 1) {
      stack.count--;
      if (stack.count <= 0) p.inventory.set(slot, null);
      s.syncSlot(p, slot);
    }
    return true;
  }

  // ---------------------------------------------------------------- travel
  /** EndPortalBlock.entityInside for a player (shape y 6/16–12/16), once per tick in the player's dimension. */
  tickPlayer(p: ServerPlayer): void {
    // spectators don't touch blocks (Entity.checkInsideBlocks)
    if (p.living.dead || p.gameMode === 3) return;
    const w = this.s.world;
    const hgt = p.pose === 'crouching' ? 1.5 : p.pose === 'swimming' || p.pose === 'fall_flying' ? 0.6 : 1.8;
    const x0 = Math.floor(p.x - 0.3), x1 = Math.floor(p.x + 0.3), y0 = Math.floor(p.y), y1 = Math.floor(p.y + hgt), z0 = Math.floor(p.z - 0.3), z1 = Math.floor(p.z + 0.3);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          if (w.getState(x, y, z) !== END_PORTAL) continue;
          // Shapes.joinIsNotEmpty(box, portal shape 0.375–0.75, AND)
          if (p.y < y + 0.75 && p.y + hgt > y + 0.375 && p.x + 0.3 > x && p.x - 0.3 < x + 1 && p.z + 0.3 > z && p.z - 0.3 < z + 1) {
            this.travel(p);
            return;
          }
        }
  }

  /** ServerPlayer.changeDimension through an end portal. */
  travel(p: ServerPlayer): void {
    const s = this.s;
    const from = s.levelOf(p);
    if (from.id === 'the_end') {
      // leaving the End: PlayerList.respawn(keepEverything) at the respawn point; the credits the first time (WIN_GAME)
      const show = !p.seenCredits;
      p.seenCredits = true;
      s.send(p, { t: 'winGame', showCredits: show });
      const overworld = s.levels.get('overworld')!;
      const { pos: [x, y, z], yaw } = s.inLevel(overworld, () => s.sleep.respawnPosition(p));
      s.changeDimension(p, 'overworld', x, y, z, yaw, 0);
      return;
    }
    const end = s.levels.get('the_end');
    if (!end) return;
    const [ex, ey, ez] = END_SPAWN_POINT;
    s.inLevel(end, () => {
      for (let cx = (ex - 16) >> 4; cx <= (ex + 16) >> 4; cx++) for (let cz = (ez - 16) >> 4; cz <= (ez + 16) >> 4; cz++) s.ensureStage(cx, cz, 3);
      this.ensureExitPortal();
      this.ensureDragon();
      createEndPlatform({ getState: (a, b, c) => s.world.getState(a, b, c), setState: (a, b, c, st) => s.setBlock(a, b, c, st) }, ex, ey, ez);
    });
    // Entity.findDimensionEntryPoint: END_SPAWN_POINT + (0.5, 0, 0.5), keeping the player's rotation
    s.changeDimension(p, 'the_end', ex + 0.5, ey, ez + 0.5, p.yaw, p.pitch);
  }

  /**
   * Items and experience orbs touching an end portal (EndPortalBlock.entityInside →
   * Entity.changeDimension): into the End at END_SPAWN_POINT after ServerLevel.makeObsidianPlatform
   * (obsidian at y 48), out of it to the top of the world spawn column. Runs in the current level.
   */
  tickEntities(): void {
    const s = this.s, from = s.level;
    for (const e of [...from.entities.values()]) {
      if (e.removed || !(e instanceof ItemEntity || e instanceof ExperienceOrb)) continue;
      const b = e.bb();
      let hit = false;
      for (let x = Math.floor(b.minX); x <= Math.floor(b.maxX) && !hit; x++)
        for (let y = Math.floor(b.minY); y <= Math.floor(b.maxY) && !hit; y++)
          for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ) && !hit; z++)
            hit = from.world.getState(x, y, z) === END_PORTAL && b.minY < y + 0.75 && b.maxY > y + 0.375;
      if (!hit) continue;
      const toId = from.id === 'the_end' ? 'overworld' : 'the_end';
      const to = s.levels.get(toId);
      if (!to) continue;
      let tx: number, ty: number, tz: number;
      if (toId === 'the_end') {
        const [ex, ey, ez] = END_SPAWN_POINT;
        s.inLevel(to, () => {
          for (let cx = (ex - 2) >> 4; cx <= (ex + 2) >> 4; cx++) for (let cz = (ez - 2) >> 4; cz <= (ez + 2) >> 4; cz++) s.ensureStage(cx, cz, 3);
          for (let x = ex - 2; x <= ex + 2; x++)
            for (let z = ez - 2; z <= ez + 2; z++) {
              for (let y = ey - 1; y <= ey + 1; y++) s.setBlock(x, y, z, 0);
              s.setBlock(x, ey - 2, z, stateOf('obsidian'));
            }
        });
        [tx, ty, tz] = [ex + 0.5, ey, ez + 0.5];
      } else {
        const [sx, , sz] = s.worldSpawn;
        const top = s.inLevel(to, () => {
          s.ensureStage(sx >> 4, sz >> 4, 3);
          return to.world.getChunk(sx >> 4, sz >> 4)?.motionBlocking[((sz & 15) << 4) | (sx & 15)] ?? 64;
        });
        [tx, ty, tz] = [sx + 0.5, top, sz + 0.5];
      }
      from.entities.delete(e.id);
      for (const p of from.players) if (p.tracking.delete(e.id)) s.send(p, { t: 'removeEntities', ids: [e.id] });
      e.x = tx;
      e.y = ty;
      e.z = tz;
      e.sentX = e.sentY = e.sentZ = NaN;
      to.entities.set(e.id, e);
    }
  }

  /**
   * EndDragonFight.spawnExitPortal: the fountain at the top block of (0, 0) when the End has none
   * yet, unlit until the dragon dies. A fountain that is already lit in a world without fight data
   * (made before the dragon existed) counts as a won fight. Runs in the End level.
   */
  ensureExitPortal(): void {
    const s = this.s;
    for (let cx = -1; cx <= 0; cx++) for (let cz = -1; cz <= 0; cz++) s.ensureStage(cx, cz, 3);
    const w = s.world;
    // EndDragonFight.findExitPortal: an existing fountain's 4-high bedrock pillar
    for (let y = 5; y < 124; y++)
      if (w.getState(0, y, 0) === BEDROCK && w.getState(0, y + 1, 0) === BEDROCK && w.getState(0, y + 2, 0) === BEDROCK && w.getState(0, y + 3, 0) === BEDROCK) {
        if (!this.fightKnown) {
          const top = this.fountainTop();
          if (w.getState(1, top - 3, 0) === END_PORTAL) this.dragonKilled = this.previouslyKilledFlag = true;
          this.fightKnown = true;
        }
        return;
      }
    this.fightKnown = true;
    // getHeightmapPos(MOTION_BLOCKING_NO_LEAVES, 0, 0).below(), stepping below any bedrock
    let y = 127;
    while (y > 0 && IS_AIR[w.getState(0, y, 0)] === 1) y--;
    placeEndPodium({ getState: (a, b, c) => w.getState(a, b, c), setState: (a, b, c, st) => s.setBlock(a, b, c, st) }, 0, y, 0, this.dragonKilled);
  }
}

function s_ensure(s: GameServer, x: number, z: number): void {
  s.ensureStage(x >> 4, z >> 4, 3);
}
