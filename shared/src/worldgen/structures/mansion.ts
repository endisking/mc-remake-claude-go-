/**
 * Woodland mansions (vanilla 1.17.1 WoodlandMansionFeature: dark forest only, 80/20 triangular
 * spacing, the whole 32-block biome check, and the corner-height rule — no mansion where the
 * lowest of the four corner heights is below 60; built one block above it). Our design follows
 * the mansion's plan at a smaller scale: a cobblestone foundation, three floors of dark oak with
 * birch partitions, a grid of rooms (bedrooms, library, dining hall, storerooms with the
 * woodland_mansion chests, a map room), staircases and a hipped dark oak roof. Vindicators and
 * evokers are entities and are not placed here.
 */
import type { JavaRandom } from '../../util/random';
import { S, type Piece, type PlaceContext } from './piece';
import { Model, TemplatePiece } from './template';
import type { StartContext } from './placement';
import { FLUID, IS_AIR } from '../../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION } from '../../world/blockprops';

const W = 39, D = 27, FLOOR_H = 6, FLOORS = 3;

function build(r: JavaRandom): Model {
  const roofH = 8;
  const m = new Model(W, FLOORS * FLOOR_H + roofH + 1, D);
  const cob = S('cobblestone'), dk = S('dark_oak_planks'), log = S('dark_oak_log[axis=y]'), birch = S('birch_planks'), air = S('air');
  const glass = S('glass_pane'), carpet = S('red_carpet');
  m.fill(0, 0, 0, W - 1, 0, D - 1, cob);
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * FLOOR_H;
    // floor, outer walls with log pillars every 6 blocks, windows
    m.fill(0, y0, 0, W - 1, y0, D - 1, f === 0 ? cob : dk);
    for (let y = y0 + 1; y < y0 + FLOOR_H; y++)
      for (let z = 0; z < D; z++)
        for (let x = 0; x < W; x++) {
          const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1;
          if (!edge) {
            m.set(x, y, z, air);
            continue;
          }
          const pillar = (x % 6 === 0 && (z === 0 || z === D - 1)) || (z % 6 === 0 && (x === 0 || x === W - 1)) || ((x === 0 || x === W - 1) && (z === 0 || z === D - 1));
          const window = !pillar && (y === y0 + 2 || y === y0 + 3) && ((x % 6 === 3 && (z === 0 || z === D - 1)) || (z % 6 === 3 && (x === 0 || x === W - 1)));
          m.set(x, y, z, pillar ? log : window ? glass : f === 0 ? cob : dk);
        }
    // corridors: one along the length, rooms either side, birch partitions
    const cz0 = (D >> 1) - 1, cz1 = (D >> 1) + 1;
    for (let x = 1; x < W - 1; x++) {
      for (let y = y0 + 1; y < y0 + FLOOR_H; y++) {
        m.set(x, y, cz0 - 1, birch);
        m.set(x, y, cz1 + 1, birch);
      }
      for (let z = cz0; z <= cz1; z++) m.set(x, y0 + 1, z, carpet);
    }
    for (let x = 8; x < W - 1; x += 8)
      for (let y = y0 + 1; y < y0 + FLOOR_H; y++)
        for (let z = 1; z < D - 1; z++) if (z < cz0 - 1 || z > cz1 + 1) m.set(x, y, z, birch);
    // doorways into each room
    for (let x = 4; x < W - 1; x += 8) {
      m.set(x, y0 + 1, cz0 - 1, air);
      m.set(x, y0 + 2, cz0 - 1, air);
      m.set(x, y0 + 1, cz1 + 1, air);
      m.set(x, y0 + 2, cz1 + 1, air);
    }
    // ceiling lights
    for (let x = 4; x < W - 1; x += 8) for (const z of [4, D >> 1, D - 5]) m.set(x, y0 + FLOOR_H - 1, z, S('lantern[hanging=true]'));
    // the rooms: 4 per side per floor
    let room = 0;
    for (let x = 1; x + 6 < W - 1; x += 8)
      for (const [z0, z1] of [[1, cz0 - 2], [cz1 + 2, D - 2]] as const) {
        const kind = (room + f * 3 + r.nextInt(3)) % 6;
        room++;
        const zm = (z0 + z1) >> 1;
        switch (kind) {
          case 0: // bedroom
            m.set(x + 1, y0 + 1, z0 === 1 ? z0 : z1, S(`white_bed[part=head,facing=${z0 === 1 ? 'north' : 'south'}]`));
            m.set(x + 1, y0 + 1, z0 === 1 ? z0 + 1 : z1 - 1, S(`white_bed[part=foot,facing=${z0 === 1 ? 'north' : 'south'}]`));
            m.set(x + 5, y0 + 1, zm, S('crafting_table'));
            break;
          case 1: // library
            for (let z = z0; z <= z1; z++) {
              m.fill(x, y0 + 1, z, x, y0 + 3, z, S('bookshelf'));
              m.fill(x + 6, y0 + 1, z, x + 6, y0 + 3, z, S('bookshelf'));
            }
            m.set(x + 3, y0 + 1, zm, S('lectern[facing=north]'));
            break;
          case 2: // storeroom with the loot chests
            m.chest(x + 1, y0 + 1, z0, 'chests/woodland_mansion', S('chest[facing=south]'));
            if (r.nextBoolean()) m.chest(x + 5, y0 + 1, z1, 'chests/woodland_mansion', S('chest[facing=north]'));
            m.set(x + 3, y0 + 1, zm, S('dark_oak_log[axis=x]'));
            break;
          case 3: // dining room: tables of fences with pressure plates
            for (let tx = x + 2; tx <= x + 4; tx++) {
              m.set(tx, y0 + 1, zm, S('dark_oak_fence'));
              m.set(tx, y0 + 2, zm, S('oak_pressure_plate'));
            }
            m.set(x + 1, y0 + 1, zm, S('dark_oak_stairs[facing=east]'));
            m.set(x + 5, y0 + 1, zm, S('dark_oak_stairs[facing=west]'));
            break;
          case 4: // map room
            m.set(x + 3, y0 + 1, zm, S('cartography_table'));
            m.fill(x + 1, y0 + 3, z0, x + 5, y0 + 3, z0, S('white_wool'));
            break;
          default: // empty hall with a flower pot
            m.set(x + 3, y0 + 1, zm, S('potted_poppy'));
        }
      }
    // stairs up at the east end of the corridor
    if (f < FLOORS - 1)
      for (let i = 0; i < FLOOR_H; i++) {
        m.set(W - 2 - i - 1, y0 + 1 + i, cz0, S('dark_oak_stairs[facing=west]'));
        m.set(W - 2 - i - 1, y0 + FLOOR_H, cz0, air);
      }
  }
  // the entrance at the front centre
  const ex = W >> 1;
  m.fill(ex - 1, 1, 0, ex + 1, 3, 0, air);
  m.set(ex - 1, 1, 0, S('dark_oak_door[half=lower,facing=north,hinge=left]'));
  m.set(ex - 1, 2, 0, S('dark_oak_door[half=upper,facing=north,hinge=left]'));
  m.set(ex + 1, 1, 0, S('dark_oak_door[half=lower,facing=north,hinge=right]'));
  m.set(ex + 1, 2, 0, S('dark_oak_door[half=upper,facing=north,hinge=right]'));
  for (let z = 1; z < (D >> 1) - 2; z++) {
    m.set(ex, 1, z, carpet);
    m.set(ex, 2, z, air);
    for (let y = 1; y < FLOOR_H; y++) m.set(ex, y, (D >> 1) - 2, y < 4 ? air : birch);
  }
  // hipped roof
  const top = FLOORS * FLOOR_H;
  m.fill(0, top, 0, W - 1, top, D - 1, dk);
  for (let i = 0; i < roofH; i++) {
    const y = top + 1 + i;
    if (i * 2 >= D - 1) break;
    for (let x = i; x < W - i; x++) {
      m.set(x, y, i, S('dark_oak_stairs[facing=south]'));
      m.set(x, y, D - 1 - i, S('dark_oak_stairs[facing=north]'));
    }
    for (let z = i + 1; z < D - 1 - i; z++) {
      m.set(i, y, z, S('dark_oak_stairs[facing=east]'));
      m.set(W - 1 - i, y, z, S('dark_oak_stairs[facing=west]'));
      for (let x = i + 1; x < W - 1 - i; x++) m.set(x, y, z, i === roofH - 1 ? dk : air);
    }
  }
  return m;
}

