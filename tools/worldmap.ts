/**
 * Top-down map of generated terrain (top block colours with hill shading) for checking world
 * generation at a glance. Usage: pnpm tsx --tsconfig server/tsconfig.json tools/worldmap.ts <seed> <blockX> <blockZ> <chunks> <out.png> [--decorate]
 * With --decorate the chunks also get their features (trees, plants, ores, lakes…).
 */
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { blockNameOf } from '@shared/world/blockstate';
import { BlockWorld } from '@shared/world/world';
import { IS_AIR } from '@shared/world/blockinfo';
import { MISSING_FEATURES } from '@shared/worldgen/features/engine';

const decorate = process.argv.includes('--decorate');
const [seedArg = '20211', xArg = '0', zArg = '0', nArg = '32', out = 'tools/bench/out/worldmap.png'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gen = new OverworldGenerator(BigInt(seedArg));
const n = Number(nArg), size = n * 16;
const cx0 = Math.floor(Number(xArg) / 16) - (n >> 1), cz0 = Math.floor(Number(zArg) / 16) - (n >> 1);
const heights = new Int16Array(size * size);
const colors = new Uint32Array(size * size);
const COLOR: Record<string, number> = {
  grass_block: 0x5f9f3a, dirt: 0x8b6a45, coarse_dirt: 0x76563a, podzol: 0x6a4c26, mycelium: 0x7f6d80, sand: 0xdccfa0, sandstone: 0xd4c48c,
  red_sand: 0xb8662c, gravel: 0x8a8580, stone: 0x7d7d7d, snow_block: 0xf6fafa, ice: 0x9ec2ff, packed_ice: 0x8db4f0, water: 0x3554c4,
  terracotta: 0x985e43, white_terracotta: 0xd1b2a1, orange_terracotta: 0xa1532a, yellow_terracotta: 0xb88426, brown_terracotta: 0x4d3323,
  red_terracotta: 0x8e3c2e, light_gray_terracotta: 0x876b62, bedrock: 0x333333,
  oak_leaves: 0x3f7a22, birch_leaves: 0x5a8a3a, spruce_leaves: 0x2f5a3a, jungle_leaves: 0x3a8a1a, acacia_leaves: 0x5a8a22, dark_oak_leaves: 0x2f6a1a,
  oak_log: 0x6b5232, birch_log: 0xd8d4c8, spruce_log: 0x3d2a17, jungle_log: 0x56461f, acacia_log: 0x676157, dark_oak_log: 0x3a2a14,
  grass: 0x6aa83f, tall_grass: 0x6aa83f, fern: 0x5a9a3a, large_fern: 0x5a9a3a, dandelion: 0xf0e030, poppy: 0xd02020, sugar_cane: 0x8ac060,
  pumpkin: 0xe08a20, lily_pad: 0x2f8a2f, cactus: 0x3a7a2a, dead_bush: 0x8a6a3a, seagrass: 0x2a6aa0, tall_seagrass: 0x2a6aa0, kelp: 0x3a7a4a, kelp_plant: 0x3a7a4a,
  granite: 0x9a6a55, diorite: 0xbcbcbc, andesite: 0x888888, coal_ore: 0x555555, copper_ore: 0x9a6a4a, sweet_berry_bush: 0x3a5a2a, snow: 0xf0f6f6, vine: 0x3a7a22, bee_nest: 0xd0a040, brown_mushroom: 0x9a7050, red_mushroom: 0xc03030, lava: 0xe06010, clay: 0x9aa0b0,
};
const unknown = new Map<string, number>();
const t0 = performance.now();
const world = new BlockWorld();
if (decorate) {
  for (let cz = -1; cz <= n; cz++) for (let cx = -1; cx <= n; cx++) world.addChunk(gen.generate(cx0 + cx, cz0 + cz));
  for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) gen.decorate(world, cx0 + cx, cz0 + cz);
}
for (let cz = 0; cz < n; cz++)
  for (let cx = 0; cx < n; cx++) {
    const c = decorate ? world.getChunk(cx0 + cx, cz0 + cz)! : gen.generate(cx0 + cx, cz0 + cz);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let y = 255;
        while (y > 0 && IS_AIR[c.getState(x, y, z)] === 1) y--;
        const name = blockNameOf(c.getState(x, y, z));
        let col = COLOR[name] ?? 0xff00ff;
        if (!(name in COLOR)) unknown.set(name, (unknown.get(name) ?? 0) + 1);
        if (name === 'water') {
          let d = y;
          while (d > 0 && blockNameOf(c.getState(x, d, z)) === 'water') d--;
          const k = Math.max(0.35, 1 - (y - d) / 40);
          col = ((((col >> 16) & 255) * k) << 16) | ((((col >> 8) & 255) * k) << 8) | ((col & 255) * k);
        }
        const i = (cz * 16 + z) * size + cx * 16 + x;
        heights[i] = y;
        colors[i] = col;
      }
  }
const png = new PNG({ width: size, height: size });
for (let i = 0; i < size * size; i++) {
  const west = i % size ? heights[i - 1]! : heights[i]!, north = i >= size ? heights[i - size]! : heights[i]!;
  const shade = Math.max(0.6, Math.min(1.3, 1 + (heights[i]! - (west + north) / 2) * 0.08));
  const c = colors[i]!;
  png.data[i * 4] = Math.min(255, ((c >> 16) & 255) * shade);
  png.data[i * 4 + 1] = Math.min(255, ((c >> 8) & 255) * shade);
  png.data[i * 4 + 2] = Math.min(255, (c & 255) * shade);
  png.data[i * 4 + 3] = 255;
}
writeFileSync(out, PNG.sync.write(png));
if (unknown.size) console.log('uncoloured:', [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
if (MISSING_FEATURES.size) console.log('not built yet:', [...MISSING_FEATURES].join(', '));
console.log(`${n * n} chunks in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${out}`);
