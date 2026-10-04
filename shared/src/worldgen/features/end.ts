/**
 * End feature types (vanilla 1.17.1): SpikeFeature (the obsidian pillars with their caged tops
 * and end crystals), EndIslandFeature, ChorusPlantFeature (ChorusFlowerBlock.generatePlant),
 * EndGatewayFeature, the end_gateway decorator, plus the pieces the dragon fight builds:
 * EndPodiumFeature (the exit portal fountain) and the obsidian arrival platform.
 * Random draws follow the vanilla order exactly.
 */
import { JavaRandom } from '../../util/random';
import { stateOf, blockNameOf } from '../../world/blockstate';
import { IS_AIR } from '../../world/blockinfo';
import type { GenLevel } from './level';
import { addGenEntity } from '../structures/entities';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Placer = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => boolean;
type Emit = (x: number, y: number, z: number) => void;

const S = {
  endStone: stateOf('end_stone'),
  obsidian: stateOf('obsidian'),
  bedrock: stateOf('bedrock'),
  gateway: stateOf('end_gateway'),
  endPortal: stateOf('end_portal'),
  flower5: stateOf('chorus_flower', { age: 5 }),
};

/** Anything that can read and write blocks (a GenLevel, or a live world on the server). */
export interface BlockAccess {
  getState(x: number, y: number, z: number): number;
  setState(x: number, y: number, z: number, state: number): unknown;
}

// ------------------------------------------------------------------ spikes
export interface EndSpike {
  centerX: number;
  centerZ: number;
  radius: number;
  height: number;
  guarded: boolean;
}

/** Collections.shuffle(list, random) */
function shuffle<T>(list: T[], r: JavaRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}

const spikeCache = new Map<bigint, EndSpike[]>();

/** SpikeFeature.getSpikesForLevel: seed key new Random(worldSeed).nextLong() & 0xFFFF, then SpikeCacheLoader. */
export function spikesForSeed(worldSeed: bigint): EndSpike[] {
  const key = new JavaRandom(worldSeed).nextLong() & 0xffffn;
  let list = spikeCache.get(key);
  if (list) return list;
  const order = Array.from({ length: 10 }, (_, i) => i);
  shuffle(order, new JavaRandom(key));
  list = [];
  for (let i = 0; i < 10; i++) {
    const a = 2 * (-Math.PI + (Math.PI / 10) * i);
    const l = order[i]!;
    list.push({
      centerX: Math.floor(42 * Math.cos(a)),
      centerZ: Math.floor(42 * Math.sin(a)),
      radius: 2 + Math.trunc(l / 3),
      height: 76 + l * 3,
      guarded: l === 1 || l === 2,
    });
  }
  spikeCache.set(key, list);
  return list;
}

/** SpikeFeature.placeSpike (the crystal is queued as a generated entity). */
export function placeSpike(lv: BlockAccess, r: JavaRandom, sp: EndSpike, onCrystal?: (x: number, y: number, z: number, yaw: number) => void): void {
  const i = sp.radius, cx = sp.centerX, cz = sp.centerZ;
  for (let z = cz - i; z <= cz + i; z++)
    for (let y = 0; y <= sp.height + 10; y++)
      for (let x = cx - i; x <= cx + i; x++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 <= i * i + 1 && y < sp.height) lv.setState(x, y, z, S.obsidian);
        else if (y > 65) lv.setState(x, y, z, 0);
      }
  if (sp.guarded) {
    for (let i1 = -2; i1 <= 2; i1++)
      for (let j1 = -2; j1 <= 2; j1++)
        for (let k1 = 0; k1 <= 3; k1++) {
          const ex = Math.abs(i1) === 2, ez = Math.abs(j1) === 2, top = k1 === 3;
          if (ex || ez || top) {
            const f3 = i1 === -2 || i1 === 2 || top;
            const f4 = j1 === -2 || j1 === 2 || top;
            const bars = stateOf('iron_bars', { north: f3 && j1 !== -2, south: f3 && j1 !== 2, west: f4 && i1 !== -2, east: f4 && i1 !== 2 });
            lv.setState(cx + i1, sp.height + k1, cz + j1, bars);
          }
        }
  }
  const yaw = r.nextFloat() * 360;
  onCrystal?.(cx + 0.5, sp.height + 1, cz + 0.5, yaw);
  lv.setState(cx, sp.height, cz, S.bedrock);
}

