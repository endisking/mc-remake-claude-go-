/**
 * Nether feature types (vanilla 1.17.1): HugeFungusFeature, NetherForestVegetationFeature,
 * WeepingVinesFeature, TwistingVinesFeature, BasaltColumnsFeature, BasaltPillarFeature,
 * DeltaFeature, ReplaceBlobsFeature (netherrack_replace_blobs), GlowstoneFeature, and the
 * count_multilayer decorator. Random draws follow the vanilla order exactly.
 */
import type { JavaRandom } from '../../util/random';
import { stateOf, blockNameOf, withProp } from '../../world/blockstate';
import { IS_AIR } from '../../world/blockinfo';
import { canSurvive } from '../../game/support';
import { isReplaceable } from '../../game/placement';
import type { GenLevel } from './level';
import { blockState, intProvider, stateProvider } from './providers';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Placer = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => boolean;
type Emit = (x: number, y: number, z: number) => void;

const S = {
  netherrack: stateOf('netherrack'),
  wart: stateOf('nether_wart_block'),
  glowstone: stateOf('glowstone'),
  basalt: stateOf('basalt', { axis: 'y' }),
  blackstone: stateOf('blackstone'),
  bedrock: stateOf('bedrock'),
  weepingVines: stateOf('weeping_vines'),
  weepingPlant: stateOf('weeping_vines_plant'),
  twistingVines: stateOf('twisting_vines'),
  twistingPlant: stateOf('twisting_vines_plant'),
  warpedNylium: stateOf('warped_nylium'),
  warpedWart: stateOf('warped_wart_block'),
};
const name = (s: number) => blockNameOf(s);
const isAir = (lv: GenLevel, x: number, y: number, z: number) => IS_AIR[lv.getState(x, y, z)] === 1;
/** Mth.nextInt(random, a, b) */
const nextInt = (r: JavaRandom, a: number, b: number) => (a >= b ? a : r.nextInt(b - a + 1) + a);
/** Direction.values(): DOWN, UP, NORTH, SOUTH, WEST, EAST */
const DIRS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

// ------------------------------------------------------------------ decorator
/**
 * CountMultiLayerDecorator: per layer (0, 1, …) `count` random columns, each finding its
 * layer-th floor below the MOTION_BLOCKING height; stops after a layer finds none. Positions are
 * all collected before any feature is placed.
 */
export function countMultilayer(c: J): (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, emit: Emit) => void {
  const count = intProvider(c.count);
  const empty = (s: number) => IS_AIR[s] === 1 || name(s) === 'water' || name(s) === 'lava';
  const onGround = (lv: GenLevel, x: number, top: number, z: number, layer: number): number => {
    let i = 0;
    let above = lv.getState(x, top, z);
    for (let j = top; j >= 1; j--) {
      const s = lv.getState(x, j - 1, z);
      if (!empty(s) && empty(above) && s !== S.bedrock) {
        if (i === layer) return j;
        i++;
      }
      above = s;
    }
    return Infinity;
  };
  return (lv, r, x, _y, z, emit) => {
    const out: [number, number, number][] = [];
    let layer = 0, found: boolean;
    do {
      found = false;
      for (let j = 0; j < count(r); j++) {
        const k = r.nextInt(16) + x, l = r.nextInt(16) + z;
        const m = lv.getHeight('MOTION_BLOCKING', k, l);
        const n = onGround(lv, k, m, l, layer);
        if (n !== Infinity) {
          out.push([k, n, l]);
          found = true;
        }
      }
      layer++;
    } while (found);
    for (const [a, b, d] of out) emit(a, b, d);
  };
}

// ------------------------------------------------------------------ huge fungus
/** Material.isReplaceable (air, fluids, replaceable plants, fire…), or a plant when planted. */
function fungusReplaceable(lv: GenLevel, x: number, y: number, z: number, planted: boolean): boolean {
  const s = lv.getState(x, y, z);
  if (IS_AIR[s] === 1 || isReplaceable(s)) return true;
  if (!planted) return false;
  const n = name(s);
  return n.endsWith('_fungus') || n.endsWith('_sapling') || n === 'weeping_vines' || n === 'weeping_vines_plant' || n === 'twisting_vines' || n === 'twisting_vines_plant';
}

