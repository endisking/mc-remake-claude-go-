/**
 * Counts what decoration placed in an area: pnpm tsx --tsconfig server/tsconfig.json tools/feature-count.ts <seed> <chunkX> <chunkZ> <chunks> [block…]
 */
import { OverworldGenerator } from '../shared/src/worldgen/overworld/generator';
import { BlockWorld } from '../shared/src/world/world';
import { blockNameOf } from '../shared/src/world/blockstate';
import { MISSING_FEATURES } from '../shared/src/worldgen/features/engine';
import { takeGenBlockEntities } from '../shared/src/worldgen/features/underground';

const args = process.argv.slice(2);
const [seed = '20211', cxa = '0', cza = '0', na = '16'] = args;
const names = args.slice(4).length ? args.slice(4) : ['budding_amethyst', 'amethyst_cluster', 'calcite', 'smooth_basalt', 'spawner', 'mossy_cobblestone', 'chest', 'glow_lichen', 'pointed_dripstone', 'dripstone_block', 'emerald_ore', 'bone_block', 'seagrass'];
const gen = new OverworldGenerator(BigInt(seed));
const world = new BlockWorld();
const cx0 = Number(cxa), cz0 = Number(cza), n = Number(na);
for (let cz = -1; cz <= n; cz++) for (let cx = -1; cx <= n; cx++) world.addChunk(gen.generate(cx0 + cx, cz0 + cz));
const t0 = performance.now();
for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) gen.decorate(world, cx0 + cx, cz0 + cz);
const t1 = performance.now();
const counts = new Map<string, number>();
for (let x = cx0 * 16 - 16; x < (cx0 + n + 1) * 16; x++)
  for (let z = cz0 * 16 - 16; z < (cz0 + n + 1) * 16; z++)
    for (let y = 0; y < 256; y++) {
      const nm = blockNameOf(world.getState(x, y, z));
      counts.set(nm, (counts.get(nm) ?? 0) + 1);
    }
console.log(`decorated ${n * n} chunks in ${((t1 - t0) / 1000).toFixed(1)} s`);
// geodes: connected groups of calcite (each geode has one calcite shell)
const seen = new Set<string>();
let geodes = 0;
for (let x = cx0 * 16 - 16; x < (cx0 + n + 1) * 16; x++)
  for (let z = cz0 * 16 - 16; z < (cz0 + n + 1) * 16; z++)
    for (let y = 0; y < 128; y++) {
      if (seen.has(`${x},${y},${z}`) || blockNameOf(world.getState(x, y, z)) !== 'calcite') continue;
      geodes++;
      const stack = [[x, y, z]];
      seen.add(`${x},${y},${z}`);
      while (stack.length) {
        const [a, b, c] = stack.pop()!;
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
          const k = `${a! + dx},${b! + dy},${c! + dz}`;
          if (seen.has(k) || blockNameOf(world.getState(a! + dx, b! + dy, c! + dz)) !== 'calcite') continue;
          seen.add(k);
          stack.push([a! + dx, b! + dy, c! + dz]);
        }
      }
    }
console.log(`geodes: ${geodes}`);
for (const nm of names) console.log(`${nm}: ${counts.get(nm) ?? 0}`);
const bes = takeGenBlockEntities(world);
console.log(`block entities: ${bes.length}`, bes.slice(0, 12).map((b) => JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).join('\n'));
if (MISSING_FEATURES.size) console.log('not built yet:', [...MISSING_FEATURES].join(', '));
