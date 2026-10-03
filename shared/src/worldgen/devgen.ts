/**
 * Development terrain used while the engine (Phase 1) and player (Phase 2) are built.
 * It exercises every render path (opaque, cutout, translucent, tints, lighting) but is
 * NOT the 1.17.1 generator — that is Phase 3 (shared/src/worldgen/overworld).
 */
import { Chunk } from '../world/chunk';
import { stateOf } from '../world/blockstate';
import { BIOMES_BY_NAME } from '../data';
import { JavaRandom } from '../util/random';
import { PerlinNoise } from '../util/noise';

const S = {
  bedrock: stateOf('bedrock'),
  stone: stateOf('stone'),
  dirt: stateOf('dirt'),
  grass: stateOf('grass_block', { snowy: false }),
  sand: stateOf('sand'),
  gravel: stateOf('gravel'),
  water: stateOf('water'),
  log: stateOf('oak_log', { axis: 'y' }),
  leaves: stateOf('oak_leaves', { distance: 1, persistent: false }),
  grassPlant: stateOf('grass'),
  poppy: stateOf('poppy'),
  dandelion: stateOf('dandelion'),
  coal: stateOf('coal_ore'),
  iron: stateOf('iron_ore'),
  glass: stateOf('glass'),
  torch: stateOf('torch'),
};

export class DevGenerator {
  private readonly height: PerlinNoise;
  private readonly detail: PerlinNoise;
  private readonly seed: bigint;

  constructor(seed: bigint) {
    this.seed = seed;
    const r = new JavaRandom(seed);
    this.height = PerlinNoise.simple(r, 6);
    this.detail = PerlinNoise.simple(r, 4);
  }

  private heightAt(x: number, z: number): number {
    const h = this.height.noise(x / 4, 0, z / 4, 0, 0, true);
    const d = this.detail.noise(x / 1.5, 0, z / 1.5, 0, 0, true);
    return Math.floor(66 + h * 24 + d * 4);
  }

  generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    const plains = BIOMES_BY_NAME.get('plains')!.id;
    c.biomes.fill(plains);
    const bx = cx << 4, bz = cz << 4;
    const rand = new JavaRandom(BigInt.asIntN(64, this.seed ^ (BigInt(cx) * 341873128712n + BigInt(cz) * 132897987541n)));
    const heights = new Int16Array(256);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const h = this.heightAt(bx + x, bz + z);
        heights[z * 16 + x] = h;
        for (let y = 0; y <= Math.max(h, 62); y++) {
          let s: number;
          if (y <= rand.nextInt(5)) s = S.bedrock;
          else if (y > h) s = S.water;
          else if (y === h) s = h < 64 ? (h < 60 ? S.gravel : S.sand) : S.grass;
          else if (y > h - 4) s = h < 64 ? S.sand : S.dirt;
          else {
            const r = rand.nextInt(200);
            s = r === 0 ? S.coal : r === 1 && y < 64 ? S.iron : S.stone;
          }
          c.setState(x, y, z, s);
        }
      }
    // decoration: plants and trees, only fully inside the chunk to stay deterministic per chunk
    for (let z = 2; z < 14; z++)
      for (let x = 2; x < 14; x++) {
        const h = heights[z * 16 + x]!;
        if (h < 64) continue;
        const r = rand.nextInt(100);
        if (r < 1 && h < 240) {
          const th = 4 + rand.nextInt(3);
          for (let y = 1; y <= th; y++) c.setState(x, h + y, z, S.log);
          for (let dy = th - 2; dy <= th + 1; dy++) {
            const rad = dy >= th ? 1 : 2;
            for (let dx = -rad; dx <= rad; dx++)
              for (let dz = -rad; dz <= rad; dz++) {
                if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === th + 1 || rand.nextInt(2) === 0)) continue;
                if (c.getState(x + dx, h + dy, z + dz) === 0) c.setState(x + dx, h + dy, z + dz, S.leaves);
              }
          }
        } else if (r < 12) c.setState(x, h + 1, z, S.grassPlant);
        else if (r < 13) c.setState(x, h + 1, z, rand.nextBoolean() ? S.poppy : S.dandelion);
      }
    // a glass-and-torch marker at the origin chunk for lighting tests
    if (cx === 0 && cz === 0) {
      const h = heights[8 * 16 + 8]!;
      c.setState(8, h + 1, 8, S.torch);
      for (let y = h + 1; y <= h + 3; y++) c.setState(10, y, 8, S.glass);
    }
    for (const s of c.sections) s.recount();
    return c;
  }
}