function weepingColumn(lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, len: number, minAge: number, maxAge: number): void {
  for (let k = 0; k <= len; k++) {
    if (isAir(lv, x, y, z)) {
      if (k === len || !isAir(lv, x, y - 1, z)) {
        lv.setState(x, y, z, withProp(S.weepingVines, 'age', nextInt(r, minAge, maxAge)));
        break;
      }
      lv.setState(x, y, z, S.weepingPlant);
    }
    y--;
  }
}

function twistingColumn(lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, len: number, minAge: number, maxAge: number): void {
  for (let k = 1; k <= len; k++) {
    if (isAir(lv, x, y, z)) {
      if (k === len || !isAir(lv, x, y + 1, z)) {
        lv.setState(x, y, z, withProp(S.twistingVines, 'age', nextInt(r, minAge, maxAge)));
        break;
      }
      lv.setState(x, y, z, S.twistingPlant);
    }
    y++;
  }
}

function hugeFungus(c: J): Placer {
  const base = blockState(c.valid_base_block), stem = blockState(c.stem_state), hat = blockState(c.hat_state), decor = blockState(c.decor_state);
  const planted = !!c.planted;
  const weeping = name(hat) === 'nether_wart_block';
  const tryVines = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => {
    if (!isAir(lv, x, y - 1, z)) return;
    let i = nextInt(r, 1, 5);
    if (r.nextInt(7) === 0) i *= 2;
    weepingColumn(lv, r, x, y - 1, z, i, 23, 25);
  };
  const hatBlock = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, decorChance: number, hatChance: number, vineChance: number) => {
    if (r.nextFloat() < decorChance) lv.setState(x, y, z, decor);
    else if (r.nextFloat() < hatChance) {
      lv.setState(x, y, z, hat);
      if (r.nextFloat() < vineChance) tryVines(lv, r, x, y, z);
    }
  };
  const f = Math.fround;
  return (lv, r, x, y, z) => {
    if (lv.getState(x, y - 1, z) !== base) return false;
    let h = nextInt(r, 4, 13);
    if (r.nextInt(12) === 0) h *= 2;
    if (!planted && y + h + 1 >= lv.genDepth) return false;
    const thick = !planted && r.nextFloat() < f(0.06);
    lv.setState(x, y, z, 0);
    // placeStem
    const t = thick ? 1 : 0;
    for (let j = -t; j <= t; j++)
      for (let k = -t; k <= t; k++) {
        const corner = thick && Math.abs(j) === t && Math.abs(k) === t;
        for (let l = 0; l < h; l++) {
          if (!fungusReplaceable(lv, x + j, y + l, z + k, true)) continue;
          if (planted) lv.setState(x + j, y + l, z + k, stem);
          else if (corner) {
            if (r.nextFloat() < f(0.1)) lv.setState(x + j, y + l, z + k, stem);
          } else lv.setState(x + j, y + l, z + k, stem);
        }
      }
    // placeHat
    const i = Math.min(r.nextInt(1 + Math.trunc(h / 3)) + 5, h);
    const j0 = h - i;
    for (let k = j0; k <= h; k++) {
      let l = k < h - r.nextInt(3) ? 2 : 1;
      if (i > 8 && k < j0 + 4) l = 3;
      if (thick) l++;
      for (let n = -l; n <= l; n++)
        for (let o = -l; o <= l; o++) {
          const edgeX = n === -l || n === l, edgeZ = o === -l || o === l;
          const inner = !edgeX && !edgeZ && k !== h;
          const corner = edgeX && edgeZ;
          const low = k < j0 + 3;
          const bx = x + n, by = y + k, bz = z + o;
          if (!fungusReplaceable(lv, bx, by, bz, false)) continue;
          if (low) {
            if (!inner) {
              // placeHatDropBlock
              if (lv.getState(bx, by - 1, bz) === hat) lv.setState(bx, by, bz, hat);
              else if (r.nextFloat() < f(0.15)) {
                lv.setState(bx, by, bz, hat);
                if (weeping && r.nextInt(11) === 0) tryVines(lv, r, bx, by, bz);
              }
            }
          } else if (inner) hatBlock(lv, r, bx, by, bz, f(0.1), f(0.2), weeping ? f(0.1) : 0);
          else if (corner) hatBlock(lv, r, bx, by, bz, f(0.01), f(0.7), weeping ? f(0.083) : 0);
          else hatBlock(lv, r, bx, by, bz, f(5.0e-4), f(0.98), weeping ? f(0.07) : 0);
        }
    }
    return true;
  };
}

