/**
 * Underground configured features (vanilla 1.17.1): amethyst geodes (GeodeFeature), dungeons
 * (MonsterRoomFeature), glow lichen (GlowLichenFeature + MultifaceBlock spreading), dripstone
 * (DripstoneClusterFeature, SmallDripstoneFeature, LargeDripstoneFeature, DripstoneUtils),
 * replace_single_block (ReplaceBlockFeature: emerald ore), fossils (FossilFeature placement rules
 * with this project's own fossil shapes) and the carving_mask decorator.
 *
 * Random call order and float/double rounding follow the 1.17.1 code: floats via Math.fround,
 * Mth.sin/cos via the lookup table.
 */
import { JavaRandom } from '../../util/random';
import { PerlinNoise } from '../../util/noise';
import { mthSin, mthCos, F_PI } from '../../util/mth';
import { stateOf, blockNameOf, getProp, withProp } from '../../world/blockstate';
import { IS_AIR, FLUID, FLUID_LEVEL, FULL_COLLISION, FACE_DX, FACE_DY, FACE_DZ } from '../../world/blockinfo';
import { MATERIAL_SOLID, isViewBlocking } from '../../world/blockprops';
import type { GenLevel } from './level';
import { blockState, intProvider, floatProvider, stateProvider, inTag as inTagByName, ruleTest, type RuleTest } from './providers';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Placer = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => boolean;
type Emit = (x: number, y: number, z: number) => void;
const f = Math.fround;

// Direction.values(): DOWN, UP, NORTH, SOUTH, WEST, EAST (same order as blockinfo's Face)
const D = { DOWN: 0, UP: 1, NORTH: 2, SOUTH: 3, WEST: 4, EAST: 5 } as const;
const DIR_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
const OPPOSITE = [1, 0, 3, 2, 5, 4] as const;
const AXIS = [1, 1, 2, 2, 0, 0] as const; // y, y, z, z, x, x
/** Direction.Plane.HORIZONTAL: NORTH, EAST, SOUTH, WEST */
const HORIZONTAL = [D.NORTH, D.EAST, D.SOUTH, D.WEST] as const;
/** getClockWise for horizontal directions */
const CLOCKWISE: Record<number, number> = { [D.NORTH]: D.EAST, [D.EAST]: D.SOUTH, [D.SOUTH]: D.WEST, [D.WEST]: D.NORTH };

const AIR = 0;
const CAVE_AIR = stateOf('cave_air');
const WATER = stateOf('water', { level: 0 });
const isWaterBlock = (s: number) => blockNameOf(s) === 'water';
const isLavaBlock = (s: number) => blockNameOf(s) === 'lava';
/** FluidState.isSource */
const isFluidSource = (s: number) => FLUID[s] !== 0 && FLUID_LEVEL[s] === 0;

/** Collections.shuffle(list, rnd) */
function shuffle<T>(list: T[], r: JavaRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}

/** Mth.randomBetweenInclusive */
const between = (r: JavaRandom, min: number, max: number) => r.nextInt(max - min + 1) + min;
/** Mth.randomBetween (float) */
const fBetween = (r: JavaRandom, min: number, max: number) => f(f(r.nextFloat() * f(max - min)) + min);
/** Mth.clampedMap (double) */
function clampedMap(v: number, a: number, b: number, c: number, d: number): number {
  const t = (v - a) / (b - a);
  return t < 0 ? c : t > 1 ? d : c + t * (d - c);
}
/** Mth.clampedMap (float overload) */
function fClampedMap(v: number, a: number, b: number, c: number, d: number): number {
  const t = f(f(v - a) / f(b - a));
  return t < 0 ? c : t > 1 ? d : f(c + f(t * f(d - c)));
}
/** Direction.getRandom */
const randomDir = (r: JavaRandom) => r.nextInt(6);

/** IntProvider.getMinValue / getMaxValue */
function intRange(j: J): [number, number] {
  if (typeof j === 'number') return [j, j];
  const v = j.value ?? j;
  switch (j.type) {
    case 'minecraft:constant': return [v, v];
    case 'minecraft:uniform': case 'minecraft:biased_to_bottom': return [v.min_inclusive, v.max_inclusive];
    case 'minecraft:clamped': return [v.min_inclusive, v.max_inclusive];
    default: throw new Error(`int provider ${j.type}`);
  }
}

/** Block tag membership, cached per state. */
const tagCache = new Map<string, Int8Array>();
function tagTable(tag: string): Int8Array {
  let t = tagCache.get(tag);
  if (!t) tagCache.set(tag, (t = new Int8Array(IS_AIR.length)));
  return t;
}
function inTag(tag: string, s: number): boolean {
  const t = tagTable(tag);
  let v = t[s]!;
  if (v === 0) t[s] = v = inTagByName(tag, s) ? 1 : -1;
  return v === 1;
}
/** Feature.isReplaceable(tag) */
const notIn = (tag: string) => (s: number) => !inTag(tag, s);

// ------------------------------------------------------------------ block entities
/**
 * Block entities that features create. The chunk format has no block entities yet, so they're
 * collected per world for the server to attach (chest loot table + seed, spawner entity type).
 */
export type GenBlockEntity =
  | { kind: 'chest'; x: number; y: number; z: number; lootTable: string; lootSeed: bigint }
  | { kind: 'spawner'; x: number; y: number; z: number; entity: string };
const pendingBlockEntities = new WeakMap<object, GenBlockEntity[]>();
function addBlockEntity(lv: GenLevel, be: GenBlockEntity): void {
  let list = pendingBlockEntities.get(lv.world);
  if (!list) pendingBlockEntities.set(lv.world, (list = []));
  list.push(be);
}
/** Block entities created by features in this world since the last call (removes them from the queue). */
export function takeGenBlockEntities(world: object): GenBlockEntity[] {
  const list = pendingBlockEntities.get(world) ?? [];
  pendingBlockEntities.delete(world);
  return list;
}

// ------------------------------------------------------------------ replace_single_block
/** ReplaceBlockFeature: the first matching target replaces the block at the origin. */
export function replaceSingleBlock(c: J): Placer {
  const tg = (c.targets as J[]).map((t) => ({ test: ruleTest(t.target) as RuleTest, state: blockState(t.state) }));
  return (lv, r, x, y, z) => {
    const s = lv.getState(x, y, z);
    for (const t of tg)
      if (t.test(s, r)) {
        lv.setState(x, y, z, t.state);
        break;
      }
    return true;
  };
}

