/**
 * Surface and vegetation features (vanilla 1.17.1): huge mushrooms, bamboo, jungle vines, warm
 * ocean coral reefs, icebergs, blue ice, ice spikes, desert wells, forest rocks and single-block
 * replacement (emerald ore). Each mirrors the decompiled 1.17.1 Feature class: the same random
 * calls in the same order, float maths rounded through Math.fround like Java floats.
 */
import { JavaRandom } from '../../util/random';
import { stateOf, blockNameOf, getProp, withProp, type Props } from '../../world/blockstate';
import { IS_AIR, FULL_COLLISION, LIGHT_FILTER } from '../../world/blockinfo';
import type { GenLevel } from './level';
import { blockState, ruleTest, stateProvider, inTag } from './providers';
import type { Placer } from './engine';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const f = Math.fround;

/** A block state that must have every given property (withProp ignores unknown values). */
function st(name: string, props?: Props): number {
  const s = stateOf(name, props);
  if (props) for (const k in props) if (getProp(s, k) !== props[k]) throw new Error(`no state ${name}[${k}=${props[k]}]`);
  return s;
}

/** Java (int) cast of a float/double. */
function toInt(x: number): number {
  if (x !== x) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return Math.trunc(x) | 0; // no -0: a radius of -0 would flip a division's infinity
}
/** Mth.ceil(float) */
function ceilF(x: number): number {
  const i = toInt(x);
  return x > i ? i + 1 : i;
}
/** Java integer division */
const idiv = (a: number, b: number) => Math.trunc(a / b);

const AIR = stateOf('air');
const STONE = stateOf('stone');
const WATER = stateOf('water');
const name = (lv: GenLevel, x: number, y: number, z: number) => blockNameOf(lv.getState(x, y, z));
/** Feature.isDirt (1.17: the dirt tag) */
const isDirt = (s: number) => inTag('dirt', s);
/** Feature.isStone */
const STONES = new Set(['stone', 'granite', 'diorite', 'andesite']);
const isStone = (s: number) => STONES.has(blockNameOf(s));
/** BlockState.isSolidRender: an opaque full cube. */
const isSolidRender = (s: number) => FULL_COLLISION[s] === 1 && LIGHT_FILTER[s] === 15;
/** Block.isFaceFull(collision shape, face): approximated by a full-cube collision shape. */
const faceFull = (s: number) => FULL_COLLISION[s] === 1;

// Direction.values(): DOWN, UP, NORTH, SOUTH, WEST, EAST
const DIR_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
const DIR_X = [0, 0, 0, 0, -1, 1], DIR_Y = [-1, 1, 0, 0, 0, 0], DIR_Z = [0, 0, -1, 1, 0, 0];
// Direction.Plane.HORIZONTAL: NORTH, EAST, SOUTH, WEST (indices into the arrays above)
const N = 2, E = 5, S = 3, W = 4;
const HORIZONTAL = [N, E, S, W];
const clockWise = (d: number) => HORIZONTAL[(HORIZONTAL.indexOf(d) + 1) % 4]!;
const counterClockWise = (d: number) => HORIZONTAL[(HORIZONTAL.indexOf(d) + 3) % 4]!;
const opposite = (d: number) => [1, 0, 3, 2, 5, 4][d]!;

/** Collections.shuffle(list, random) */
function shuffle<T>(list: T[], r: JavaRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}