// ------------------------------------------------------------------ vegetation and vines
function netherForestVegetation(c: J): Placer {
  const provider = stateProvider(c.state_provider);
  return (lv, r, x, y, z) => {
    const below = name(lv.getState(x, y - 1, z));
    if (below !== 'crimson_nylium' && below !== 'warped_nylium') return false;
    if (!(y >= 1 && y + 1 < 256)) return false;
    let placed = 0;
    for (let m = 0; m < 64; m++) {
      const px = x + r.nextInt(8) - r.nextInt(8), py = y + r.nextInt(4) - r.nextInt(4), pz = z + r.nextInt(8) - r.nextInt(8);
      const s = provider(r, px, py, pz);
      if (isAir(lv, px, py, pz) && py > 0 && canSurvive(lv.world, px, py, pz, s)) {
        lv.setState(px, py, pz, s);
        placed++;
      }
    }
    return placed > 0;
  };
}

const weepingVines: Placer = (lv, r, x, y, z) => {
  if (!isAir(lv, x, y, z)) return false;
  const above = lv.getState(x, y + 1, z);
  if (above !== S.netherrack && above !== S.wart) return false;
  // placeRoofNetherWart
  lv.setState(x, y, z, S.wart);
  for (let i = 0; i < 200; i++) {
    const mx = x + r.nextInt(6) - r.nextInt(6), my = y + r.nextInt(2) - r.nextInt(5), mz = z + r.nextInt(6) - r.nextInt(6);
    if (!isAir(lv, mx, my, mz)) continue;
    let j = 0;
    for (const [dx, dy, dz] of DIRS) {
      const s = lv.getState(mx + dx, my + dy, mz + dz);
      if (s === S.netherrack || s === S.wart) j++;
      if (j > 1) break;
    }
    if (j === 1) lv.setState(mx, my, mz, S.wart);
  }
  // placeRoofWeepingVines
  for (let i = 0; i < 100; i++) {
    const mx = x + r.nextInt(8) - r.nextInt(8), my = y + r.nextInt(2) - r.nextInt(7), mz = z + r.nextInt(8) - r.nextInt(8);
    if (!isAir(lv, mx, my, mz)) continue;
    const s = lv.getState(mx, my + 1, mz);
    if (s !== S.netherrack && s !== S.wart) continue;
    let j = nextInt(r, 1, 8);
    if (r.nextInt(6) === 0) j *= 2;
    if (r.nextInt(5) === 0) j = 1;
    weepingColumn(lv, r, mx, my, mz, j, 17, 25);
  }
  return true;
};

function twistingInvalid(lv: GenLevel, x: number, y: number, z: number): boolean {
  if (!isAir(lv, x, y, z)) return true;
  const b = lv.getState(x, y - 1, z);
  return b !== S.netherrack && b !== S.warpedNylium && b !== S.warpedWart;
}

const twistingVines: Placer = (lv, r, x, y, z) => {
  if (twistingInvalid(lv, x, y, z)) return false;
  const spread = 8, height = 4, maxLen = 8;
  for (let n = 0; n < spread * spread * height; n++) {
    const mx = x + nextInt(r, -spread, spread);
    let my = y + nextInt(r, -height, height);
    const mz = z + nextInt(r, -spread, spread);
    // findFirstAirBlockAboveGround
    let ok = true;
    do {
      my--;
      if (my < 0 || my >= 256) {
        ok = false;
        break;
      }
    } while (IS_AIR[lv.getState(mx, my, mz)] === 1);
    if (!ok) continue;
    my++;
    if (twistingInvalid(lv, mx, my, mz)) continue;
    let o = nextInt(r, 1, maxLen);
    if (r.nextInt(6) === 0) o *= 2;
    if (r.nextInt(5) === 0) o = 1;
    twistingColumn(lv, r, mx, my, mz, o, 17, 25);
  }
  return true;
};