// ------------------------------------------------------------------ monster_room
const COBBLE = stateOf('cobblestone');
const MOSSY = stateOf('mossy_cobblestone');
const SPAWNER = stateOf('spawner');
const CHEST = stateOf('chest', { facing: 'north', type: 'single', waterlogged: false });
const DUNGEON_MOBS = ['skeleton', 'zombie', 'zombie', 'spider'];
const FACING_NAMES: Record<number, string> = { [D.NORTH]: 'north', [D.SOUTH]: 'south', [D.WEST]: 'west', [D.EAST]: 'east' };
const isSolidRender = (s: number) => isViewBlocking(s);

/** StructurePiece.reorient: a chest faces away from its single solid neighbour (or the first open side). */
function reorientChest(lv: GenLevel, x: number, y: number, z: number, state: number): number {
  let dir = -1;
  for (const d of HORIZONTAL) {
    const s = lv.getState(x + FACE_DX[d], y, z + FACE_DZ[d]);
    if (blockNameOf(s) === 'chest') return state;
    if (!isSolidRender(s)) continue;
    if (dir !== -1) {
      dir = -1;
      break;
    }
    dir = d;
  }
  if (dir !== -1) return withProp(state, 'facing', FACING_NAMES[OPPOSITE[dir]]!);
  let d2: number = D.NORTH; // the chest's default facing
  const solid = (d: number) => isSolidRender(lv.getState(x + FACE_DX[d], y, z + FACE_DZ[d]));
  if (solid(d2)) d2 = OPPOSITE[d2];
  if (solid(d2)) d2 = CLOCKWISE[d2]!;
  if (solid(d2)) d2 = OPPOSITE[d2];
  return withProp(state, 'facing', FACING_NAMES[d2]!);
}

/** MonsterRoomFeature: a cobblestone/mossy room with a spawner and up to two chests. */
export const monsterRoom: Placer = (lv, r, ox, oy, oz) => {
  const canReplace = notIn('features_cannot_replace');
  const safeSet = (x: number, y: number, z: number, s: number) => {
    if (canReplace(lv.getState(x, y, z))) lv.setState(x, y, z, s);
  };
  const j = r.nextInt(2) + 2, k = -j - 1, l = j + 1;
  const o = r.nextInt(2) + 2, p = -o - 1, q = o + 1;
  let openings = 0;
  for (let s = k; s <= l; s++)
    for (let t = -1; t <= 4; t++)
      for (let u = p; u <= q; u++) {
        const x = ox + s, y = oy + t, z = oz + u;
        const solid = MATERIAL_SOLID[lv.getState(x, y, z)] === 1;
        if (t === -1 && !solid) return false;
        if (t === 4 && !solid) return false;
        if ((s === k || s === l || u === p || u === q) && t === 0 && lv.isEmpty(x, y, z) && lv.isEmpty(x, y + 1, z)) openings++;
      }
  if (openings < 1 || openings > 5) return false;
  for (let s = k; s <= l; s++)
    for (let t = 3; t >= -1; t--)
      for (let u = p; u <= q; u++) {
        const x = ox + s, y = oy + t, z = oz + u;
        const st = lv.getState(x, y, z);
        if (s === k || t === -1 || u === p || s === l || t === 4 || u === q) {
          if (y >= lv.minY && MATERIAL_SOLID[lv.getState(x, y - 1, z)] !== 1) {
            lv.setState(x, y, z, CAVE_AIR);
            continue;
          }
          if (MATERIAL_SOLID[st] !== 1 || blockNameOf(st) === 'chest') continue;
          if (t === -1 && r.nextInt(4) !== 0) safeSet(x, y, z, MOSSY);
          else safeSet(x, y, z, COBBLE);
        } else {
          const n = blockNameOf(st);
          if (n === 'chest' || n === 'spawner') continue;
          safeSet(x, y, z, CAVE_AIR);
        }
      }
  for (let s = 0; s < 2; s++)
    for (let t = 0; t < 3; t++) {
      const x = ox + r.nextInt(j * 2 + 1) - j, y = oy, z = oz + r.nextInt(o * 2 + 1) - o;
      if (!lv.isEmpty(x, y, z)) continue;
      let walls = 0;
      for (const d of HORIZONTAL) if (MATERIAL_SOLID[lv.getState(x + FACE_DX[d], y, z + FACE_DZ[d])] === 1) walls++;
      if (walls !== 1) continue;
      safeSet(x, y, z, reorientChest(lv, x, y, z, CHEST));
      // RandomizableContainerBlockEntity.setLootTable: the chest's loot seed is the next long
      if (blockNameOf(lv.getState(x, y, z)) === 'chest') addBlockEntity(lv, { kind: 'chest', x, y, z, lootTable: 'chests/simple_dungeon', lootSeed: r.nextLong() });
      break;
    }
  safeSet(ox, oy, oz, SPAWNER);
  if (lv.getState(ox, oy, oz) === SPAWNER) addBlockEntity(lv, { kind: 'spawner', x: ox, y: oy, z: oz, entity: DUNGEON_MOBS[r.nextInt(DUNGEON_MOBS.length)]! });
  return true;
};

// ------------------------------------------------------------------ geode
/** Mth.fastInvSqrt (double): the bit-hack inverse square root with one Newton step. */
const fisF = new Float64Array(1);
const fisI = new Int32Array(fisF.buffer);
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LE ? 1 : 0, LO = LE ? 0 : 1;
export function fastInvSqrt(d: number): number {
  const e = 0.5 * d;
  fisF[0] = d;
  const hi = fisI[HI]!, lo = fisI[LO]! >>> 0;
  // l = 0x5FE6EB50C7B537AA - (l >> 1), in 32-bit halves
  const shLo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0, shHi = hi >> 1;
  const nLo = 0xc7b537aa - shLo;
  fisI[HI] = (0x5fe6eb50 - shHi - (nLo < 0 ? 1 : 0)) | 0;
  fisI[LO] = nLo | 0;
  let x = fisF[0]!;
  x *= 1.5 - e * x * x;
  return x;
}