export function woodlandMansion(s: StartContext): Piece[] {
  const r = s.rand;
  const rot = r.nextInt(4);
  const model = build(r);
  const x = (s.cx << 4) + 7, z = (s.cz << 4) + 7;
  const piece = new TemplatePiece(model, x, 64, z, rot, (c: PlaceContext, p) => {
    // WoodlandMansionFeature: the lowest of the four corner heights; 60 or less → no mansion
    const corners = [[p.box.x0, p.box.z0], [p.box.x1, p.box.z0], [p.box.x0, p.box.z1], [p.box.x1, p.box.z1]] as const;
    let min = 255;
    for (const [cx, cz] of corners) if (c.lv.world.isLoaded(cx, cz)) min = Math.min(min, c.lv.getHeight('WORLD_SURFACE_WG', cx, cz) - 1);
    if (min < 60) return -100;
    // foundation under the whole footprint
    for (let X = p.box.x0; X <= p.box.x1; X++)
      for (let Z = p.box.z0; Z <= p.box.z1; Z++) {
        if (!c.lv.canWrite(X, Z)) continue;
        for (let Y = min; Y > min - 16; Y--) {
          const st = c.lv.getState(X, Y, Z);
          if (IS_AIR[st] !== 1 && FLUID[st] === 0 && MATERIAL_BLOCKS_MOTION[st] === 1 && !/_log|_leaves/.test(String(st))) break;
          if (c.chunk.inside(X, Y, Z)) c.lv.setState(X, Y, Z, S('cobblestone'));
        }
      }
    return min + 1;
  });
  return [piece];
}
