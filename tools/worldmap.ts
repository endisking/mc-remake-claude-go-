/**
 * Top-down map of generated terrain (top block colours with hill shading) for checking world
 * generation at a glance. Usage: pnpm tsx --tsconfig server/tsconfig.json tools/worldmap.ts <seed> <blockX> <blockZ> <chunks> <out.png>
 */
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { blockNameOf } from '@shared/world/blockstate';

const [seedArg = '20211', xArg = '0', zArg = '0', nArg = '32', out = 'tools/bench/out/worldmap.png'] = process.argv.slice(2);
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
};
const t0 = performance.now();
for (let cz = 0; cz < n; cz++)
  for (let cx = 0; cx < n; cx++) {
    const c = gen.generate(cx0 + cx, cz0 + cz);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let y = 255;
        while (y > 0 && c.getState(x, y, z) === 0) y--;
        const name = blockNameOf(c.getState(x, y, z));
        let col = COLOR[name] ?? 0xff00ff;
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
console.log(`${n * n} chunks in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${out}`);