/** NormalNoise.create(random, firstOctave, amplitudes) */
export class NormalNoise {
  private readonly first: PerlinNoise;
  private readonly second: PerlinNoise;
  private readonly valueFactor: number;
  constructor(r: JavaRandom, firstOctave: number, amplitudes: number[]) {
    this.first = new PerlinNoise(r, firstOctave, amplitudes);
    this.second = new PerlinNoise(r, firstOctave, amplitudes);
    let lo = Infinity, hi = -Infinity;
    amplitudes.forEach((a, i) => {
      if (a !== 0) {
        lo = Math.min(lo, i);
        hi = Math.max(hi, i);
      }
    });
    this.valueFactor = 0.16666666666666666 / (0.1 * (1 + 1 / (hi - lo + 1)));
    // a safe bound on |getValue| (improved noise stays within ±1.04 per octave)
    const n = amplitudes.length;
    let octaves = 0, vf = Math.pow(2, n - 1) / (Math.pow(2, n) - 1);
    for (const a of amplitudes) {
      octaves += Math.abs(a) * vf;
      vf /= 2;
    }
    this.maxAbs = 2 * 1.2 * octaves * this.valueFactor;
  }
  readonly maxAbs: number;
  getValue(x: number, y: number, z: number): number {
    const k = 1.0181268882175227;
    return (this.first.noise(x, y, z) + this.second.noise(x * k, y * k, z * k)) * this.valueFactor;
  }
}
const geodeNoise = new Map<bigint, NormalNoise>();

const DIRS6 = [0, 1, 2, 3, 4, 5] as const;
/** BuddingAmethystBlock.canClusterGrowAtState: air or a full water block. */
const canClusterGrowAt = (s: number) => IS_AIR[s] === 1 || (isWaterBlock(s) && (FLUID_LEVEL[s] === 0 || FLUID_LEVEL[s]! >= 8));

/** GeodeFeature (1.17.1) */
export function geode(c: J): Placer {
  const b = c.blocks, layers = c.layers, crack = c.crack;
  const filling = stateProvider(b.filling_provider), inner = stateProvider(b.inner_layer_provider), alt = stateProvider(b.alternate_inner_layer_provider);
  const middle = stateProvider(b.middle_layer_provider), outer = stateProvider(b.outer_layer_provider);
  const placements = (b.inner_placements as J[]).map(blockState);
  const cannotReplace = String(b.cannot_replace), invalid = String(b.invalid_blocks);
  const outerWall = intProvider(c.outer_wall_distance), outerWallMax = intRange(c.outer_wall_distance)[1];
  const points = intProvider(c.distribution_points), pointOffset = intProvider(c.point_offset);
  const minOff = c.min_gen_offset as number, maxOff = c.max_gen_offset as number;
  const noiseMul = c.noise_multiplier as number, threshold = c.invalid_blocks_threshold as number;
  const altChance = c.use_alternate_layer0_chance as number, potentialChance = c.use_potential_placements_chance as number;
  const requireAlt = !!c.placements_require_layer0_alternate;
  const canReplace = notIn(cannotReplace);
  return (lv, r, ox, oy, oz) => {
    const safeSet = (x: number, y: number, z: number, s: number) => {
      if (canReplace(lv.getState(x, y, z))) lv.setState(x, y, z, s);
    };
    const k = points(r);
    let noise = geodeNoise.get(lv.gen.seed);
    if (!noise) geodeNoise.set(lv.gen.seed, (noise = new NormalNoise(new JavaRandom(lv.gen.seed), -4, [1])));
    const d = k / outerWallMax;
    const e = 1 / Math.sqrt(layers.filling);
    const fi = 1 / Math.sqrt(layers.inner_layer + d);
    const g = 1 / Math.sqrt(layers.middle_layer + d);
    const h = 1 / Math.sqrt(layers.outer_layer + d);
    const l = 1 / Math.sqrt(crack.base_crack_size + r.nextDouble() / 2 + (k > 3 ? d : 0));
    const cracked = r.nextFloat() < crack.generate_crack_chance;
    let invalidCount = 0;
    const pts: number[] = [];
    for (let n = 0; n < k; n++) {
      const px = ox + outerWall(r), py = oy + outerWall(r), pz = oz + outerWall(r);
      const s = lv.getState(px, py, pz);
      if (IS_AIR[s] === 1 || inTag(invalid, s)) {
        if (++invalidCount > threshold) return false;
      }
      pts.push(px, py, pz, pointOffset(r));
    }
    const crackPts: number[] = [];
    if (cracked) {
      const n = r.nextInt(4), o = k * 2 + 1;
      const [cx, cz] = n === 0 ? [o, 0] : n === 1 ? [0, o] : n === 2 ? [o, o] : [0, 0];
      for (const cy of [7, 5, 1]) crackPts.push(ox + cx, oy + cy, oz + cz);
    }
    const crackOffset = crack.crack_point_offset as number;
    const potential: number[] = [];
    const inv = new Float64Array(k), noiseBound = Math.abs(noiseMul) * noise.maxAbs;
    // BlockPos.betweenClosed: x fastest, then y, then z
    for (let z = oz + minOff; z <= oz + maxOff; z++)
      for (let y = oy + minOff; y <= oy + maxOff; y++)
        for (let x = ox + minOff; x <= ox + maxOff; x++) {
          // Vec3i.distSqr(Vec3i) in 1.17 measures from this block's centre (+0.5) to the other's corner
          let s0 = 0;
          for (let i = 0, j = 0; i < pts.length; i += 4, j++) {
            const dx = x + 0.5 - pts[i]!, dy = y + 0.5 - pts[i + 1]!, dz = z + 0.5 - pts[i + 2]!;
            s0 += inv[j] = fastInvSqrt(dx * dx + dy * dy + dz * dz + pts[i + 3]!);
          }
          // outside the shell whatever the noise: skip the noise (nothing is drawn or placed there)
          if (s0 + k * noiseBound < h) continue;
          const rn = noise.getValue(x, y, z) * noiseMul;
          let s = 0, t = 0;
          for (let j = 0; j < k; j++) s += inv[j]! + rn;
          for (let i = 0; i < crackPts.length; i += 3) {
            const dx = x + 0.5 - crackPts[i]!, dy = y + 0.5 - crackPts[i + 1]!, dz = z + 0.5 - crackPts[i + 2]!;
            t += fastInvSqrt(dx * dx + dy * dy + dz * dz + crackOffset) + rn;
          }
          if (s < h) continue;
          if (cracked && t >= l && s < e) {
            if (FLUID[lv.getState(x, y, z)] === 0) safeSet(x, y, z, AIR);
            continue;
          }
          if (s >= e) {
            safeSet(x, y, z, filling(r, x, y, z));
            continue;
          }
          if (s >= fi) {
            const useAlt = r.nextFloat() < altChance;
            safeSet(x, y, z, useAlt ? alt(r, x, y, z) : inner(r, x, y, z));
            if ((requireAlt && !useAlt) || !(r.nextFloat() < potentialChance)) continue;
            potential.push(x, y, z);
            continue;
          }
          if (s >= g) {
            safeSet(x, y, z, middle(r, x, y, z));
            continue;
          }
          safeSet(x, y, z, outer(r, x, y, z));
        }
    for (let i = 0; i < potential.length; i += 3) {
      const x = potential[i]!, y = potential[i + 1]!, z = potential[i + 2]!;
      let st = placements[r.nextInt(placements.length)]!;
      for (const dir of DIRS6) {
        if (getProp(st, 'facing') !== undefined) st = withProp(st, 'facing', DIR_NAMES[dir]);
        const ax = x + FACE_DX[dir], ay = y + FACE_DY[dir], az = z + FACE_DZ[dir];
        const s3 = lv.getState(ax, ay, az);
        if (getProp(st, 'waterlogged') !== undefined) st = withProp(st, 'waterlogged', isFluidSource(s3));
        if (!canClusterGrowAt(s3)) continue;
        safeSet(ax, ay, az, st);
        break;
      }
    }
    return true;
  };
}

