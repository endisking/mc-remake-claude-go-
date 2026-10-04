/**
 * Pillager outposts (vanilla 1.17.1 PillagerOutpostFeature: jigsaw of size 7 from the base plate,
 * in desert, plains, savanna, snowy tundra and taiga; never within 10 chunks of a village
 * candidate). Our design: the dark oak watchtower with the pillager_outpost chest on the top
 * floor, and feature pieces scattered around it (the cage, tents, log piles, targets). Pillager
 * and iron golem spawns are entities and not placed here.
 */
import type { JavaRandom } from '../../util/random';
import { BoundingBox, S, type Piece } from './piece';
import { Model, TemplatePiece, VOID } from './template';
import type { StartContext } from './placement';
import { FLUID, IS_AIR } from '../../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION } from '../../world/blockprops';
import type { PlaceContext } from './piece';

function tower(): Model {
  const W = 11, H = 23;
  const m = new Model(W, H, W);
  const planks = S('dark_oak_planks'), log = S('dark_oak_log[axis=y]'), cob = S('cobblestone'), air = S('air');
  const birch = S('birch_planks');
  // base and the tower shaft (7×7, from local 2..8)
  m.fill(1, 0, 1, 9, 0, 9, cob);
  for (let y = 1; y <= 16; y++)
    for (let x = 2; x <= 8; x++)
      for (let z = 2; z <= 8; z++) {
        const edge = x === 2 || x === 8 || z === 2 || z === 8;
        const corner = (x === 2 || x === 8) && (z === 2 || z === 8);
        m.set(x, y, z, corner ? log : edge ? (y % 5 === 0 ? birch : planks) : air);
      }
  // floors every 5 blocks with a ladder hole
  for (const y of [5, 10, 15]) {
    m.fill(3, y, 3, 7, y, 7, planks);
    m.set(4, y, 4, air);
  }
  for (let y = 1; y <= 16; y++) m.set(4, y, 3, S('ladder[facing=south]'));
  // door, windows
  m.set(5, 1, 2, S('dark_oak_door[half=lower,facing=north]'));
  m.set(5, 2, 2, S('dark_oak_door[half=upper,facing=north]'));
  for (const y of [7, 12]) {
    m.set(5, y, 2, S('dark_oak_fence'));
    m.set(5, y, 8, S('dark_oak_fence'));
    m.set(2, y, 5, S('dark_oak_fence'));
    m.set(8, y, 5, S('dark_oak_fence'));
  }
  // the lookout: an 11×11 platform with railings and a pyramid roof
  m.fill(0, 16, 0, 10, 16, 10, planks);
  m.fill(3, 16, 3, 7, 16, 7, planks);
  m.set(4, 16, 4, air);
  for (let i = 0; i <= 10; i++) {
    m.set(i, 17, 0, S('dark_oak_fence'));
    m.set(i, 17, 10, S('dark_oak_fence'));
    m.set(0, 17, i, S('dark_oak_fence'));
    m.set(10, 17, i, S('dark_oak_fence'));
  }
  for (const [x, z] of [[0, 0], [10, 0], [0, 10], [10, 10]] as const) m.fill(x, 17, z, x, 19, z, log);
  for (let i = 0; i <= 3; i++) {
    const y = 20 + i;
    for (let x = i; x <= 10 - i; x++) {
      m.set(x, y, i, S('dark_oak_stairs[facing=south]'));
      m.set(x, y, 10 - i, S('dark_oak_stairs[facing=north]'));
    }
    for (let z = i + 1; z < 10 - i; z++) {
      m.set(i, y, z, S('dark_oak_stairs[facing=east]'));
      m.set(10 - i, y, z, S('dark_oak_stairs[facing=west]'));
    }
  }
  m.fill(4, 22, 4, 6, 22, 6, S('dark_oak_slab[type=bottom]'));
  m.chest(7, 17, 7, 'chests/pillager_outpost', S('chest[facing=west]'));
  m.set(3, 17, 7, S('white_carpet'));
  m.set(5, 17, 1, S('wall_torch[facing=south]'));
  m.set(5, 18, 5, S('white_banner[rotation=0]'));
  // the ground floor: crafting table and a little clutter
  m.set(7, 1, 7, S('crafting_table'));
  m.set(3, 1, 7, S('dark_oak_log[axis=x]'));
  return m;
}

