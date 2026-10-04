/**
 * Lists the nearest overworld structure starts for a seed (like /locate for every type).
 * Usage: pnpm tsx --tsconfig server/tsconfig.json tools/structures.ts <seed> [x] [z] [types,…] [--check]
 * --check also generates and decorates the chunks under each start and prints its box, piece
 * count, the blocks found in the box (minus natural terrain) and the generated chests.
 */
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { LOCATABLE_STRUCTURES, locateStructure, structureStart } from '@shared/worldgen/structures/placement';
import { BlockWorld } from '@shared/world/world';
import { blockNameOf } from '@shared/world/blockstate';
import { takeGenBlockEntities } from '@shared/worldgen/features/underground';
import { takeGenEntities } from '@shared/worldgen/structures/entities';

const check = process.argv.includes('--check');
const [seedArg = '20211', xArg = '0', zArg = '0', typesArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gen = new OverworldGenerator(BigInt(seedArg));
const NATURAL = /^(air|cave_air|stone|dirt|grass_block|water|sand|gravel|granite|diorite|andesite|deepslate|tuff|bedrock|.*_ore|grass|tall_grass|.*_leaves|.*_log|snow|seagrass|tall_seagrass|kelp|kelp_plant|lava|clay|coarse_dirt|podzol|fern|large_fern|vine|lily_pad|sugar_cane|cactus|dead_bush|.*_mushroom|glow_lichen|copper_ore|red_sand|terracotta|.*_terracotta|ice|packed_ice|blue_ice|snow_block|calcite|amethyst_block|budding_amethyst|smooth_basalt|.*amethyst_bud|amethyst_cluster|dandelion|poppy|bamboo|.*_coral.*|sea_pickle|magma_block|.*tulip|azure_bluet|oxeye_daisy|cornflower|blue_orchid|allium|lily_of_the_valley|sweet_berry_bush|pointed_dripstone|dripstone_block|moss_block|moss_carpet|cocoa|melon|pumpkin|bee_nest|sunflower|rose_bush|peony|lilac)$/;
for (const t of typesArg && typesArg !== 'all' ? typesArg.split(',') : LOCATABLE_STRUCTURES) {
  const t0 = performance.now();
  const p = locateStructure(gen, t, Number(xArg), Number(zArg));
  console.log(`${t.padEnd(18)} ${p ? `${p.x} ${p.z}` : 'none'}  (${(performance.now() - t0).toFixed(0)} ms)`);
  if (!check || !p) continue;
  const s = structureStart(gen, t, p.x >> 4, p.z >> 4)!;
  let b = s.xzBox;
  const world = new BlockWorld();
  const c0x = b.x0 >> 4, c1x = b.x1 >> 4, c0z = b.z0 >> 4, c1z = b.z1 >> 4;
  for (let cx = c0x - 1; cx <= c1x + 1; cx++) for (let cz = c0z - 1; cz <= c1z + 1; cz++) world.addChunk(gen.generate(cx, cz));
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) gen.decorate(world, cx, cz);
  b = s.box;
  const hist = new Map<string, number>();
  for (let y = Math.max(0, b.y0); y <= Math.min(255, b.y1); y++)
    for (let x = b.x0; x <= b.x1; x++)
      for (let z = b.z0; z <= b.z1; z++) {
        const n = blockNameOf(world.getState(x, y, z));
        if (!NATURAL.test(n)) hist.set(n, (hist.get(n) ?? 0) + 1);
      }
  console.log(`  box ${b.x0} ${b.y0} ${b.z0} → ${b.x1} ${b.y1} ${b.z1}, ${s.pieces.length} pieces`);
  console.log('  blocks:', [...hist].sort((a, c) => c[1] - a[1]).slice(0, 24).map(([k, v]) => `${k} ${v}`).join(', '));
  const mobs = new Map<string, number>();
  for (const e of takeGenEntities(world)) mobs.set(e.type, (mobs.get(e.type) ?? 0) + 1);
  if (mobs.size) console.log('  mobs:', [...mobs].map(([k, v]) => `${k} ${v}`).join(', '));
  for (const be of takeGenBlockEntities(world)) console.log(`  ${be.kind} ${be.x} ${be.y} ${be.z} ${'lootTable' in be ? be.lootTable : be.entity}`);
}