// ------------------------------------------------------------------ glow lichen
const GLOW_LICHEN = stateOf('glow_lichen', { down: false, up: false, north: false, south: false, west: false, east: false, waterlogged: false });
const isLichen = (s: number) => blockNameOf(s) === 'glow_lichen';
const hasFace = (s: number, dir: number) => isLichen(s) && getProp(s, DIR_NAMES[dir]!) === true;
const isAirOrWater = (s: number) => IS_AIR[s] === 1 || isWaterBlock(s);
/** MultifaceBlock.canAttachTo: the neighbour's collision face toward us is full. */
const canAttachTo = (s: number) => FULL_COLLISION[s] === 1;

function isValidStateForPlacement(lv: GenLevel, s: number, x: number, y: number, z: number, dir: number): boolean {
  if (hasFace(s, dir)) return false;
  return canAttachTo(lv.getState(x + FACE_DX[dir], y + FACE_DY[dir], z + FACE_DZ[dir]));
}
/** MultifaceBlock.getStateForPlacement, -1 for null */
function lichenStateForPlacement(lv: GenLevel, cur: number, x: number, y: number, z: number, dir: number): number {
  if (!isValidStateForPlacement(lv, cur, x, y, z, dir)) return -1;
  let s: number;
  if (isLichen(cur)) s = cur;
  else if (isWaterBlock(cur) && isFluidSource(cur)) s = withProp(GLOW_LICHEN, 'waterlogged', true);
  else s = GLOW_LICHEN;
  return withProp(s, DIR_NAMES[dir]!, true);
}
/** GlowLichenBlock.canSpreadInto */
const canSpreadInto = (s: number) => IS_AIR[s] === 1 || isLichen(s) || (isWaterBlock(s) && isFluidSource(s));
function canSpreadToFace(lv: GenLevel, x: number, y: number, z: number, dir: number): boolean {
  const s = lv.getState(x, y, z);
  return canSpreadInto(s) && isValidStateForPlacement(lv, s, x, y, z, dir);
}
function spreadToFace(lv: GenLevel, x: number, y: number, z: number, dir: number): boolean {
  const s2 = lichenStateForPlacement(lv, lv.getState(x, y, z), x, y, z, dir);
  return s2 >= 0 && lv.setState(x, y, z, s2);
}
function spreadFromFaceTowardDirection(lv: GenLevel, st: number, x: number, y: number, z: number, from: number, to: number): boolean {
  if (AXIS[to] === AXIS[from] || !hasFace(st, from) || hasFace(st, to)) return false;
  if (canSpreadToFace(lv, x, y, z, to)) return spreadToFace(lv, x, y, z, to);
  const x2 = x + FACE_DX[to], y2 = y + FACE_DY[to], z2 = z + FACE_DZ[to];
  if (canSpreadToFace(lv, x2, y2, z2, from)) return spreadToFace(lv, x2, y2, z2, from);
  const x3 = x2 + FACE_DX[from], y3 = y2 + FACE_DY[from], z3 = z2 + FACE_DZ[from];
  if (canSpreadToFace(lv, x3, y3, z3, OPPOSITE[to])) return spreadToFace(lv, x3, y3, z3, OPPOSITE[to]);
  return false;
}
/**
 * MultifaceBlock's DIRECTIONS array. Vanilla shuffles it in place (Arrays.asList over the static
 * array), so the order carries over from one spread to the next.
 */
const MULTIFACE_DIRECTIONS = [0, 1, 2, 3, 4, 5];
function spreadFromFaceTowardRandomDirection(lv: GenLevel, st: number, x: number, y: number, z: number, from: number, r: JavaRandom): boolean {
  shuffle(MULTIFACE_DIRECTIONS, r);
  return MULTIFACE_DIRECTIONS.some((to) => spreadFromFaceTowardDirection(lv, st, x, y, z, from, to));
}

/** GlowLichenFeature (1.17.1) */
export function glowLichen(c: J): Placer {
  const placeOn = new Set((c.can_be_placed_on as J[]).map(blockState));
  const valid: number[] = [];
  if (c.can_place_on_ceiling) valid.push(D.UP);
  if (c.can_place_on_floor) valid.push(D.DOWN);
  if (c.can_place_on_wall) valid.push(...HORIZONTAL);
  const searchRange = c.search_range as number, spreadChance = f(c.chance_of_spreading);
  const placeIfPossible = (lv: GenLevel, x: number, y: number, z: number, st: number, r: JavaRandom, dirs: number[]): boolean => {
    for (const dir of dirs) {
      if (!placeOn.has(lv.getState(x + FACE_DX[dir], y + FACE_DY[dir], z + FACE_DZ[dir]))) continue;
      const s3 = lichenStateForPlacement(lv, st, x, y, z, dir);
      if (s3 < 0) return false;
      lv.setState(x, y, z, s3);
      if (r.nextFloat() < spreadChance) spreadFromFaceTowardRandomDirection(lv, s3, x, y, z, dir, r);
      return true;
    }
    return false;
  };
  return (lv, r, ox, oy, oz) => {
    if (!isAirOrWater(lv.getState(ox, oy, oz))) return false;
    const dirs = valid.slice();
    shuffle(dirs, r);
    if (placeIfPossible(lv, ox, oy, oz, lv.getState(ox, oy, oz), r, dirs)) return true;
    for (const dir of dirs) {
      const dirs2 = valid.filter((d) => d !== OPPOSITE[dir]);
      shuffle(dirs2, r);
      for (let i = 0; i < searchRange; i++) {
        // (vanilla re-sets the cursor to origin + direction each step, so it only ever looks one block away)
        const x = ox + FACE_DX[dir], y = oy + FACE_DY[dir], z = oz + FACE_DZ[dir];
        const st = lv.getState(x, y, z);
        if (!isAirOrWater(st) && !isLichen(st)) break;
        if (placeIfPossible(lv, x, y, z, st, r, dirs2)) return true;
      }
    }
    return false;
  };
}