function cage(): Model {
  const m = new Model(5, 5, 5);
  const fence = S('dark_oak_fence'), log = S('dark_oak_log[axis=y]');
  m.fill(0, 0, 0, 4, 0, 4, S('dark_oak_planks'));
  for (let y = 1; y <= 3; y++)
    for (let i = 0; i < 5; i++) {
      m.set(i, y, 0, fence);
      m.set(i, y, 4, fence);
      m.set(0, y, i, fence);
      m.set(4, y, i, fence);
    }
  for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) m.fill(x, 1, z, x, 3, z, log);
  m.fill(0, 4, 0, 4, 4, 4, S('dark_oak_slab[type=bottom]'));
  m.fill(1, 1, 1, 3, 3, 3, S('air'));
  return m;
}

function tent(): Model {
  const m = new Model(5, 4, 6);
  const wool = S('white_wool'), fence = S('dark_oak_fence');
  for (let z = 0; z < 6; z++) {
    m.set(0, 1, z, wool);
    m.set(4, 1, z, wool);
    m.set(1, 2, z, wool);
    m.set(3, 2, z, wool);
    m.set(2, 3, z, wool);
    m.fill(1, 1, z, 3, 1, z, S('air'));
    m.set(2, 2, z, S('air'));
  }
  m.set(2, 1, 0, fence);
  m.set(2, 2, 0, fence);
  m.set(1, 1, 4, S('crafting_table'));
  return m;
}

function logs(): Model {
  const m = new Model(3, 3, 5);
  m.fill(0, 1, 0, 2, 1, 4, S('dark_oak_log[axis=z]'));
  m.fill(0, 2, 1, 1, 2, 3, S('dark_oak_log[axis=z]'));
  m.set(2, 2, 1, VOID);
  return m;
}

function targets(): Model {
  const m = new Model(5, 3, 1);
  for (const x of [0, 2, 4]) {
    m.set(x, 1, 0, S('dark_oak_fence'));
    m.set(x, 2, 0, S('carved_pumpkin[facing=south]'));
  }
  m.set(1, 1, 0, S('hay_block'));
  return m;
}

/** Rigid piece on the ground at its centre (foundation filled below the floor). */
class GroundPiece extends TemplatePiece {
  override postProcess(c: PlaceContext): boolean {
    return super.postProcess(c);
  }
}

function onGround(m: Model, x: number, z: number, rot: number, base: number): GroundPiece {
  return new GroundPiece(m, x, 64, z, rot, (c, p) => {
    const cx = p.box.centerX, cz = p.box.centerZ;
    if (!c.lv.world.isLoaded(cx, cz)) return 64;
    const y = c.lv.getHeight('WORLD_SURFACE_WG', cx, cz) - 1;
    // foundation: fill under the floor down to the ground
    for (let X = p.box.x0; X <= p.box.x1; X++)
      for (let Z = p.box.z0; Z <= p.box.z1; Z++) {
        if (!c.chunk.inside(X, y, Z)) continue;
        for (let Y = y - 1; Y > y - 12; Y--) {
          const s = c.lv.getState(X, Y, Z);
          if (IS_AIR[s] !== 1 && FLUID[s] === 0 && MATERIAL_BLOCKS_MOTION[s] === 1) break;
          c.lv.setState(X, Y, Z, base);
        }
      }
    return y;
  });
}

export function pillagerOutpost(s: StartContext): Piece[] {
  const r: JavaRandom = s.rand;
  const x = s.cx << 4, z = s.cz << 4;
  const t = tower();
  const pieces: TemplatePiece[] = [onGround(t, x, z, r.nextInt(4), S('cobblestone'))];
  const taken: BoundingBox[] = [pieces[0]!.box];
  const feats = [cage, tent, logs, targets, tent, logs];
  const n = 2 + r.nextInt(4);
  for (let i = 0; i < n; i++) {
    const make = feats[r.nextInt(feats.length)]!;
    const ang = r.nextDouble() * Math.PI * 2, dist = 12 + r.nextInt(10);
    const px = x + 5 + Math.round(Math.cos(ang) * dist), pz = z + 5 + Math.round(Math.sin(ang) * dist);
    const p = onGround(make(), px, pz, r.nextInt(4), S('dirt'));
    if (taken.some((b) => b.intersectsXZ(p.box.x0 - 2, p.box.z0 - 2, p.box.x1 + 2, p.box.z1 + 2))) continue;
    taken.push(p.box);
    pieces.push(p);
  }
  return pieces;
}