// ------------------------------------------------------------------ huge mushrooms
/** AbstractHugeMushroomFeature + HugeRedMushroomFeature / HugeBrownMushroomFeature */
export function hugeMushroom(c: J, red: boolean): Placer {
  const cap = stateProvider(c.cap_provider), stem = stateProvider(c.stem_provider), radius = c.foliage_radius as number;
  const radiusForHeight = red
    ? (height: number, y: number) => (y < height && y >= height - 3 ? radius : y === height ? radius : 0)
    : (_height: number, y: number) => (y <= 3 ? 0 : radius);
  const setIfNotSolid = (lv: GenLevel, x: number, y: number, z: number, s: number) => {
    if (!isSolidRender(lv.getState(x, y, z))) lv.setState(x, y, z, s);
  };
  const makeCap = red
    ? (lv: GenLevel, r: JavaRandom, ox: number, oy: number, oz: number, height: number) => {
        for (let i = height - 3; i <= height; i++) {
          const j = i < height ? radius : radius - 1, k = radius - 2;
          for (let l = -j; l <= j; l++)
            for (let m = -j; m <= j; m++) {
              const edgeX = l === -j || l === j, edgeZ = m === -j || m === j;
              if (!(i >= height || edgeX !== edgeZ)) continue;
              if (isSolidRender(lv.getState(ox + l, oy + i, oz + m))) continue;
              let s = cap(r, ox, oy, oz);
              if (getProp(s, 'west') !== undefined)
                s = withProp(withProp(withProp(withProp(withProp(s, 'up', i >= height - 1), 'west', l < -k), 'east', l > k), 'north', m < -k), 'south', m > k);
              lv.setState(ox + l, oy + i, oz + m, s);
            }
        }
      }
    : (lv: GenLevel, r: JavaRandom, ox: number, oy: number, oz: number, height: number) => {
        const i = radius;
        for (let j = -i; j <= i; j++)
          for (let k = -i; k <= i; k++) {
            const f0 = j === -i, f1 = j === i, f2 = k === -i, f3 = k === i;
            const f4 = f0 || f1, f5 = f2 || f3;
            if (f4 && f5) continue;
            if (isSolidRender(lv.getState(ox + j, oy + height, oz + k))) continue;
            const west = f0 || (f5 && j === 1 - i), east = f1 || (f5 && j === i - 1);
            const north = f2 || (f4 && k === 1 - i), south = f3 || (f4 && k === i - 1);
            let s = cap(r, ox, oy, oz);
            if (getProp(s, 'west') !== undefined) s = withProp(withProp(withProp(withProp(s, 'west', west), 'east', east), 'north', north), 'south', south);
            lv.setState(ox + j, oy + height, oz + k, s);
          }
      };
  return (lv, r, x, y, z) => {
    let height = r.nextInt(3) + 4;
    if (r.nextInt(12) === 0) height *= 2;
    // isValidPosition (getTreeRadiusForHeight is called with height -1: red checks only the stem column)
    if (y < lv.minY + 1 || y + height + 1 >= lv.minY + lv.height) return false;
    const below = lv.getState(x, y - 1, z);
    if (!isDirt(below) && !inTag('mushroom_grow_block', below)) return false;
    for (let j = 0; j <= height; j++) {
      const k = radiusForHeight(-1, j);
      for (let l = -k; l <= k; l++)
        for (let m = -k; m <= k; m++) {
          const s = lv.getState(x + l, y + j, z + m);
          if (IS_AIR[s] !== 1 && !inTag('leaves', s)) return false;
        }
    }
    makeCap(lv, r, x, y, z, height);
    for (let i = 0; i < height; i++) setIfNotSolid(lv, x, y + i, z, stem(r, x, y, z));
    return true;
  };
}

// ------------------------------------------------------------------ bamboo
const BAMBOO_TRUNK = st('bamboo', { age: 1, leaves: 'none', stage: 0 });
const BAMBOO_FINAL_LARGE = st('bamboo', { age: 1, leaves: 'large', stage: 1 });
const BAMBOO_TOP_LARGE = st('bamboo', { age: 1, leaves: 'large', stage: 0 });
const BAMBOO_TOP_SMALL = st('bamboo', { age: 1, leaves: 'small', stage: 0 });
const PODZOL = st('podzol', { snowy: false });

/** BambooFeature: a 5–16 tall stalk, sometimes on a podzol disk. */
export function bamboo(c: J): Placer {
  const p = f(c.probability);
  return (lv, r, x, y, z) => {
    if (!lv.isEmpty(x, y, z)) return false;
    if (inTag('bamboo_plantable_on', lv.getState(x, y - 1, z))) {
      const j = r.nextInt(12) + 5;
      if (r.nextFloat() < p) {
        const k = r.nextInt(4) + 1;
        for (let l = x - k; l <= x + k; l++)
          for (let m = z - k; m <= z + k; m++) {
            const dx = l - x, dz = m - z;
            if (dx * dx + dz * dz > k * k) continue;
            const h = lv.getHeight('WORLD_SURFACE', l, m) - 1;
            if (isDirt(lv.getState(l, h, m))) lv.setState(l, h, m, PODZOL);
          }
      }
      let my = y;
      for (let l = 0; l < j && lv.isEmpty(x, my, z); l++) lv.setState(x, my++, z, BAMBOO_TRUNK);
      if (my - y >= 3) {
        lv.setState(x, my, z, BAMBOO_FINAL_LARGE);
        lv.setState(x, my - 1, z, BAMBOO_TOP_LARGE);
        lv.setState(x, my - 2, z, BAMBOO_TOP_SMALL);
      }
    }
    return true;
  };
}