// ------------------------------------------------------------------ dripstone
const DRIPSTONE_BLOCK = stateOf('dripstone_block');
const POINTED = stateOf('pointed_dripstone', { thickness: 'tip', vertical_direction: 'up', waterlogged: false });
const THICK = { TIP_MERGE: 'tip_merge', TIP: 'tip', FRUSTUM: 'frustum', MIDDLE: 'middle', BASE: 'base' } as const;

const isEmptyOrWater = (s: number) => IS_AIR[s] === 1 || isWaterBlock(s);
const isEmptyOrWaterOrLava = (s: number) => IS_AIR[s] === 1 || isWaterBlock(s) || isLavaBlock(s);
const isDripstoneBase = (s: number) => s === DRIPSTONE_BLOCK || inTag('dripstone_replaceable_blocks', s);
const isDripstoneBaseOrLava = (s: number) => isDripstoneBase(s) || isLavaBlock(s);

/** DripstoneUtils.getDripstoneHeight */
export function getDripstoneHeight(d: number, e: number, fv: number, g: number): number {
  if (d < g) d = g;
  const i = (d / e) * 0.384;
  const j = 0.75 * Math.pow(i, 1.3333333333333333);
  const k = Math.pow(i, 0.6666666666666666);
  const l = 0.3333333333333333 * Math.log(i);
  const m = Math.max(fv * (j - k - l), 0);
  return (m / 0.384) * e;
}

/** DripstoneUtils.isCircleMostlyEmbeddedInStone (the (int) cast binds to cos/sin before × radius, as in vanilla) */
function isCircleMostlyEmbeddedInStone(lv: GenLevel, x: number, y: number, z: number, radius: number): boolean {
  if (isEmptyOrWaterOrLava(lv.getState(x, y, z))) return false;
  const g = f(6 / radius);
  const TWO_PI = f(F_PI * 2);
  for (let h = 0; h < TWO_PI; h = f(h + g)) {
    const j = Math.trunc(mthCos(h)) * radius, k = Math.trunc(mthSin(h)) * radius;
    if (isEmptyOrWaterOrLava(lv.getState(x + j, y, z + k))) return false;
  }
  return true;
}

/** DripstoneUtils.growPointedDripstone: base → middle… → frustum → tip, from pos toward dir. */
function growPointedDripstone(lv: GenLevel, x: number, y: number, z: number, dir: number, height: number, merge: boolean): void {
  const up = dir === D.UP ? 1 : -1;
  const vd = dir === D.UP ? 'up' : 'down';
  const put = (thickness: string) => {
    const s = stateOf('pointed_dripstone', { thickness, vertical_direction: vd, waterlogged: FLUID[lv.getState(x, y, z)] === 1 });
    lv.setState(x, y, z, s);
    y += up;
  };
  if (height >= 3) {
    put(THICK.BASE);
    for (let i = 0; i < height - 3; i++) put(THICK.MIDDLE);
  }
  if (height >= 2) put(THICK.FRUSTUM);
  if (height >= 1) put(merge ? THICK.TIP_MERGE : THICK.TIP);
}

/** DripstoneUtils.placeDripstoneBlockIfPossible */
function placeDripstoneBlock(lv: GenLevel, x: number, y: number, z: number): boolean {
  if (!inTag('dripstone_replaceable_blocks', lv.getState(x, y, z))) return false;
  lv.setState(x, y, z, DRIPSTONE_BLOCK);
  return true;
}

/** Column.scan: floor / ceiling (null when absent) around an inside position, or undefined if not inside. */
function columnScan(lv: GenLevel, x: number, y: number, z: number, range: number, inside: (s: number) => boolean, edge: (s: number) => boolean): { floor: number | null; ceil: number | null } | undefined {
  if (!inside(lv.getState(x, y, z))) return undefined;
  const scan = (dir: number) => {
    let m = y;
    for (let k = 1; k < range && inside(lv.getState(x, m, z)); k++) m += dir;
    return edge(lv.getState(x, m, z)) ? m : null;
  };
  const ceil = scan(1);
  const floor = scan(-1);
  return { floor, ceil };
}

/** SmallDripstoneFeature (1.17.1) */
export function smallDripstone(c: J): Placer {
  const maxPlacements = c.max_placements as number, radius = c.empty_space_search_radius as number, maxOff = c.max_offset_from_origin as number;
  const taller = f(c.chance_of_taller_dripstone);
  const patch = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => {
    placeDripstoneBlock(lv, x, y, z);
    for (const d of DIRS6) {
      if (!(r.nextFloat() < f(0.3))) continue;
      const x1 = x + FACE_DX[d], y1 = y + FACE_DY[d], z1 = z + FACE_DZ[d];
      placeDripstoneBlock(lv, x1, y1, z1);
      if (r.nextBoolean()) continue;
      const d2 = randomDir(r);
      const x2 = x1 + FACE_DX[d2], y2 = y1 + FACE_DY[d2], z2 = z1 + FACE_DZ[d2];
      placeDripstoneBlock(lv, x2, y2, z2);
      if (r.nextBoolean()) continue;
      const d3 = randomDir(r);
      placeDripstoneBlock(lv, x2 + FACE_DX[d3], y2 + FACE_DY[d3], z2 + FACE_DZ[d3]);
    }
  };
  const tryPlace = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, dir: number): boolean => {
    if (!isEmptyOrWater(lv.getState(x, y, z))) return false;
    const o = OPPOSITE[dir];
    const bx = x + FACE_DX[o], by = y + FACE_DY[o], bz = z + FACE_DZ[o];
    if (!isDripstoneBase(lv.getState(bx, by, bz))) return false;
    patch(lv, r, bx, by, bz);
    const h = r.nextFloat() < taller && isEmptyOrWater(lv.getState(x + FACE_DX[dir], y + FACE_DY[dir], z + FACE_DZ[dir])) ? 2 : 1;
    growPointedDripstone(lv, x, y, z, dir, h, false);
    return true;
  };
  const search = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number): boolean => {
    const dir = randomDir(r);
    const vert = r.nextBoolean() ? D.UP : D.DOWN;
    for (let i = 0; i < radius; i++) {
      if (!isEmptyOrWater(lv.getState(x, y, z))) return false;
      if (tryPlace(lv, r, x, y, z, vert)) return true;
      if (tryPlace(lv, r, x, y, z, OPPOSITE[vert])) return true;
      x += FACE_DX[dir];
      y += FACE_DY[dir];
      z += FACE_DZ[dir];
    }
    return false;
  };
  return (lv, r, ox, oy, oz) => {
    if (!isEmptyOrWater(lv.getState(ox, oy, oz))) return false;
    const n = between(r, 1, maxPlacements);
    let any = false;
    for (let j = 0; j < n; j++) {
      const x = ox + between(r, -maxOff, maxOff), y = oy + between(r, -maxOff, maxOff), z = oz + between(r, -maxOff, maxOff);
      if (search(lv, r, x, y, z)) any = true;
    }
    return any;
  };
}