// ------------------------------------------------------------------ basalt
const COLUMN_CANNOT_PLACE_ON = new Set(['lava', 'bedrock', 'magma_block', 'soul_sand', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_wart', 'chest', 'spawner']);

function basaltColumns(c: J): Placer {
  const reach = intProvider(c.reach), heightP = intProvider(c.height);
  const airOrLavaOcean = (lv: GenLevel, sea: number, x: number, y: number, z: number) => {
    const s = lv.getState(x, y, z);
    return IS_AIR[s] === 1 || (name(s) === 'lava' && y <= sea);
  };
  const canPlaceAt = (lv: GenLevel, sea: number, x: number, y: number, z: number) => {
    if (!airOrLavaOcean(lv, sea, x, y, z)) return false;
    const b = lv.getState(x, y - 1, z);
    return IS_AIR[b] !== 1 && !COLUMN_CANNOT_PLACE_ON.has(name(b));
  };
  const placeColumn = (lv: GenLevel, sea: number, px: number, py: number, pz: number, height: number, rch: number): boolean => {
    let placed = false;
    for (let z = pz - rch; z <= pz + rch; z++)
      for (let x = px - rch; x <= px + rch; x++) {
        const k = Math.abs(x - px) + Math.abs(z - pz);
        let fy: number | null = null;
        if (airOrLavaOcean(lv, sea, x, py, z)) {
          // findSurface
          let y = py, d = k;
          while (y > 1 && d > 0) {
            d--;
            if (canPlaceAt(lv, sea, x, y, z)) {
              fy = y;
              break;
            }
            y--;
          }
        } else {
          // findAir
          let y = py, d = k;
          while (y < 256 && d > 0) {
            d--;
            const s = lv.getState(x, y, z);
            if (COLUMN_CANNOT_PLACE_ON.has(name(s))) break;
            if (IS_AIR[s] === 1) {
              fy = y;
              break;
            }
            y++;
          }
        }
        if (fy === null) continue;
        for (let l = height - Math.trunc(k / 2), y = fy; l >= 0; l--) {
          if (airOrLavaOcean(lv, sea, x, y, z)) {
            lv.setState(x, y, z, S.basalt);
            y++;
            placed = true;
          } else {
            if (lv.getState(x, y, z) !== S.basalt) break;
            y++;
          }
        }
      }
    return placed;
  };
  return (lv, r, x, y, z) => {
    const sea = lv.seaLevel;
    if (!canPlaceAt(lv, sea, x, y, z)) return false;
    const j = heightP(r);
    const big = r.nextFloat() < Math.fround(0.9);
    const k = Math.min(j, big ? 5 : 8);
    const l = big ? 50 : 15;
    let placed = false;
    for (let n = 0; n < l; n++) {
      // BlockPos.randomBetweenClosed (y range of 1 still draws)
      const px = x - k + r.nextInt(2 * k + 1), py = y + r.nextInt(1), pz = z - k + r.nextInt(2 * k + 1);
      const m = j - (Math.abs(px - x) + Math.abs(py - y) + Math.abs(pz - z));
      if (m >= 0) placed = placeColumn(lv, sea, px, py, pz, m, reach(r)) || placed;
    }
    return placed;
  };
}

const basaltPillar: Placer = (lv, r, x, y, z) => {
  if (!isAir(lv, x, y, z) || isAir(lv, x, y + 1, z)) return false;
  let n = true, s = true, w = true, e = true;
  const hang = (bx: number, by: number, bz: number) => {
    if (r.nextInt(10) !== 0) {
      lv.setState(bx, by, bz, S.basalt);
      return true;
    }
    return false;
  };
  let my = y;
  while (isAir(lv, x, my, z)) {
    if (my < 0 || my >= 256) return true;
    lv.setState(x, my, z, S.basalt);
    n = n && hang(x, my, z - 1);
    s = s && hang(x, my, z + 1);
    w = w && hang(x - 1, my, z);
    e = e && hang(x + 1, my, z);
    my--;
  }
  my++;
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) if (r.nextBoolean()) lv.setState(x + dx, my, z + dz, S.basalt);
  my--;
  for (let i = -3; i < 4; i++)
    for (let j = -3; j < 4; j++) {
      const k = Math.abs(i) * Math.abs(j);
      if (r.nextInt(10) < 10 - k) {
        const bx = x + i, bz = z + j;
        let by = my, l = 3;
        while (isAir(lv, bx, by - 1, bz)) {
          by--;
          if (--l <= 0) break;
        }
        if (!isAir(lv, bx, by - 1, bz)) lv.setState(bx, by, bz, S.basalt);
      }
    }
  return true;
};

// ------------------------------------------------------------------ blobs, deltas, glowstone
/** BlockPos.withinManhattan(center, i, j, k): offsets in order of increasing Manhattan distance (z mirrored pairs). */
export function* withinManhattan(i: number, j: number, k: number): Generator<[number, number, number]> {
  const lmax = i + j + k;
  for (let depth = 0; depth <= lmax; depth++) {
    const maxX = Math.min(i, depth);
    for (let x = -maxX; x <= maxX; x++) {
      const maxY = Math.min(j, depth - Math.abs(x));
      for (let y = -maxY; y <= maxY; y++) {
        const z = depth - Math.abs(x) - Math.abs(y);
        if (z <= k) {
          yield [x, y, z];
          if (z !== 0) yield [x, y, -z];
        }
      }
    }
  }
}

function replaceBlobs(c: J): Placer {
  const target = blockState(c.target), state = blockState(c.state), radius = intProvider(c.radius);
  const targetName = name(target);
  return (lv, r, x, y, z) => {
    let ty = Math.max(1, Math.min(255, y));
    while (ty > 1 && name(lv.getState(x, ty, z)) !== targetName) ty--;
    if (ty <= 1) return false;
    const i = radius(r), j = radius(r), k = radius(r);
    const l = Math.max(i, j, k);
    let placed = false;
    for (const [dx, dy, dz] of withinManhattan(i, j, k)) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > l) break;
      if (name(lv.getState(x + dx, ty + dy, z + dz)) === targetName) {
        lv.setState(x + dx, ty + dy, z + dz, state);
        placed = true;
      }
    }
    return placed;
  };
}