// ------------------------------------------------------------------ vines
const VINE_FACES = [1, 2, 3, 4, 5].map((d) => ({ d, s: st('vine', { [DIR_NAMES[d]!]: true }) }));
/** VinesFeature (1.17.1): from y 64 up to the build limit, a vine on each air block next to a full face. */
const vineTop = new Int16Array(49);
export const vines: Placer = (lv, r, ox, _oy, oz) => {
  // (speed-up, same result) above the world surface of a column and its four neighbours there
  // is only air, so no vine: vineTop caches that height for the 7×7 columns the loop can visit
  vineTop.fill(-1);
  const top = (x: number, z: number) => {
    const i = (x - ox + 3) * 7 + (z - oz + 3);
    let h = vineTop[i]!;
    if (h < 0) {
      h = Math.max(lv.getHeight('WORLD_SURFACE', x, z), lv.getHeight('WORLD_SURFACE', x - 1, z), lv.getHeight('WORLD_SURFACE', x + 1, z),
        lv.getHeight('WORLD_SURFACE', x, z - 1), lv.getHeight('WORLD_SURFACE', x, z + 1));
      vineTop[i] = h;
    }
    return h;
  };
  for (let y = 64; y < 256; y++) {
    const x = ox + r.nextInt(4) - r.nextInt(4);
    const z = oz + r.nextInt(4) - r.nextInt(4);
    if (y >= top(x, z) || !lv.isEmpty(x, y, z)) continue;
    for (const { d, s } of VINE_FACES)
      if (faceFull(lv.getState(x + DIR_X[d]!, y + DIR_Y[d]!, z + DIR_Z[d]!))) {
        lv.setState(x, y, z, s);
        break;
      }
  }
  return true;
};

// ------------------------------------------------------------------ coral
// tag contents in vanilla tag-file order (Tag.getRandomElement picks by index)
const CORAL_KINDS = ['tube', 'brain', 'bubble', 'fire', 'horn'];
const CORAL_BLOCKS = CORAL_KINDS.map((k) => st(`${k}_coral_block`));
const CORALS = [...CORAL_KINDS.map((k) => st(`${k}_coral`, { waterlogged: true })), ...CORAL_KINDS.map((k) => st(`${k}_coral_fan`, { waterlogged: true }))];
const WALL_CORALS = CORAL_KINDS.map((k) => st(`${k}_coral_wall_fan`, { waterlogged: true, facing: 'north' }));
const SEA_PICKLE = st('sea_pickle', { pickles: 1, waterlogged: true });
const CORAL_NAMES = new Set(CORALS.map(blockNameOf));

/** CoralFeature.placeCoralBlock: a coral block in water, maybe topped by a coral or pickle, with wall fans. */
function placeCoralBlock(lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, s: number): boolean {
  const here = name(lv, x, y, z);
  if (!((here === 'water' || CORAL_NAMES.has(here)) && name(lv, x, y + 1, z) === 'water')) return false;
  lv.setState(x, y, z, s);
  if (r.nextFloat() < f(0.25)) lv.setState(x, y + 1, z, CORALS[r.nextInt(CORALS.length)]!);
  else if (r.nextFloat() < f(0.05)) lv.setState(x, y + 1, z, withProp(SEA_PICKLE, 'pickles', r.nextInt(4) + 1));
  for (const d of HORIZONTAL) {
    if (r.nextFloat() < f(0.2)) {
      const a = x + DIR_X[d]!, b = z + DIR_Z[d]!;
      if (name(lv, a, y, b) === 'water') lv.setState(a, y, b, withProp(WALL_CORALS[r.nextInt(WALL_CORALS.length)]!, 'facing', DIR_NAMES[d]!));
    }
  }
  return true;
}

type CoralShape = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, s: number) => boolean;
function coral(shape: CoralShape): Placer {
  return (lv, r, x, y, z) => shape(lv, r, x, y, z, CORAL_BLOCKS[r.nextInt(CORAL_BLOCKS.length)]!);
}