/** DripstoneClusterFeature (1.17.1) */
export function dripstoneCluster(c: J): Placer {
  const height = intProvider(c.height), wetness = floatProvider(c.wetness), density = floatProvider(c.density), radius = intProvider(c.radius);
  const layer = intProvider(c.dripstone_block_layer_thickness);
  const range = c.floor_to_ceiling_search_range as number, heightDev = c.height_deviation as number, maxDiff = c.max_stalagmite_stalactite_height_diff as number;
  const edgeDist = c.max_distance_from_edge_affecting_chance_of_dripstone_column as number, centerDist = c.max_distance_from_center_affecting_height_bias as number;
  const chanceAtMax = f(c.chance_of_dripstone_column_at_max_distance_from_center);
  const canBeAdjacentToWater = (s: number) => inTag('base_stone_overworld', s) || FLUID[s] === 1;
  const canPlacePool = (lv: GenLevel, x: number, y: number, z: number) => {
    const s = lv.getState(x, y, z), n = blockNameOf(s);
    if (n === 'water' || n === 'dripstone_block' || n === 'pointed_dripstone') return false;
    for (const d of HORIZONTAL) if (!canBeAdjacentToWater(lv.getState(x + FACE_DX[d], y, z + FACE_DZ[d]))) return false;
    return canBeAdjacentToWater(lv.getState(x, y - 1, z));
  };
  const replaceWithDripstone = (lv: GenLevel, x: number, y: number, z: number, n: number, dy: number) => {
    for (let j = 0; j < n; j++) {
      if (!placeDripstoneBlock(lv, x, y, z)) return;
      y += dy;
    }
  };
  const dripHeight = (r: JavaRandom, x: number, z: number, dens: number, maxH: number) => {
    if (r.nextFloat() > dens) return 0;
    const i = Math.abs(x) + Math.abs(z);
    const mean = f(clampedMap(i, 0, centerDist, maxH / 2, 0));
    // ClampedNormalFloat.sample(random, mean, deviation, 0, maxH)
    const v = f(mean + f(f(r.nextGaussian()) * heightDev));
    return Math.trunc(Math.min(maxH, Math.max(0, v)));
  };
  const placeColumn = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, lx: number, lz: number, wet: number, chance: number, h: number, dens: number) => {
    const col = columnScan(lv, x, y, z, range, isEmptyOrWater, isDripstoneBaseOrLava);
    if (!col) return;
    const ceil = col.ceil, floor0 = col.floor;
    if (ceil === null && floor0 === null) return;
    const wetHere = r.nextFloat() < wet;
    let floor = floor0;
    if (wetHere && floor0 !== null && canPlacePool(lv, x, floor0, z)) {
      floor = floor0 - 1;
      lv.setState(x, floor0, z, WATER);
    }
    let m: number, n: number;
    const stalactite = r.nextDouble() < chance;
    if (ceil !== null && stalactite && !isLavaBlock(lv.getState(x, ceil, z))) {
      replaceWithDripstone(lv, x, ceil, z, layer(r), 1);
      const l = floor !== null ? Math.min(h, ceil - floor) : h;
      m = dripHeight(r, lx, lz, dens, l);
    } else m = 0;
    const stalagmite = r.nextDouble() < chance;
    if (floor !== null && stalagmite && !isLavaBlock(lv.getState(x, floor, z))) {
      replaceWithDripstone(lv, x, floor, z, layer(r), -1);
      n = ceil !== null ? Math.max(0, m + between(r, -maxDiff, maxDiff)) : dripHeight(r, lx, lz, dens, h);
    } else n = 0;
    let down: number, up: number;
    if (ceil !== null && floor !== null && ceil - m <= floor + n) {
      const lo = Math.max(ceil - m, floor + 1), hi = Math.min(floor + n, ceil - 1);
      const s = between(r, lo, hi + 1);
      down = ceil - s;
      up = s - 1 - floor;
    } else {
      down = m;
      up = n;
    }
    const colHeight = ceil !== null && floor !== null ? ceil - floor - 1 : null;
    const merge = r.nextBoolean() && down > 0 && up > 0 && colHeight !== null && down + up === colHeight;
    if (ceil !== null) growPointedDripstone(lv, x, ceil - 1, z, D.DOWN, down, merge);
    if (floor !== null) growPointedDripstone(lv, x, floor + 1, z, D.UP, up, merge);
  };
  return (lv, r, ox, oy, oz) => {
    if (!isEmptyOrWater(lv.getState(ox, oy, oz))) return false;
    const h = height(r), wet = wetness(r), dens = density(r), rx = radius(r), rz = radius(r);
    for (let l = -rx; l <= rx; l++)
      for (let m = -rz; m <= rz; m++) {
        const edge = Math.min(rx - Math.abs(l), rz - Math.abs(m));
        const chance = fClampedMap(edge, 0, edgeDist, chanceAtMax, 1);
        placeColumn(lv, r, ox + l, oy, oz + m, l, m, wet, chance, h, dens);
      }
    return true;
  };
}