function endSpike(c: J): Placer {
  const fixed: EndSpike[] = (c.spikes ?? []).map((s: J) => ({
    centerX: s.centerX ?? 0, centerZ: s.centerZ ?? 0, radius: s.radius ?? 3, height: s.height ?? 76, guarded: !!s.guarded,
  }));
  return (lv, r, x, _y, z) => {
    const list = fixed.length ? fixed : spikesForSeed(lv.gen.seed);
    for (const sp of list)
      if (sp.centerX >> 4 === x >> 4 && sp.centerZ >> 4 === z >> 4)
        placeSpike(lv, r, sp, (ex, ey, ez) => addGenEntity(lv, { type: 'end_crystal', x: ex, y: ey, z: ez, persistent: true }));
    return true;
  };
}

// ------------------------------------------------------------------ small islands
/** EndIslandFeature */
export const endIsland: Placer = (lv, r, x, y, z) => {
  let f = Math.fround(r.nextInt(3) + 4);
  for (let i = 0; f > 0.5; i--) {
    for (let j = Math.floor(-f); j <= Math.ceil(f); j++)
      for (let k = Math.floor(-f); k <= Math.ceil(f); k++)
        if (Math.fround(j * j + k * k) <= Math.fround(Math.fround(f + 1) * Math.fround(f + 1))) lv.setState(x + j, y + i, z + k, S.endStone);
    f = Math.fround(f - (r.nextInt(2) + 0.5));
  }
  return true;
};

// ------------------------------------------------------------------ chorus
/** Direction.Plane.HORIZONTAL: NORTH, EAST, SOUTH, WEST */
const HORIZ: [number, number, string][] = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
const OPP = [2, 3, 0, 1];
const isEmpty = (lv: BlockAccess, x: number, y: number, z: number) => IS_AIR[lv.getState(x, y, z)] === 1;

/** ChorusPlantBlock.getStateForPlacement(level, pos): connections to chorus plants/flowers (and end stone below). */
export function chorusPlantState(lv: BlockAccess, x: number, y: number, z: number): number {
  const conn = (s: number) => {
    const n = blockNameOf(s);
    return n === 'chorus_plant' || n === 'chorus_flower';
  };
  const down = lv.getState(x, y - 1, z);
  return stateOf('chorus_plant', {
    down: conn(down) || blockNameOf(down) === 'end_stone',
    up: conn(lv.getState(x, y + 1, z)),
    north: conn(lv.getState(x, y, z - 1)),
    east: conn(lv.getState(x + 1, y, z)),
    south: conn(lv.getState(x, y, z + 1)),
    west: conn(lv.getState(x - 1, y, z)),
  });
}

function allNeighborsEmpty(lv: BlockAccess, x: number, y: number, z: number, except: number): boolean {
  for (let d = 0; d < 4; d++) if (d !== except && !isEmpty(lv, x + HORIZ[d]![0], y, z + HORIZ[d]![1])) return false;
  return true;
}

function growTreeRecursive(lv: BlockAccess, x: number, y: number, z: number, r: JavaRandom, rx: number, rz: number, maxH: number, depth: number): void {
  let i = r.nextInt(4) + 1;
  if (depth === 0) i++;
  for (let j = 0; j < i; j++) {
    const by = y + j + 1;
    if (!allNeighborsEmpty(lv, x, by, z, -1)) return;
    lv.setState(x, by, z, chorusPlantState(lv, x, by, z));
    lv.setState(x, by - 1, z, chorusPlantState(lv, x, by - 1, z));
  }
  let grew = false;
  if (depth < 4) {
    let l = r.nextInt(4);
    if (depth === 0) l++;
    for (let k = 0; k < l; k++) {
      const d = r.nextInt(4);
      const [dx, dz] = HORIZ[d]!;
      const bx = x + dx, by = y + i, bz = z + dz;
      if (Math.abs(bx - rx) < maxH && Math.abs(bz - rz) < maxH && isEmpty(lv, bx, by, bz) && isEmpty(lv, bx, by - 1, bz) && allNeighborsEmpty(lv, bx, by, bz, OPP[d]!)) {
        grew = true;
        lv.setState(bx, by, bz, chorusPlantState(lv, bx, by, bz));
        lv.setState(bx - dx, by, bz - dz, chorusPlantState(lv, bx - dx, by, bz - dz));
        growTreeRecursive(lv, bx, by, bz, r, rx, rz, maxH, depth + 1);
      }
    }
  }
  if (!grew) lv.setState(x, y + i, z, S.flower5);
}

/** ChorusFlowerBlock.generatePlant */
export function generateChorusPlant(lv: BlockAccess, x: number, y: number, z: number, r: JavaRandom, maxHorizontal: number): void {
  lv.setState(x, y, z, chorusPlantState(lv, x, y, z));
  growTreeRecursive(lv, x, y, z, r, x, z, maxHorizontal, 0);
}