/** CoralTreeFeature: a short trunk with 2–4 branches. */
export const coralTree = coral((lv, r, ox, oy, oz, s) => {
  let y = oy;
  const i = r.nextInt(3) + 1;
  for (let j = 0; j < i; j++) {
    if (!placeCoralBlock(lv, r, ox, y, oz, s)) return true;
    y++;
  }
  const k = r.nextInt(3) + 2;
  const list = [...HORIZONTAL];
  shuffle(list, r);
  for (const d of list.slice(0, k)) {
    let x = ox + DIR_X[d]!, my = y, z = oz + DIR_Z[d]!;
    const l = r.nextInt(5) + 2;
    let m = 0;
    for (let j = 0; j < l && placeCoralBlock(lv, r, x, my, z, s); j++) {
      m++;
      my++;
      if (j === 0 || (m >= 2 && r.nextFloat() < f(0.25))) {
        x += DIR_X[d]!;
        z += DIR_Z[d]!;
        m = 0;
      }
    }
  }
  return true;
});

/** CoralClawFeature: a coral block with 2–3 claws reaching out and up. */
export const coralClaw = coral((lv, r, ox, oy, oz, s) => {
  if (!placeCoralBlock(lv, r, ox, oy, oz, s)) return false;
  const dir = HORIZONTAL[r.nextInt(4)]!;
  const i = r.nextInt(2) + 2;
  const list = [dir, clockWise(dir), counterClockWise(dir)];
  shuffle(list, r);
  for (const d1 of list.slice(0, i)) {
    let x = ox, y = oy, z = oz;
    const j = r.nextInt(2) + 1;
    x += DIR_X[d1]!;
    z += DIR_Z[d1]!;
    let k: number, d2: number;
    if (d1 === dir) {
      d2 = dir;
      k = r.nextInt(3) + 2;
    } else {
      y++;
      d2 = [d1, 1][r.nextInt(2)]!;
      k = r.nextInt(3) + 3;
    }
    for (let l = 0; l < j && placeCoralBlock(lv, r, x, y, z, s); l++) {
      x += DIR_X[d2]!;
      y += DIR_Y[d2]!;
      z += DIR_Z[d2]!;
    }
    const o = opposite(d2);
    x += DIR_X[o]!;
    y += DIR_Y[o]! + 1;
    z += DIR_Z[o]!;
    for (let m = 0; m < k; m++) {
      x += DIR_X[dir]!;
      z += DIR_Z[dir]!;
      if (!placeCoralBlock(lv, r, x, y, z, s)) break;
      if (r.nextFloat() < f(0.25)) y++;
    }
  }
  return true;
});

/** CoralMushroomFeature: a hollow box of coral, sunk 1–3 blocks into the floor. */
export const coralMushroom = coral((lv, r, ox, oy, oz, s) => {
  const i = r.nextInt(3) + 3, j = r.nextInt(3) + 3, k = r.nextInt(3) + 3, l = r.nextInt(3) + 1;
  for (let a = 0; a <= j; a++)
    for (let b = 0; b <= i; b++)
      for (let c = 0; c <= k; c++) {
        const x = a + ox, y = b + oy - l, z = c + oz;
        if (((a !== 0 && a !== j) || (b !== 0 && b !== i)) && ((c !== 0 && c !== k) || (b !== 0 && b !== i)) && ((a !== 0 && a !== j) || (c !== 0 && c !== k)) &&
          (a === 0 || a === j || b === 0 || b === i || c === 0 || c === k) && !(r.nextFloat() < f(0.1)))
          placeCoralBlock(lv, r, x, y, z, s);
      }
  return true;
});

// ------------------------------------------------------------------ iceberg
const SNOW_BLOCK = stateOf('snow_block');
const isIcebergState = (n: string) => n === 'packed_ice' || n === 'snow_block' || n === 'blue_ice';

