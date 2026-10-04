/**
 * Ocean monuments (vanilla 1.17.1 OceanMonumentFeature + OceanMonumentPieces.MonumentBuilding):
 * a 58 × 23 × 58 building at y 39 centred on the start chunk, in deep ocean biomes with ocean or
 * river all round (the 16/29-block biome checks), its volume flooded, pillars filled down to the
 * sea floor. Our design keeps vanilla's plan: the outer ring, two wings, the central hall with
 * the entrance arch, sponge rooms, the penthouse, and the core of 8 gold blocks in dark
 * prismarine. Guardians and elder guardians are entities and are not placed here.
 */
import { BoundingBox, Piece, S, type PlaceContext } from './piece';
import { positionRandom } from './template';
import type { StartContext } from './placement';
import { FLUID, IS_AIR } from '../../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION } from '../../world/blockprops';

class MonumentPiece extends Piece {
  postProcess(c: PlaceContext): boolean {
    const W = 57;
    const water = S('water'), pb = S('prismarine_bricks'), pr = S('prismarine'), dk = S('dark_prismarine'), lantern = S('sea_lantern');
    // flood the whole volume above the floor
    this.fill(c, 0, 1, 0, W, 22, W, water);
    // floor and pillars to the sea floor
    this.fill(c, 0, 0, 0, W, 0, W, pb);
    for (let x = 0; x <= W; x++)
      for (let z = 0; z <= W; z++) {
        const edge = x === 0 || z === 0 || x === W || z === W;
        if (edge || (x % 7 === 0 && z % 7 === 0)) this.fillDown(c, pb, x, -1, z);
      }
    // the outer ring wall
    for (let y = 1; y <= 3; y++)
      for (let i = 0; i <= W; i++)
        for (const [x, z] of [[i, 0], [i, W], [0, i], [W, i]] as const) this.set(c, y === 3 ? dk : pr, x, y, z);
    for (let i = 4; i < W; i += 8) {
      this.set(c, lantern, i, 3, 0);
      this.set(c, lantern, i, 3, W);
      this.set(c, lantern, 0, 3, i);
      this.set(c, lantern, W, 3, i);
    }
    // the two wings at the back (local z 22..57)
    for (const [x0, x1] of [[0, 21], [36, W]] as const) {
      this.fill(c, x0, 1, 22, x1, 12, W, pb, water);
      this.fill(c, x0 + 1, 12, 23, x1 - 1, 12, W - 1, pr);
      this.fill(c, x0 + 3, 4, 25, x1 - 3, 4, W - 3, pb);
      this.fill(c, x0 + 3, 8, 25, x1 - 3, 8, W - 3, pb);
      for (let z = 26; z < W - 2; z += 6) {
        this.set(c, lantern, (x0 + x1) >> 1, 12, z);
        this.fill(c, x0 + 4, 5, z, x0 + 4, 7, z, dk);
        this.fill(c, x1 - 4, 5, z, x1 - 4, 7, z, dk);
      }
      // a sponge room in each wing
      this.fill(c, x0 + 5, 9, 40, x1 - 5, 11, 46, pr, water);
      for (let x = x0 + 6; x <= x1 - 6; x += 2) for (let z = 41; z <= 45; z += 2) this.set(c, S('wet_sponge'), x, 11, z);
      this.set(c, lantern, (x0 + x1) >> 1, 9, 43);
    }
    // the central hall
    this.fill(c, 9, 1, 9, 48, 15, 48, pb, water);
    this.fill(c, 10, 15, 10, 47, 15, 47, pr);
    // the room grid inside the hall: 5 × 5 rooms on three floors, doorways and floor holes by position
    const walls = [9, 17, 25, 33, 41, 48];
    for (const y of [5, 10]) this.fill(c, 10, y, 10, 47, y, 47, pb);
    for (let fl = 0; fl < 3; fl++) {
      const y0 = fl * 5, y1 = Math.min(14, y0 + 4);
      for (const w of walls.slice(1, -1)) {
        this.fill(c, w, y0 + 1, 10, w, y1, 47, pr);
        this.fill(c, 10, y0 + 1, w, 47, y1, w, pr);
      }
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) {
          const rx = walls[i]!, rz = walls[j]!, mx = (rx + walls[i + 1]!) >> 1, mz = (rz + walls[j + 1]!) >> 1;
          const h = positionRandom(i * 7 + fl, j, 77).nextInt(16);
          // doorways east and south, a hole in the floor above, a lantern
          if (i < 4 && (h & 1)) this.fill(c, walls[i + 1]!, y0 + 1, mz - 1, walls[i + 1]!, y0 + 2, mz, water);
          if (j < 4 && (h & 2)) this.fill(c, mx - 1, y0 + 1, walls[j + 1]!, mx, y0 + 2, walls[j + 1]!, water);
          if (fl < 2 && (h & 12) === 0) this.fill(c, mx - 1, y0 + 5, mz - 1, mx, y0 + 5, mz, water);
          if ((h & 4) !== 0) this.set(c, lantern, mx, y0, mz);
        }
    }
    // the entrance corridor runs straight to the core
    this.fill(c, 26, 1, 9, 31, 4, 25, water);
    // stripes of dark prismarine on the hall walls
    for (let i = 9; i <= 48; i++)
      for (const [x, z] of [[i, 9], [i, 48], [9, i], [48, i]] as const) {
        this.set(c, dk, x, 5, z);
        this.set(c, dk, x, 10, z);
      }
    // entrance arch at the front
    this.fill(c, 24, 1, 0, 33, 8, 9, water);
    this.fill(c, 23, 1, 1, 23, 9, 8, pb);
    this.fill(c, 34, 1, 1, 34, 9, 8, pb);
    this.fill(c, 23, 9, 1, 34, 9, 8, pb);
    this.fill(c, 24, 9, 1, 33, 9, 8, dk);
    this.set(c, lantern, 28, 9, 1);
    this.set(c, lantern, 29, 9, 1);
    // penthouse and dome
    this.fill(c, 21, 15, 21, 36, 20, 36, pb, water);
    this.fill(c, 23, 21, 23, 34, 21, 34, pr);
    this.fill(c, 26, 22, 26, 31, 22, 31, dk);
    for (const [x, z] of [[22, 22], [35, 22], [22, 35], [35, 35]] as const) this.set(c, lantern, x, 20, z);
    this.fill(c, 27, 22, 27, 30, 22, 30, lantern);
    // the core: 8 gold blocks inside a dark prismarine chamber
    this.fill(c, 25, 7, 25, 32, 14, 32, dk, water);
    this.fill(c, 28, 10, 28, 29, 11, 29, S('gold_block'));
    this.fill(c, 28, 7, 25, 29, 9, 25, water);
    // the front inner gate into the hall
    this.fill(c, 26, 1, 9, 31, 6, 9, water);
    void IS_AIR;
    void FLUID;
    void MATERIAL_BLOCKS_MOTION;
    return true;
  }
}

export function oceanMonument(s: StartContext): Piece[] {
  const r = s.rand;
  const rot = r.nextInt(4);
  const x = (s.cx << 4) - 29, z = (s.cz << 4) - 29;
  return [new MonumentPiece(new BoundingBox(x, 39, z, x + 57, 39 + 22, z + 57), rot)];
}
