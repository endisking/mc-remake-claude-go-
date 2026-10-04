/**
 * Lists the nearest overworld structure starts for a seed (like /locate for every type).
 * Usage: pnpm tsx --tsconfig server/tsconfig.json tools/structures.ts <seed> [x] [z] [types,…]
 */
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { LOCATABLE_STRUCTURES, locateStructure } from '@shared/worldgen/structures/placement';

const [seedArg = '20211', xArg = '0', zArg = '0', typesArg] = process.argv.slice(2);
const gen = new OverworldGenerator(BigInt(seedArg));
for (const t of typesArg ? typesArg.split(',') : LOCATABLE_STRUCTURES) {
  const t0 = performance.now();
  const p = locateStructure(gen, t, Number(xArg), Number(zArg));
  console.log(`${t.padEnd(18)} ${p ? `${p.x} ${p.z}` : 'none'}  (${(performance.now() - t0).toFixed(0)} ms)`);
}