function signedDistanceCircle(x: number, z: number, radius: number, r: JavaRandom): number {
  const v = r.nextFloat();
  const g = f(f(10 * (v < f(0.2) ? f(0.2) : Math.min(v, f(0.8)))) / radius);
  return g + x * x + z * z - radius * radius;
}
function signedDistanceEllipse(x: number, z: number, cx: number, cz: number, a: number, c: number, angle: number): number {
  const dx = x - cx, dz = z - cz;
  const u = (dx * Math.cos(angle) - dz * Math.sin(angle)) / a, v = (dx * Math.sin(angle) + dz * Math.cos(angle)) / c;
  return u * u + v * v - 1;
}
function heightDependentRadiusRound(r: JavaRandom, y: number, height: number, radius: number): number {
  const g = f(3.5 - r.nextFloat());
  let g1 = f(f(1 - f(f(y * y) / f(height * g))) * radius);
  if (height > 15 + r.nextInt(5)) {
    const i = y < 3 + r.nextInt(6) ? idiv(y, 2) : y;
    g1 = f(f(1 - f(i / f(f(height * g) * f(0.4)))) * radius);
  }
  return ceilF(f(g1 / 2));
}
function heightDependentRadiusEllipse(y: number, height: number, radius: number): number {
  return ceilF(f(f(f(1 - f(f(y * y) / f(height))) * radius) / 2));
}
function heightDependentRadiusSteep(r: JavaRandom, y: number, height: number, radius: number): number {
  const g = f(1 + f(r.nextFloat() / 2));
  return ceilF(f(f(f(1 - f(y / f(height * g))) * radius) / 2));
}
function getEllipseC(y: number, height: number, value: number): number {
  return y > 0 && height - y <= 3 ? value - (4 - (height - y)) : value;
}