/** LargeDripstoneFeature (1.17.1) */
export function largeDripstone(c: J): Placer {
  const range = c.floor_to_ceiling_search_range as number, ratio = f(c.max_column_radius_to_cave_height_ratio);
  const [rMin, rMax] = intRange(c.column_radius);
  const stalactiteBlunt = floatProvider(c.stalactite_bluntness), stalagmiteBlunt = floatProvider(c.stalagmite_bluntness), scaleP = floatProvider(c.height_scale);
  const windP = floatProvider(c.wind_speed), minRadiusWind = c.min_radius_for_wind as number, minBluntWind = f(c.min_bluntness_for_wind);

  interface Drip { x: number; y: number; z: number; up: boolean; radius: number; bluntness: number; scale: number }
  interface Wind { originY: number; wx: number; wz: number; on: boolean }
  const heightAt = (d: Drip, dist: number) => Math.trunc(getDripstoneHeight(dist, d.radius, d.scale, d.bluntness));
  const windX = (w: Wind, x: number, y: number) => (w.on ? Math.floor(x + w.wx * (w.originY - y)) : x);
  const windZ = (w: Wind, z: number, y: number) => (w.on ? Math.floor(z + w.wz * (w.originY - y)) : z);
  const suitable = (d: Drip) => d.radius >= minRadiusWind && d.bluntness >= minBluntWind;
  const moveBack = (lv: GenLevel, d: Drip, w: Wind): boolean => {
    while (d.radius > 1) {
      let y = d.y;
      const n = Math.min(10, heightAt(d, 0));
      for (let j = 0; j < n; j++) {
        if (isLavaBlock(lv.getState(d.x, y, d.z))) return false;
        if (isCircleMostlyEmbeddedInStone(lv, windX(w, d.x, y), y, windZ(w, d.z, y), d.radius)) {
          d.y = y;
          return true;
        }
        y += d.up ? -1 : 1;
      }
      d.radius = Math.trunc(d.radius / 2);
    }
    return false;
  };
  const placeBlocks = (lv: GenLevel, r: JavaRandom, d: Drip, w: Wind) => {
    for (let i = -d.radius; i <= d.radius; i++)
      columns: for (let j = -d.radius; j <= d.radius; j++) {
        const dist = f(Math.sqrt(i * i + j * j));
        if (dist > d.radius) continue;
        let k = heightAt(d, dist);
        if (k <= 0) continue;
        if (r.nextFloat() < 0.2) k = Math.trunc(f(k * fBetween(r, f(0.8), 1)));
        const x = d.x + i, z = d.z + j;
        let y = d.y, placed = false;
        for (let l = 0; l < k; l++) {
          const px = windX(w, x, y), pz = windZ(w, z, y);
          const s = lv.getState(px, y, pz);
          if (isEmptyOrWaterOrLava(s)) {
            placed = true;
            lv.setState(px, y, pz, DRIPSTONE_BLOCK);
          } else if (placed && inTag('base_stone_overworld', s)) continue columns;
          y += d.up ? 1 : -1;
        }
      }
  };
  return (lv, r, ox, oy, oz) => {
    if (!isEmptyOrWater(lv.getState(ox, oy, oz))) return false;
    const col = columnScan(lv, ox, oy, oz, range, isEmptyOrWater, isDripstoneBaseOrLava);
    if (!col || col.floor === null || col.ceil === null) return false;
    const h = col.ceil - col.floor - 1;
    if (h < 4) return false;
    const i = Math.trunc(f(h * ratio));
    const j = Math.min(rMax, Math.max(rMin, i));
    const k = between(r, rMin, j);
    const tite: Drip = { x: ox, y: col.ceil - 1, z: oz, up: false, radius: k, bluntness: stalactiteBlunt(r), scale: scaleP(r) };
    const mite: Drip = { x: ox, y: col.floor + 1, z: oz, up: true, radius: k, bluntness: stalagmiteBlunt(r), scale: scaleP(r) };
    let w: Wind = { originY: 0, wx: 0, wz: 0, on: false };
    if (suitable(tite) && suitable(mite)) {
      const speed = windP(r);
      const g = fBetween(r, 0, F_PI);
      w = { originY: oy, wx: f(mthCos(g) * speed), wz: f(mthSin(g) * speed), on: true };
    }
    const a = moveBack(lv, tite, w);
    const b = moveBack(lv, mite, w);
    if (a) placeBlocks(lv, r, tite, w);
    if (b) placeBlocks(lv, r, mite, w);
    return true;
  };
}

// ------------------------------------------------------------------ carving_mask decorator
/** Per-chunk carving masks as bit sets (bit index y << 8 | z << 4 | x), [air step, liquid step], set by the generator. */
export interface CarvingMasks {
  carvingMasks?: (Uint8Array | null)[] | null;
}

/** CarvingMaskDecorator: every carved position of this chunk for the step, in index order. */
export function carvingMaskDecorator(c: J): (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, emit: Emit) => void {
  const step = c.step === 'liquid' ? 1 : 0;
  return (lv, _r, x, _y, z, emit) => {
    const cx = x >> 4, cz = z >> 4;
    const chunk = lv.world.getChunk(cx, cz) as CarvingMasks | undefined;
    const mask = chunk?.carvingMasks?.[step];
    if (!mask) return;
    const bx = cx << 4, bz = cz << 4;
    for (let b = 0; b < mask.length; b++) {
      const m = mask[b]!;
      if (m === 0) continue;
      for (let k = 0; k < 8; k++) {
        if (!(m & (1 << k))) continue;
        const i = (b << 3) | k;
        emit(bx + (i & 15), lv.minY + (i >> 8), bz + ((i >> 4) & 15));
      }
    }
  };
}

// ------------------------------------------------------------------ fossil
/**
 * A fossil template: this project's own skull and spine shapes (vanilla's structure files are not
 * used), listed in StructureTemplate block order (y, then x, then z).
 */
interface Template { sx: number; sy: number; sz: number; blocks: { x: number; y: number; z: number; axis: 'x' | 'y' | 'z' }[] }

function sortTemplate(t: Template): Template {
  t.blocks.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  return t;
}

/** Spine k: a backbone along z with paired ribs arching down either side. */
function spineTemplate(k: number): Template {
  const len = [9, 11, 13, 7][k]!;
  const blocks: Template['blocks'] = [];
  const set = new Set<string>();
  const add = (x: number, y: number, z: number, axis: 'x' | 'y' | 'z') => {
    const key = `${x},${y},${z}`;
    if (set.has(key)) return;
    set.add(key);
    blocks.push({ x, y, z, axis });
  };
  for (let z = 0; z < len; z++) add(2, 3, z, 'z');
  for (let z = 1; z < len - 1; z += 2) {
    // ribs shorten toward the tail
    const tail = z > len * 0.7;
    add(1, 3, z, 'x');
    add(3, 3, z, 'x');
    add(0, 2, z, 'y');
    add(4, 2, z, 'y');
    if (!tail) {
      add(0, 1, z, 'y');
      add(4, 1, z, 'y');
      if (k % 2 === 1) {
        add(1, 0, z, 'x');
        add(3, 0, z, 'x');
      }
    }
  }
  // a short neck stub and hip knob
  if (k >= 2) add(2, 2, 0, 'y');
  if (k === 3) add(2, 2, len - 1, 'y');
  return sortTemplate({ sx: 5, sy: 4, sz: len, blocks });
}