/** ChorusPlantFeature */
export const chorusPlant: Placer = (lv, r, x, y, z) => {
  if (lv.isEmpty(x, y, z) && blockNameOf(lv.getState(x, y - 1, z)) === 'end_stone') {
    generateChorusPlant(lv, x, y, z, r, 8);
    return true;
  }
  return false;
};

// ------------------------------------------------------------------ gateways
/** Exit positions of generated gateways (EndGatewayConfiguration.exit, exact), per world, for the server's block entities. */
const gatewayExits = new WeakMap<object, Map<string, { x: number; y: number; z: number; exact: boolean }>>();
export function gatewayExit(world: object, x: number, y: number, z: number): { x: number; y: number; z: number; exact: boolean } | undefined {
  return gatewayExits.get(world)?.get(`${x},${y},${z}`);
}
export function setGatewayExit(world: object, x: number, y: number, z: number, exit: { x: number; y: number; z: number; exact: boolean }): void {
  let m = gatewayExits.get(world);
  if (!m) gatewayExits.set(world, (m = new Map()));
  m.set(`${x},${y},${z}`, exit);
}

/** EndGatewayFeature.place */
export function placeGateway(lv: BlockAccess, x: number, y: number, z: number): void {
  for (let bz = z - 1; bz <= z + 1; bz++)
    for (let by = y - 2; by <= y + 2; by++)
      for (let bx = x - 1; bx <= x + 1; bx++) {
        const fx = bx === x, fy = by === y, fz = bz === z, f3 = Math.abs(by - y) === 2;
        if (fx && fy && fz) lv.setState(bx, by, bz, S.gateway);
        else if (fy) lv.setState(bx, by, bz, 0);
        else if (f3 && fx && fz) lv.setState(bx, by, bz, S.bedrock);
        else if ((fx || fz) && !f3) lv.setState(bx, by, bz, S.bedrock);
        else lv.setState(bx, by, bz, 0);
      }
}

function endGateway(c: J): Placer {
  const exit = Array.isArray(c.exit) ? { x: c.exit[0] as number, y: c.exit[1] as number, z: c.exit[2] as number, exact: !!c.exact } : null;
  return (lv, _r, x, y, z) => {
    placeGateway(lv, x, y, z);
    if (exit) setGatewayExit(lv.world, x, y, z, exit);
    return true;
  };
}

/** EndGatewayPlacementDecorator: 3–9 blocks above the position. */
export function endGatewayDecorator(): (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, emit: Emit) => void {
  return (_lv, r, x, y, z, emit) => emit(x, y + 3 + r.nextInt(7), z);
}

export function endFeature(type: string, c: J): Placer | null {
  switch (type) {
    case 'minecraft:end_spike': return endSpike(c);
    case 'minecraft:end_island': return endIsland;
    case 'minecraft:chorus_plant': return chorusPlant;
    case 'minecraft:end_gateway': return endGateway(c);
    default: return null;
  }
}

// ------------------------------------------------------------------ dragon fight structures
/** ServerLevel.END_SPAWN_POINT */
export const END_SPAWN_POINT: readonly [number, number, number] = [100, 50, 0];

/** ServerPlayer.createEndPlatform: a 5×5 obsidian floor one below `pos`, three blocks of air above it. */
export function createEndPlatform(lv: BlockAccess, x: number, y: number, z: number): void {
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++)
      for (let k = -1; k < 3; k++) lv.setState(x + j, y + k, z + i, k === -1 ? S.obsidian : 0);
}

/**
 * EndPodiumFeature.place at `origin` (the top block at 0, 0): bedrock bowl with an end stone rim,
 * the 4-high bedrock pillar with four wall torches, and the 20 portal blocks when active.
 */
export function placeEndPodium(lv: BlockAccess, ox: number, oy: number, oz: number, active: boolean): void {
  for (let z = oz - 4; z <= oz + 4; z++)
    for (let y = oy - 1; y <= oy + 32; y++)
      for (let x = ox - 4; x <= ox + 4; x++) {
        const d2 = (x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2;
        const inner = d2 < 2.5 * 2.5;
        if (!inner && !(d2 < 3.5 * 3.5)) continue;
        if (y < oy) lv.setState(x, y, z, inner ? S.bedrock : S.endStone);
        else if (y > oy) lv.setState(x, y, z, 0);
        else if (!inner) lv.setState(x, y, z, S.bedrock);
        else lv.setState(x, y, z, active ? S.endPortal : 0);
      }
  for (let i = 0; i < 4; i++) lv.setState(ox, oy + i, oz, S.bedrock);
  for (const [dx, dz, facing] of HORIZ) lv.setState(ox + dx, oy + 2, oz + dz, stateOf('wall_torch', { facing }));
}