/** IcebergFeature: a round or elliptical berg of packed/blue ice at sea level, snow-capped sometimes, with a cut-out arch. */
export function iceberg(c: J): Placer {
  const state = blockState(c.state);
  const setIcebergBlock = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, remaining: number, height: number, ellipse: boolean, snowy: boolean) => {
    const s = lv.getState(x, y, z), n = blockNameOf(s);
    if (IS_AIR[s] !== 1 && n !== 'snow_block' && n !== 'ice' && n !== 'water') return;
    const ok = !ellipse || r.nextDouble() > 0.05;
    const i = ellipse ? 3 : 2;
    if (snowy && n !== 'water' && remaining <= r.nextInt(Math.max(1, idiv(height, i))) + height * 0.6 && ok) lv.setState(x, y, z, SNOW_BLOCK);
    else lv.setState(x, y, z, state);
  };
  const generateIcebergBlock = (lv: GenLevel, r: JavaRandom, ox: number, oy: number, oz: number, height: number, x: number, y: number, z: number, radius: number, a: number, ellipse: boolean, cc: number, angle: number, snowy: boolean) => {
    const d0 = ellipse ? signedDistanceEllipse(x, z, 0, 0, a, getEllipseC(y, height, cc), angle) : signedDistanceCircle(x, z, radius, r);
    if (d0 < 0) {
      const d1 = ellipse ? -0.5 : -6 - r.nextInt(3);
      if (d0 > d1 && r.nextDouble() > 0.9) return;
      setIcebergBlock(lv, r, ox + x, oy + y, oz + z, height - y, height, ellipse, snowy);
    }
  };
  const carve = (lv: GenLevel, radius: number, y: number, ox: number, oy: number, oz: number, underwater: boolean, angle: number, offX: number, offZ: number, k1: number, j: number) => {
    const i = radius + 1 + idiv(k1, 3);
    const jj = Math.min(radius - 3, 3) + idiv(j, 2) - 1;
    for (let k = -i; k < i; k++)
      for (let l = -i; l < i; l++) {
        if (!(signedDistanceEllipse(k, l, offX, offZ, i, jj, angle) < 0)) continue;
        const x = ox + k, by = oy + y, z = oz + l;
        const n = name(lv, x, by, z);
        if (!isIcebergState(n) && n !== 'snow_block') continue;
        if (underwater) lv.setState(x, by, z, WATER);
        else {
          lv.setState(x, by, z, AIR);
          if (name(lv, x, by + 1, z) === 'snow') lv.setState(x, by + 1, z, AIR);
        }
      }
  };
  const generateCutOut = (r: JavaRandom, lv: GenLevel, radius: number, height: number, ox: number, oy: number, oz: number, ellipse: boolean, k1: number, angle: number, j: number) => {
    const sx = r.nextBoolean() ? -1 : 1, sz = r.nextBoolean() ? -1 : 1;
    let k = r.nextInt(Math.max(idiv(radius, 2) - 2, 1));
    if (r.nextBoolean()) k = idiv(radius, 2) + 1 - r.nextInt(Math.max(radius - idiv(radius, 2) - 1, 1));
    let l = r.nextInt(Math.max(idiv(radius, 2) - 2, 1));
    if (r.nextBoolean()) l = idiv(radius, 2) + 1 - r.nextInt(Math.max(radius - idiv(radius, 2) - 1, 1));
    if (ellipse) k = l = r.nextInt(Math.max(k1 - 5, 1));
    const offX = sx * k, offZ = sz * l;
    const d0 = ellipse ? angle + Math.PI / 2 : r.nextDouble() * 2 * Math.PI;
    for (let i = 0; i < height - 3; i++) carve(lv, heightDependentRadiusRound(r, i, height, radius), i, ox, oy, oz, false, d0, offX, offZ, k1, j);
    for (let i = -1; i > -height + r.nextInt(5); i--) carve(lv, heightDependentRadiusSteep(r, -i, height, radius), i, ox, oy, oz, true, d0, offX, offZ, k1, j);
  };
  const smooth = (lv: GenLevel, ox: number, oy: number, oz: number, radius: number, height: number, ellipse: boolean, k1: number) => {
    const i = ellipse ? k1 : idiv(radius, 2);
    for (let j = -i; j <= i; j++)
      for (let k = -i; k <= i; k++)
        for (let l = 0; l <= height; l++) {
          const x = ox + j, y = oy + l, z = oz + k;
          const n = name(lv, x, y, z);
          if (!isIcebergState(n) && n !== 'snow') continue;
          if (IS_AIR[lv.getState(x, y - 1, z)] === 1) {
            lv.setState(x, y, z, AIR);
            lv.setState(x, y + 1, z, AIR);
          } else if (isIcebergState(n)) {
            let open = 0;
            for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) if (!isIcebergState(name(lv, x + dx, y, z + dz))) open++;
            if (open >= 3) lv.setState(x, y, z, AIR);
          }
        }
  };
  return (lv, r, ox, _oy, oz) => {
    const oy = lv.seaLevel;
    const snowy = r.nextDouble() > 0.7;
    const angle = r.nextDouble() * 2 * Math.PI;
    const i = 11 - r.nextInt(5);
    const j = 3 + r.nextInt(3);
    const ellipse = r.nextDouble() > 0.7;
    let l = ellipse ? r.nextInt(6) + 6 : r.nextInt(15) + 3;
    if (!ellipse && r.nextDouble() > 0.9) l += r.nextInt(19) + 7;
    const i1 = Math.min(l + r.nextInt(11), 18);
    const j1 = Math.min(l + r.nextInt(7) - r.nextInt(5), 11);
    const k1 = ellipse ? i : 11;
    for (let a = -k1; a < k1; a++)
      for (let b = -k1; b < k1; b++)
        for (let y = 0; y < l; y++) {
          const k2 = ellipse ? heightDependentRadiusEllipse(y, l, j1) : heightDependentRadiusRound(r, y, l, j1);
          if (ellipse || a < k2) generateIcebergBlock(lv, r, ox, oy, oz, l, a, y, b, k2, k1, ellipse, j, angle, snowy);
        }
    smooth(lv, ox, oy, oz, j1, l, ellipse, i);
    for (let a = -k1; a < k1; a++)
      for (let b = -k1; b < k1; b++)
        for (let y = -1; y > -i1; y--) {
          const l3 = ellipse ? ceilF(f(k1 * f(1 - f(f(y * y) / f(i1 * 8))))) : k1;
          const l2 = heightDependentRadiusSteep(r, -y, i1, j1);
          if (a < l2) generateIcebergBlock(lv, r, ox, oy, oz, i1, a, y, b, l2, l3, ellipse, j, angle, snowy);
        }
    const cut = ellipse ? r.nextDouble() > 0.1 : r.nextDouble() > 0.7;
    if (cut) generateCutOut(r, lv, j1, l, ox, oy, oz, ellipse, i, angle, j);
    return true;
  };
}

