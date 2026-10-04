/**
 * Which configured features make chunk decoration expensive: total and max ms per biome
 * feature slot over an area. Usage: pnpm tsx --tsconfig server/tsconfig.json tools/bench/featprof.ts [seed] [chunks]
 */
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { BlockWorld } from '@shared/world/world';
import { JavaRandom } from '@shared/util/random';
import { decorationSeed, featureSeed } from '@shared/worldgen/rand';
import { WORLDGEN } from '@shared/worldgen/features/data';
import { GenLevel } from '@shared/worldgen/features/level';
import { biomeFeatures, BIOME_NAMES, STRUCTURES_PER_STEP } from '@shared/worldgen/overworld/features';

const seed = BigInt(process.argv[2] ?? '20211');
const n = Number(process.argv[3] ?? 10);
const gen = new OverworldGenerator(seed);
const world = new BlockWorld();
for (let cz = -1; cz <= n; cz++) for (let cx = -1; cx <= n; cx++) world.addChunk(gen.generate(cx, cz));
const stats = new Map<string, { total: number; max: number; count: number }>();
for (let cz = 0; cz < n; cz++)
  for (let cx = 0; cx < n; cx++) {
    const x = cx << 4, z = cz << 4;
    const biome = gen.quartBiome((cx << 2) + 2, (cz << 2) + 2);
    const names = WORLDGEN.biomes[BIOME_NAMES[biome] ?? 'plains']!.features;
    const dec = decorationSeed(gen.seed, x, z);
    const level = new GenLevel(world, gen, cx, cz);
    biomeFeatures(biome).forEach((features, step) => {
      let index = STRUCTURES_PER_STEP[step] ?? 0;
      features.forEach((place, fi) => {
        const rand = new JavaRandom(featureSeed(dec, index++, step));
        const t = performance.now();
        place(level, rand, x, 0, z);
        const d = performance.now() - t;
        const fj = names[step]![fi] as unknown;
        const key = typeof fj === 'string' ? fj : JSON.stringify(fj).slice(0, 80);
        const s = stats.get(key) ?? { total: 0, max: 0, count: 0 };
        s.total += d;
        s.max = Math.max(s.max, d);
        s.count++;
        stats.set(key, s);
      });
    });
  }
for (const [k, s] of [...stats].sort((a, b) => b[1].total - a[1].total).slice(0, 15)) console.log(s.total.toFixed(0).padStart(6), 'ms total', s.max.toFixed(1).padStart(6), 'max', String(s.count).padStart(4), 'x', k);
