/**
 * Per-chunk cost of the server chunk pipeline (generate → decorate → light → serialize) with
 * real 1.17 terrain. Usage: pnpm tsx --tsconfig server/tsconfig.json tools/bench/genprof.ts [seed] [chunks]
 */
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { BlockWorld } from '@shared/world/world';
import { LightEngine } from '@shared/world/light';
import { serializeChunk } from '../../server/src/storage/codec';

const seed = BigInt(process.argv[2] ?? '20211');
const n = Number(process.argv[3] ?? 8);
const gen = new OverworldGenerator(seed);
const world = new BlockWorld();
const light = new LightEngine(world);
// warm up (JIT, lazy tables)
for (let i = 0; i < 4; i++) gen.generate(100 + i, 100);
const T = { generate: 0, decorate: 0, light: 0, serialize: 0 };
let t = performance.now();
for (let cz = -1; cz <= n; cz++) for (let cx = -1; cx <= n; cx++) world.addChunk(gen.generate(cx, cz));
T.generate = (performance.now() - t) / ((n + 2) * (n + 2));
t = performance.now();
for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) gen.decorate(world, cx, cz);
T.decorate = (performance.now() - t) / (n * n);
t = performance.now();
for (let cz = 1; cz < n - 1; cz++) for (let cx = 1; cx < n - 1; cx++) light.lightChunk(world.getChunk(cx, cz)!);
T.light = (performance.now() - t) / ((n - 2) * (n - 2));
t = performance.now();
for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) serializeChunk(world.getChunk(cx, cz)!);
T.serialize = (performance.now() - t) / (n * n);
console.log(JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, v]) => [k + 'Ms', +v.toFixed(2)]))));