// ------------------------------------------------------------------ blue ice
const BLUE_ICE = stateOf('blue_ice');
/** BlueIceFeature: a blue ice cluster under packed ice, grown by 200 tries next to existing blue ice. */
export const blueIce: Placer = (lv, r, x, y, z) => {
  if (y > lv.seaLevel - 1) return false;
  if (name(lv, x, y, z) !== 'water' && name(lv, x, y - 1, z) !== 'water') return false;
  let ok = false;
  for (let d = 1; d < 6; d++)
    if (name(lv, x + DIR_X[d]!, y + DIR_Y[d]!, z + DIR_Z[d]!) === 'packed_ice') {
      ok = true;
      break;
    }
  if (!ok) return false;
  lv.setState(x, y, z, BLUE_ICE);
  for (let i = 0; i < 200; i++) {
    const j = r.nextInt(5) - r.nextInt(6);
    let k = 3;
    if (j < 2) k += idiv(j, 2);
    if (k < 1) continue;
    const a = x + r.nextInt(k) - r.nextInt(k), b = y + j, c = z + r.nextInt(k) - r.nextInt(k);
    const s = lv.getState(a, b, c), n = blockNameOf(s);
    if (IS_AIR[s] !== 1 && n !== 'water' && n !== 'packed_ice' && n !== 'ice') continue;
    for (let d = 0; d < 6; d++)
      if (name(lv, a + DIR_X[d]!, b + DIR_Y[d]!, c + DIR_Z[d]!) === 'blue_ice') {
        lv.setState(a, b, c, BLUE_ICE);
        break;
      }
  }
  return true;
};

// ------------------------------------------------------------------ ice spike
const PACKED_ICE = stateOf('packed_ice');
const spikeReplaceable = (s: number) => {
  const n = blockNameOf(s);
  return IS_AIR[s] === 1 || isDirt(s) || n === 'snow_block' || n === 'ice';
};
/** IceSpikeFeature: a packed ice spike (rarely a tall one) on snow, with a root column down to y 50. */
export const iceSpike: Placer = (lv, r, x, y, z) => {
  while (lv.isEmpty(x, y, z) && y > lv.minY + 2) y--;
  if (name(lv, x, y, z) !== 'snow_block') return false;
  y += r.nextInt(4);
  const i = r.nextInt(4) + 7;
  const j = idiv(i, 4) + r.nextInt(2);
  if (j > 1 && r.nextInt(60) === 0) y += 10 + r.nextInt(30);
  for (let k = 0; k < i; k++) {
    const g = f(f(1 - f(k / i)) * j);
    const l = ceilF(g);
    for (let a = -l; a <= l; a++) {
      const g1 = f(Math.abs(a) - 0.25);
      for (let b = -l; b <= l; b++) {
        const g2 = f(Math.abs(b) - 0.25);
        if (!((a === 0 && b === 0) || !(f(f(g1 * g1) + f(g2 * g2)) > f(g * g)))) continue;
        if (!((a !== -l && a !== l && b !== -l && b !== l) || !(r.nextFloat() > f(0.75)))) continue;
        if (spikeReplaceable(lv.getState(x + a, y + k, z + b))) lv.setState(x + a, y + k, z + b, PACKED_ICE);
        if (k !== 0 && l > 1 && spikeReplaceable(lv.getState(x + a, y - k, z + b))) lv.setState(x + a, y - k, z + b, PACKED_ICE);
      }
    }
  }
  const k1 = Math.max(0, Math.min(1, j - 1));
  for (let a = -k1; a <= k1; a++)
    for (let b = -k1; b <= k1; b++) {
      let by = y - 1;
      let j2 = 50;
      if (Math.abs(a) === 1 && Math.abs(b) === 1) j2 = r.nextInt(5);
      while (by > 50) {
        const s = lv.getState(x + a, by, z + b);
        if (!spikeReplaceable(s) && blockNameOf(s) !== 'packed_ice') break;
        lv.setState(x + a, by, z + b, PACKED_ICE);
        by--;
        if (--j2 <= 0) {
          by -= r.nextInt(5) + 1;
          j2 = r.nextInt(5);
        }
      }
    }
  return true;
};