const DELTA_CANNOT_REPLACE = new Set(['bedrock', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_wart', 'chest', 'spawner']);
function delta(c: J): Placer {
  const contents = blockState(c.contents), rim = blockState(c.rim), size = intProvider(c.size), rimSize = intProvider(c.rim_size);
  const contentsName = name(contents);
  const isClear = (lv: GenLevel, x: number, y: number, z: number) => {
    const s = lv.getState(x, y, z);
    if (name(s) === contentsName || DELTA_CANNOT_REPLACE.has(name(s))) return false;
    for (const [dx, dy, dz] of DIRS) {
      const air = IS_AIR[lv.getState(x + dx, y + dy, z + dz)] === 1;
      const up = dy === 1;
      if ((air && !up) || (!air && up)) return false;
    }
    return true;
  };
  return (lv, r, x, y, z) => {
    let placed = false;
    const withRim = r.nextDouble() < 0.9;
    const i = withRim ? rimSize(r) : 0;
    const j = withRim ? rimSize(r) : 0;
    const rimmed = withRim && i !== 0 && j !== 0;
    const k = size(r), l = size(r);
    const m = Math.max(k, l);
    for (const [dx, , dz] of withinManhattan(k, 0, l)) {
      if (Math.abs(dx) + Math.abs(dz) > m) break;
      const px = x + dx, pz = z + dz;
      if (!isClear(lv, px, y, pz)) continue;
      if (rimmed) {
        placed = true;
        lv.setState(px, y, pz, rim);
      }
      if (isClear(lv, px + i, y, pz + j)) {
        placed = true;
        lv.setState(px + i, y, pz + j, contents);
      }
    }
    return placed;
  };
}

const glowstoneBlob: Placer = (lv, r, x, y, z) => {
  if (!isAir(lv, x, y, z)) return false;
  const above = lv.getState(x, y + 1, z);
  if (above !== S.netherrack && name(above) !== 'basalt' && above !== S.blackstone) return false;
  lv.setState(x, y, z, S.glowstone);
  for (let i = 0; i < 1500; i++) {
    const px = x + r.nextInt(8) - r.nextInt(8), py = y - r.nextInt(12), pz = z + r.nextInt(8) - r.nextInt(8);
    if (IS_AIR[lv.getState(px, py, pz)] !== 1) continue;
    let j = 0;
    for (const [dx, dy, dz] of DIRS) {
      if (lv.getState(px + dx, py + dy, pz + dz) === S.glowstone) j++;
      if (j > 1) break;
    }
    if (j === 1) lv.setState(px, py, pz, S.glowstone);
  }
  return true;
};

/** Feature types this file implements (engine.ts dispatches to them). */
export function netherFeature(type: string, c: J): Placer | null {
  switch (type) {
    case 'minecraft:huge_fungus': return hugeFungus(c);
    case 'minecraft:nether_forest_vegetation': return netherForestVegetation(c);
    case 'minecraft:weeping_vines': return weepingVines;
    case 'minecraft:twisting_vines': return twistingVines;
    case 'minecraft:basalt_columns': return basaltColumns(c);
    case 'minecraft:basalt_pillar': return basaltPillar;
    case 'minecraft:delta_feature': return delta(c);
    case 'minecraft:netherrack_replace_blobs': return replaceBlobs(c);
    case 'minecraft:glowstone_blob': return glowstoneBlob;
  }
  return null;
}
