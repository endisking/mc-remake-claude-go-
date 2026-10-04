/**
 * Value providers used by configured features (vanilla 1.17 IntProvider, FloatProvider,
 * HeightProvider/VerticalAnchor, BlockStateProvider, RuleTest), read from the generated
 * worldgen data.
 */
import { JavaRandom } from '../../util/random';
import { stateOf, blockNameOf, getProp, withProp, type Props } from '../../world/blockstate';
import { BIOME_INFO_NOISE } from '../../world/climate';
import { PerlinSimplexNoise } from '../../util/noise';
import { WORLDGEN } from './data';

// ------------------------------------------------------------------ helpers
/** Mth.randomBetweenInclusive */
export function randomBetween(r: JavaRandom, min: number, max: number): number {
  return r.nextInt(max - min + 1) + min;
}
/** Mth.nextInt(random, min, max): min if min >= max */
export function mthNextInt(r: JavaRandom, min: number, max: number): number {
  return min >= max ? min : r.nextInt(max - min + 1) + min;
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ------------------------------------------------------------------ block states
const stateCache = new Map<string, number>();
/** A block state from {Name, Properties} JSON. */
export function blockState(j: J): number {
  const key = JSON.stringify(j);
  let s = stateCache.get(key);
  if (s === undefined) {
    const props: Props = {};
    for (const [k, v] of Object.entries((j.Properties ?? {}) as Record<string, string>)) props[k] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v;
    s = stateOf(String(j.Name).replace('minecraft:', ''), props);
    stateCache.set(key, s);
  }
  return s;
}

export function blockName(s: number): string {
  return blockNameOf(s);
}

/** Block tag membership (resolved tags from the generated data). */
const tagSets = new Map<string, Set<string>>();
export function inTag(tag: string, state: number): boolean {
  const name = tag.replace('minecraft:', '');
  let set = tagSets.get(name);
  if (!set) tagSets.set(name, (set = new Set(WORLDGEN.block_tags[name] ?? [])));
  return set.has(blockNameOf(state));
}

// ------------------------------------------------------------------ int / float providers
export type IntProvider = (r: JavaRandom) => number;
export function intProvider(j: J): IntProvider {
  if (typeof j === 'number') return () => j;
  const v = j.value ?? j;
  switch (j.type) {
    case 'minecraft:constant': return () => v as number;
    case 'minecraft:uniform': return (r) => randomBetween(r, v.min_inclusive, v.max_inclusive);
    case 'minecraft:biased_to_bottom': return (r) => v.min_inclusive + r.nextInt(r.nextInt(v.max_inclusive - v.min_inclusive + 1) + 1);
    case 'minecraft:clamped': {
      const src = intProvider(v.source);
      return (r) => Math.min(v.max_inclusive, Math.max(v.min_inclusive, src(r)));
    }
    default: throw new Error(`int provider ${j.type}`);
  }
}

export type FloatProvider = (r: JavaRandom) => number;
const f = Math.fround;
export function floatProvider(j: J): FloatProvider {
  if (typeof j === 'number') return () => f(j);
  const v = j.value ?? j;
  switch (j.type) {
    case 'minecraft:constant': return () => f(v as number);
    case 'minecraft:uniform': return (r) => f(f(r.nextFloat() * f(v.max_exclusive - v.min_inclusive)) + f(v.min_inclusive));
    case 'minecraft:clamped_normal': return (r) => f(Math.min(v.max, Math.max(v.min, f(v.mean + f(r.nextGaussian() * v.deviation)))));
    case 'minecraft:trapezoid': {
      const range = v.max - v.min, plateau = v.plateau, sides = (range - plateau) / 2, slope = range - sides;
      return (r) => f(v.min + f(r.nextFloat() * slope) + f(r.nextFloat() * sides));
    }
    default: throw new Error(`float provider ${j.type}`);
  }
}

// ------------------------------------------------------------------ heights
/** VerticalAnchor.resolveY in a 0–255 overworld. */
export function anchor(j: J): number {
  if ('absolute' in j) return j.absolute;
  if ('above_bottom' in j) return 0 + j.above_bottom;
  if ('below_top' in j) return 255 - j.below_top;
  throw new Error(`anchor ${JSON.stringify(j)}`);
}

export type HeightProvider = (r: JavaRandom) => number;
export function heightProvider(j: J): HeightProvider {
  switch (j.type) {
    case undefined: case 'minecraft:constant': {
      const y = anchor(j.value ?? j);
      return () => y;
    }
    case 'minecraft:uniform': {
      const min = anchor(j.min_inclusive), max = anchor(j.max_inclusive);
      return (r) => (min > max ? min : randomBetween(r, min, max));
    }
    case 'minecraft:biased_to_bottom': {
      const min = anchor(j.min_inclusive), max = anchor(j.max_inclusive), inner = j.inner ?? 1;
      return (r) => {
        if (max - min - inner + 1 <= 0) return min;
        const k = r.nextInt(max - min - inner + 1);
        return r.nextInt(k + inner) + min;
      };
    }
    case 'minecraft:very_biased_to_bottom': {
      const min = anchor(j.min_inclusive), max = anchor(j.max_inclusive), inner = j.inner ?? 1;
      return (r) => {
        if (max - min - inner + 1 <= 0) return min;
        const k = mthNextInt(r, min + inner, max);
        const l = mthNextInt(r, min, k - 1);
        return mthNextInt(r, min, l - 1 + inner);
      };
    }
    case 'minecraft:trapezoid': {
      const min = anchor(j.min_inclusive), max = anchor(j.max_inclusive), plateau = j.plateau ?? 0;
      return (r) => {
        const k = max - min;
        if (plateau >= k) return randomBetween(r, min, max);
        const l = Math.trunc((k - plateau) / 2), m = k - l;
        return min + randomBetween(r, 0, m) + randomBetween(r, 0, l);
      };
    }
    default: throw new Error(`height provider ${j.type}`);
  }
}

// ------------------------------------------------------------------ rule tests (ore targets)
export type RuleTest = (state: number, r: JavaRandom) => boolean;
export function ruleTest(j: J): RuleTest {
  switch (j.predicate_type) {
    case 'minecraft:always_true': return () => true;
    case 'minecraft:tag_match': return (s) => inTag(j.tag, s);
    case 'minecraft:block_match': {
      const n = String(j.block).replace('minecraft:', '');
      return (s) => blockNameOf(s) === n;
    }
    case 'minecraft:blockstate_match': {
      const st = blockState(j.block_state);
      return (s) => s === st;
    }
    case 'minecraft:random_block_match': {
      const n = String(j.block).replace('minecraft:', '');
      return (s, r) => blockNameOf(s) === n && r.nextFloat() < j.probability;
    }
    case 'minecraft:random_blockstate_match': {
      const st = blockState(j.block_state);
      return (s, r) => s === st && r.nextFloat() < j.probability;
    }
    default: throw new Error(`rule test ${j.predicate_type}`);
  }
}

// ------------------------------------------------------------------ block state providers
export type StateProvider = (r: JavaRandom, x: number, y: number, z: number) => number;

const FLOWER_NOISE = new PerlinSimplexNoise(new JavaRandom(2345n), [0]);
const FOREST_FLOWERS = ['dandelion', 'poppy', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'].map((n) => stateOf(n));
const LOW_NOISE_FLOWERS = ['orange_tulip', 'red_tulip', 'pink_tulip', 'white_tulip'].map((n) => stateOf(n));
const HIGH_NOISE_FLOWERS = ['poppy', 'azure_bluet', 'oxeye_daisy', 'cornflower'].map((n) => stateOf(n));

export function stateProvider(j: J): StateProvider {
  switch (j.type) {
    case 'minecraft:simple_state_provider': {
      const s = blockState(j.state);
      return () => s;
    }
    case 'minecraft:rotated_block_provider': {
      const s = blockState(j.state);
      // RotatedBlockProvider: a random axis
      return (r) => withProp(s, 'axis', ['x', 'y', 'z'][r.nextInt(3)]!);
    }
    case 'minecraft:weighted_state_provider': {
      const entries = (j.entries as J[]).map((e) => ({ s: blockState(e.data), w: e.weight as number }));
      const total = entries.reduce((a, e) => a + e.w, 0);
      // SimpleWeightedRandomList.getRandomValue: nextInt(total), walk the weights
      return (r) => {
        let i = r.nextInt(total);
        for (const e of entries) {
          i -= e.w;
          if (i < 0) return e.s;
        }
        return entries[entries.length - 1]!.s;
      };
    }
    case 'minecraft:forest_flower_provider': {
      // ForestFlowerProvider: noise picks among 11 flowers
      return (_r, x, _y, z) => {
        const d = Math.max(0, Math.min(0.9999, (1 + BIOME_INFO_NOISE.getValue(x / 48, z / 48, false)) / 2));
        return FOREST_FLOWERS[Math.trunc(d * FOREST_FLOWERS.length)]!;
      };
    }
    case 'minecraft:plain_flower_provider': {
      // PlainFlowerProvider: tulips where the noise is low, otherwise mostly poppies/bluets/daisies/cornflowers or dandelions
      return (r, x, _y, z) => {
        const d = FLOWER_NOISE.getValue(x / 200, z / 200, false);
        if (d < -0.8) return LOW_NOISE_FLOWERS[r.nextInt(LOW_NOISE_FLOWERS.length)]!;
        return r.nextInt(3) > 0 ? HIGH_NOISE_FLOWERS[r.nextInt(HIGH_NOISE_FLOWERS.length)]! : stateOf('dandelion');
      };
    }
    default: throw new Error(`state provider ${j.type}`);
  }
}

export { getProp, withProp };