// ------------------------------------------------------------------ desert well
const SANDSTONE = stateOf('sandstone');
const SANDSTONE_SLAB = st('sandstone_slab', { type: 'bottom', waterlogged: false });
/** DesertWellFeature: the fixed 5×5 sandstone well with a water cross and a slab roof on four pillars. */
export const desertWell: Placer = (lv, _r, x, y, z) => {
  for (y++; lv.isEmpty(x, y, z) && y > lv.minY + 2; y--);
  if (name(lv, x, y, z) !== 'sand') return false;
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) if (lv.isEmpty(x + i, y - 1, z + j) && lv.isEmpty(x + i, y - 2, z + j)) return false;
  for (let l = -1; l <= 0; l++)
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) lv.setState(x + a, y + l, z + b, SANDSTONE);
  lv.setState(x, y, z, WATER);
  for (const d of HORIZONTAL) lv.setState(x + DIR_X[d]!, y, z + DIR_Z[d]!, WATER);
  for (let a = -2; a <= 2; a++)
    for (let b = -2; b <= 2; b++) if (a === -2 || a === 2 || b === -2 || b === 2) lv.setState(x + a, y + 1, z + b, SANDSTONE);
  lv.setState(x + 2, y + 1, z, SANDSTONE_SLAB);
  lv.setState(x - 2, y + 1, z, SANDSTONE_SLAB);
  lv.setState(x, y + 1, z + 2, SANDSTONE_SLAB);
  lv.setState(x, y + 1, z - 2, SANDSTONE_SLAB);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) lv.setState(x + a, y + 4, z + b, a === 0 && b === 0 ? SANDSTONE : SANDSTONE_SLAB);
  for (let k = 1; k <= 3; k++) {
    lv.setState(x - 1, y + k, z - 1, SANDSTONE);
    lv.setState(x - 1, y + k, z + 1, SANDSTONE);
    lv.setState(x + 1, y + k, z - 1, SANDSTONE);
    lv.setState(x + 1, y + k, z + 1, SANDSTONE);
  }
  return true;
};

// ------------------------------------------------------------------ forest rock
/** BlockBlobFeature (forest_rock): three overlapping little blobs stepping down from the ground. */
export function forestRock(c: J): Placer {
  const state = blockState(c.state);
  return (lv, r, x, y, z) => {
    for (; y > lv.minY + 3; y--) {
      if (lv.isEmpty(x, y - 1, z)) continue;
      const below = lv.getState(x, y - 1, z);
      if (isDirt(below) || isStone(below)) break;
    }
    if (y <= lv.minY + 3) return false;
    for (let n = 0; n < 3; n++) {
      const i = r.nextInt(2), j = r.nextInt(2), k = r.nextInt(2);
      const g = f(f((i + j + k) * f(0.333)) + 0.5);
      const g2 = f(g * g);
      for (let a = -i; a <= i; a++)
        for (let b = -j; b <= j; b++)
          for (let cc = -k; cc <= k; cc++) {
            // Vec3i.distSqr(Vec3i) measures from the block's centre (+0.5) in 1.17
            const dx = a + 0.5, dy = b + 0.5, dz = cc + 0.5;
            if (dx * dx + dy * dy + dz * dz <= g2) lv.setState(x + a, y + b, z + cc, state);
          }
      x += -1 + r.nextInt(2);
      y += -r.nextInt(2);
      z += -1 + r.nextInt(2);
    }
    return true;
  };
}

// ------------------------------------------------------------------ replace_single_block
/** ReplaceBlockFeature: the first matching target at the position is replaced (emerald ore). */
export function replaceSingleBlock(c: J): Placer {
  const tg = (c.targets as J[]).map((t) => ({ test: ruleTest(t.target), state: blockState(t.state) }));
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

// ------------------------------------------------------------------ void start platform
const COBBLESTONE = stateOf('cobblestone');
/** VoidStartPlatformFeature (the void preset): a 33×33 stone platform at y 3 around (8, 8), cobblestone in its centre. */
export const voidStartPlatform: Placer = (lv, _r, ox, _oy, oz) => {
  const cx = ox >> 4, cz = oz >> 4;
  if (Math.max(Math.abs(cx), Math.abs(cz)) > 1) return true;
  for (let z = cz * 16; z < cz * 16 + 16; z++)
    for (let x = cx * 16; x < cx * 16 + 16; x++)
      if (Math.max(Math.abs(8 - x), Math.abs(8 - z)) <= 16) lv.setState(x, 3, z, x === 8 && z === 8 ? COBBLESTONE : STONE);
  return true;
};
