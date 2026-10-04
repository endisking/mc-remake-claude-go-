/**
 * Isometric view of generated (decorated) terrain around a point, for checking structures without
 * the browser. Block colours are the average of our generated textures.
 * Usage: pnpm tsx --tsconfig server/tsconfig.json tools/structview.ts <seed> <x> <z> <radius> <out.png> [yMin] [yMax] [--cut]
 * --cut slices the near half away (x > centre) to show the inside.
 */
import { PNG } from 'pngjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { blockNameOf } from '@shared/world/blockstate';
import { BlockWorld } from '@shared/world/world';
import { IS_AIR } from '@shared/world/blockinfo';

const cut = process.argv.includes('--cut');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [seedArg = '20211', xArg = '0', zArg = '0', rArg = '16', out = 'tools/bench/out/structview.png', yMinArg = '0', yMaxArg = '140'] = args;
const gen = new OverworldGenerator(BigInt(seedArg));
const X = Number(xArg), Z = Number(zArg), R = Number(rArg), Y0 = Number(yMinArg), Y1 = Number(yMaxArg);
const world = new BlockWorld();
const c0x = (X - R) >> 4, c1x = (X + R) >> 4, c0z = (Z - R) >> 4, c1z = (Z + R) >> 4;
for (let cx = c0x - 1; cx <= c1x + 1; cx++) for (let cz = c0z - 1; cz <= c1z + 1; cz++) world.addChunk(gen.generate(cx, cz));
for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) gen.decorate(world, cx, cz);

const FALLBACK: Record<string, number> = {
  sandstone: 0xd8c98f, cut_sandstone: 0xe2d49c, chiseled_sandstone: 0xc4b276, smooth_sandstone: 0xdccd94, orange_terracotta: 0xa1532a, blue_terracotta: 0x4a3b5b,
  terracotta: 0x985e43, tnt: 0xc03020, stone_bricks: 0x7a7a7a, mossy_stone_bricks: 0x667a58, cracked_stone_bricks: 0x666666, chiseled_stone_bricks: 0x8a8a8a,
  chest: 0xa8742c, trapped_chest: 0xa8642c, barrel: 0x8a6232, snow_block: 0xf6fafa, white_carpet: 0xeeeeee, red_carpet: 0xa02020, iron_bars: 0x9a9a9a, cobweb: 0xe8e8e8,
  bookshelf: 0x8a6a3a, end_portal_frame: 0x3a6a5a, obsidian: 0x1a1028, crying_obsidian: 0x3a1a6a, netherrack: 0x7a2a2a, gold_block: 0xe8c030,
  prismarine_bricks: 0x5aa090, dark_prismarine: 0x2a5a4a, sponge: 0xc8c040, oak_fence: 0x9a7a4a, dispenser: 0x6a6a6a, sticky_piston: 0x8a9a5a,
  redstone_wire: 0xb01010, tripwire: 0xdddddd, tripwire_hook: 0x8a7a5a, cauldron: 0x3a3a3a, brewing_stand: 0x6a5a3a, crafting_table: 0x9a6a3a,
  furnace: 0x6a6a6a, polished_andesite: 0x8a8c8c, andesite: 0x888888, stone_pressure_plate: 0x8a8a8a, potted_red_mushroom: 0x903020,
  dark_oak_planks: 0x4a3218, birch_planks: 0xc8b47a, cobblestone_stairs: 0x7a7a7a, mossy_cobblestone_stairs: 0x6a7a5a, stone_brick_stairs: 0x7a7a7a,
};
const colors = new Map<string, [number, number, number, number]>();
function color(name: string): [number, number, number, number] {
  let c = colors.get(name);
  if (c) return c;
  const base = name.replace(/_(stairs|slab|wall|fence|fence_gate|pressure_plate|button|trapdoor|door|wall_sign|sign|carpet)$/, '');
  const tries = [name, `${name}_side`, `${name}_top`, base, `${base}_planks`, base.replace(/s$/, ''), `${base}_block`, base.replace('wall_', ''), base.replace(/^(potted|wall)_/, '')];
  if (name.endsWith('_carpet')) tries.unshift(name.replace('_carpet', '_wool'));
  if (base.startsWith('cut_') || base.startsWith('chiseled_')) tries.push(base, `${base}`);
  const known = FALLBACK[name] ?? FALLBACK[base];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  c = known !== undefined ? [(known >> 16) & 255, (known >> 8) & 255, known & 255, 255] : [80 + (h & 127), 80 + ((h >> 7) & 127), 80 + ((h >> 14) & 127), 255];
  if (known === undefined) for (const t of tries) {
    const f = `client/public/textures/block/${t}.png`;
    if (!existsSync(f)) continue;
    const png = PNG.sync.read(readFileSync(f));
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < 16 * 16 * 4; i += 4) if (png.data[i + 3]! > 10) { r += png.data[i]!; g += png.data[i + 1]!; b += png.data[i + 2]!; n++; }
    if (n) c = [r / n, g / n, b / n, 255];
    if (/leaves|grass_block|^grass$|fern|vine|lily/.test(name)) c = [c[0] * 0.45, c[1] * 0.75, c[2] * 0.35, 255];
    if (name === 'water') c = [50, 80, 200, 110];
    break;
  }
  colors.set(name, c);
  return c;
}

const S = 6; // pixels per block edge
const span = 2 * R + 1, H = Y1 - Y0 + 1;
const W = span * 2 * S + 4, HH = span * S + H * S * 2 + 8;
const png = new PNG({ width: W, height: HH });
for (let i = 0; i < W * HH; i++) png.data.set([235, 240, 250, 255], i * 4);
const plot = (px: number, py: number, c: number[], k: number) => {
  px = Math.floor(px); py = Math.floor(py);
  if (px < 0 || py < 0 || px >= W || py >= HH) return;
  const i = (py * W + px) * 4, a = c[3]! / 255;
  for (let j = 0; j < 3; j++) png.data[i + j] = png.data[i + j]! * (1 - a) + Math.min(255, c[j]! * k) * a;
};
// painter's order: far to near (low x+z first), bottom to top
for (let s = 0; s <= 2 * (span - 1); s++)
  for (let y = Y0; y <= Y1; y++)
    for (let i = 0; i < span; i++) {
      const j = s - i;
      if (j < 0 || j >= span) continue;
      const x = X - R + i, z = Z - R + j;
      if (cut && x > X) continue;
      const st = world.getState(x, y, z);
      if (IS_AIR[st] === 1) continue;
      const name = blockNameOf(st);
      if (name === 'water' && IS_AIR[world.getState(x, y + 1, z)] !== 1) continue;
      const c = color(name);
      // iso: screen x = (i - j) * S + centre, screen y = (i + j) * S/2 - y * S
      const sx = (i - j) * S + span * S, sy = ((i + j) * S) / 2 + (Y1 - y) * S + 4;
      for (let dy = 0; dy < S; dy++) for (let dx = -S; dx < S; dx++) plot(sx + dx, sy + dy - S / 2 + Math.abs(dx) / 2, c, 1.1); // top
      for (let dy = 0; dy < S; dy++) for (let dx = -S; dx < 0; dx++) plot(sx + dx, sy + dy + S / 2 + (dx + S) / 2, c, 0.75); // left
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) plot(sx + dx, sy + dy + S / 2 + (S - dx) / 2, c, 0.9); // right
    }
writeFileSync(out, PNG.sync.write(png));
console.log(`→ ${out}`);