/** Skull k: a hollow rounded cranium with eye sockets on its front, a snout and a jaw of teeth. */
function skullTemplate(k: number): Template {
  const [sx, sy, sz] = ([[5, 5, 6], [7, 5, 7], [7, 6, 9], [5, 4, 8]] as const)[k]!;
  const blocks: Template['blocks'] = [];
  const cx = (sx - 1) / 2, cy = (sy - 1) / 2 + 0.5, crz = (sz - 1) * 0.35;
  const rx = sx / 2, ry = sy / 2, rz = sz * 0.38;
  const snoutHalf = Math.max(1, sx / 2 - 1.5), snoutTop = Math.max(2, sy - 3);
  for (let y = 0; y < sy; y++)
    for (let x = 0; x < sx; x++)
      for (let z = 0; z < sz; z++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - crz) / rz;
        const d = dx * dx + dy * dy + dz * dz;
        let solid = d <= 1 && d > 0.45;
        // snout: a narrower shell running forward from the cranium, open underneath
        const ax = Math.abs(x - cx);
        if (z > crz && ax <= snoutHalf && y >= 1 && y <= snoutTop && (ax > snoutHalf - 1 || y === snoutTop || z === sz - 1)) solid = true;
        // eye sockets: two holes on the upper front of the cranium
        if (y === Math.round(cy + 0.5) && Math.abs(ax - Math.max(1, rx - 1.5)) < 0.6 && z >= crz) solid = false;
        // jaw: a bottom row of teeth along the snout's edges
        if (y === 0 && z > crz + 1 && z < sz - 1 && ax > 0 && ax <= snoutHalf && (z + k) % 2 === 0) solid = true;
        if (solid) blocks.push({ x, y, z, axis: y === 0 ? 'y' : ax >= rx - 1 ? 'x' : 'z' });
      }
  return sortTemplate({ sx, sy, sz, blocks });
}

const FOSSIL_TEMPLATES: Record<string, Template> = {};
for (let k = 0; k < 4; k++) {
  FOSSIL_TEMPLATES[`spine_${k + 1}`] = spineTemplate(k);
  FOSSIL_TEMPLATES[`skull_${k + 1}`] = skullTemplate(k);
}
/** A fossil template by structure id ("minecraft:fossil/skull_2"; the "_coal" overlays share the shape). */
export function fossilTemplate(name: string): Template | undefined {
  return FOSSIL_TEMPLATES[name.replace('minecraft:fossil/', '').replace(/_coal$/, '')];
}

/** Processor lists: block_rot with this integrity, then protected_blocks (features_cannot_replace). */
const FOSSIL_PROCESSORS: Record<string, { integrity: number; replace?: string }> = {
  'minecraft:fossil_rot': { integrity: f(0.9) },
  'minecraft:fossil_coal': { integrity: f(0.1) },
  'minecraft:fossil_diamonds': { integrity: f(0.1), replace: 'deepslate_diamond_ore' },
};

/** FossilFeature (1.17.1 placement rules, with this project's fossil shapes). */
export function fossil(c: J): Placer {
  const fossils = (c.fossil_structures as string[]).map((n) => fossilTemplate(n)!);
  const fossilProc = FOSSIL_PROCESSORS[c.fossil_processors as string] ?? { integrity: f(0.9) };
  const overlayProc = FOSSIL_PROCESSORS[c.overlay_processors as string] ?? { integrity: f(0.1) };
  const maxEmpty = c.max_empty_corners_allowed as number;
  const canReplace = notIn('features_cannot_replace');
  const BONE = { x: stateOf('bone_block', { axis: 'x' }), y: stateOf('bone_block', { axis: 'y' }), z: stateOf('bone_block', { axis: 'z' }) };
  return (lv, r, ox, _oy, oz) => {
    const rot = r.nextInt(4); // Rotation: NONE, CLOCKWISE_90, CLOCKWISE_180, COUNTERCLOCKWISE_90
    const t = fossils[r.nextInt(fossils.length)]!;
    const swap = rot === 1 || rot === 3;
    const rsx = swap ? t.sz : t.sx, rsz = swap ? t.sx : t.sz;
    const j = r.nextInt(16 - rsx), k = r.nextInt(16 - rsz);
    let l = lv.height;
    for (let m = 0; m < rsx; m++) for (let n = 0; n < rsz; n++) l = Math.min(l, lv.getHeight('OCEAN_FLOOR_WG', ox + m + j, oz + n + k));
    const y0 = Math.max(l - 15 - r.nextInt(10), lv.minY + 10);
    const px = ox + j, pz = oz + k;
    // getZeroPositionWithTransform + rotation about the template origin: local (x, z) → world
    const toWorld = (x: number, z: number): [number, number] => {
      switch (rot) {
        case 1: return [px + t.sz - 1 - z, pz + x];
        case 2: return [px + t.sx - 1 - x, pz + t.sz - 1 - z];
        case 3: return [px + z, pz + t.sx - 1 - x];
        default: return [px + x, pz + z];
      }
    };
    // countEmptyCorners over the rotated bounding box
    let empty = 0;
    for (const cxx of [px, px + rsx - 1])
      for (const cyy of [y0, y0 + t.sy - 1])
        for (const czz of [pz, pz + rsz - 1]) {
          const s = lv.getState(cxx, cyy, czz);
          if (IS_AIR[s] === 1 || isLavaBlock(s) || isWaterBlock(s)) empty++;
        }
    if (empty > maxEmpty) return false;
    const minX = ox & ~15, minZ = oz & ~15;
    const place = (proc: { integrity: number; replace?: string }, overlay: boolean) => {
      r.nextInt(1); // StructurePlaceSettings.getRandomPalette over the template's single palette
      for (const b of t.blocks) {
        const [wx, wz] = toWorld(b.x, b.z);
        const wy = y0 + b.y;
        if (!(r.nextFloat() <= proc.integrity)) continue;
        if (!canReplace(lv.getState(wx, wy, wz))) continue;
        // the placement bounding box is the origin's chunk column
        if (wx < minX || wx > minX + 15 || wz < minZ || wz > minZ + 15) continue;
        const s = overlay ? stateOf(proc.replace ?? 'coal_ore') : BONE[swap && b.axis !== 'y' ? (b.axis === 'x' ? 'z' : 'x') : b.axis];
        lv.setState(wx, wy, wz, s);
      }
    };
    place(fossilProc, false);
    place(overlayProc, true);
    return true;
  };
}
