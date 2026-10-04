/**
 * Woodland mansions (vanilla 1.17.1 WoodlandMansionFeature: dark forest only, 80/20 triangular
 * spacing, the whole 32-block biome check, and the corner rule — the lowest terrain height of the
 * corners of a 5×5 area at the start must be at least 60, else no mansion; built one block above
 * it). The layout follows the mansion's logic with our own building blocks: a grid of 8×8-block
 * cells grown from the entrance (vanilla's MansionGrid), two or three floors each a subset of
 * the one below, a carpeted corridor tree joining the rooms, rooms of every kind (bedrooms,
 * libraries, storerooms with the woodland_mansion chests, dining halls, map rooms, the cobweb
 * room), a staircase cell, cobblestone ground floor, dark oak walls with log pillars, windows and
 * stepped roofs. Vindicators, evokers and the allay-free illager cast are entities and are not
 * placed here.
 */
import type { JavaRandom } from '../../util/random';
import { BoundingBox, S, type Piece, shuffle } from './piece';
import { Model, TemplatePiece } from './template';
import type { StartContext } from './placement';
import { FLUID, IS_AIR } from '../../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION } from '../../world/blockprops';

const G = 9, CELL = 8, FH = 7;

type Room = 'corridor' | 'bedroom' | 'library' | 'store' | 'dining' | 'map' | 'webs' | 'stairs' | 'hall';

function grow(r: JavaRandom, from: Set<number>, target: number, start: number): Set<number> {
  const cells = new Set<number>([start]);
  const frontier = [start];
  while (cells.size < target && frontier.length) {
    const c = frontier[r.nextInt(frontier.length)]!;
    const cx = c % G, cz = Math.floor(c / G);
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cx + dx!, cz + dz!]).filter(([x, z]) => x! >= 0 && z! >= 0 && x! < G && z! < G).map(([x, z]) => z! * G + x!).filter((n) => !cells.has(n) && from.has(n));
    if (!nb.length) {
      frontier.splice(frontier.indexOf(c), 1);
      continue;
    }
    const n = nb[r.nextInt(nb.length)]!;
    cells.add(n);
    frontier.push(n);
  }
  return cells;
}

function build(r: JavaRandom): Model {
  const all = new Set<number>();
  for (let i = 0; i < G * G; i++) all.add(i);
  const entrance = 0 * G + (G >> 1);
  const floors: Set<number>[] = [grow(r, all, 26 + r.nextInt(10), entrance)];
  const stairsCell = (() => {
    const list = [...floors[0]!].filter((c) => c !== entrance);
    return list[r.nextInt(list.length)]!;
  })();
  floors.push(grow(r, floors[0]!, Math.floor(floors[0]!.size * 0.75), stairsCell));
  if (r.nextBoolean()) floors.push(grow(r, floors[1]!, Math.floor(floors[1]!.size * 0.5), stairsCell));
  const m = new Model(G * CELL + 1, floors.length * FH + 4, G * CELL + 1);
  const cob = S('cobblestone'), dk = S('dark_oak_planks'), log = S('dark_oak_log[axis=y]'), birch = S('birch_planks'), air = S('air');
  const glass = S('glass_pane'), carpet = S('red_carpet'), wool = S('white_carpet');
  const has = (f: number, cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < G && cz < G && f < floors.length && floors[f]!.has(cz * G + cx);

  floors.forEach((cells, f) => {
    const y0 = f * FH;
    // corridor tree over this floor's cells (random spanning tree from the stairs/entrance)
    const root = f === 0 ? entrance : stairsCell;
    const tree = new Map<number, number>([[root, -1]]);
    const order = [root];
    for (let i = 0; i < order.length; i++) {
      const c = order[i]!;
      const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => c + dx! + dz! * G).filter((n, k) => {
        const [dx] = [[1, 0], [-1, 0], [0, 1], [0, -1]][k]!;
        const sameRow = dx !== 0 ? Math.floor(n / G) === Math.floor(c / G) : true;
        return sameRow && cells.has(n) && !tree.has(n);
      });
      shuffle(nbs, r);
      for (const n of nbs) {
        tree.set(n, c);
        order.push(n);
      }
    }
    // the corridor cells: the root and roughly every other cell along the tree, the rest are rooms
    const kind = new Map<number, Room>();
    for (const c of order) {
      const parent = tree.get(c)!;
      const corridor = c === root || (parent >= 0 && kind.get(parent) === 'corridor' && r.nextInt(3) > 0 && [...tree.values()].includes(c));
      kind.set(c, corridor ? 'corridor' : 'hall');
    }
    kind.set(stairsCell, 'stairs');
    if (f === 0) kind.set(entrance, 'corridor');
    const rooms: Room[] = ['bedroom', 'library', 'store', 'dining', 'map', 'webs', 'bedroom', 'store'];
    for (const [c, k] of kind) if (k === 'hall') kind.set(c, rooms[r.nextInt(rooms.length)]!);

    for (const c of cells) {
      const cx = c % G, cz = Math.floor(c / G);
      const x0 = cx * CELL, z0 = cz * CELL;
      const k = kind.get(c)!;
      // floor and ceiling
      m.fill(x0, y0, z0, x0 + CELL, y0, z0 + CELL, f === 0 ? cob : dk);
      m.fill(x0 + 1, y0 + 1, z0 + 1, x0 + CELL - 1, y0 + FH - 1, z0 + CELL - 1, air);
      // walls: outside walls where the neighbour cell is missing, birch partitions inside
      const sides: [number, number, boolean][] = [[0, -1, !has(f, cx, cz - 1)], [0, 1, !has(f, cx, cz + 1)], [-1, 0, !has(f, cx - 1, cz)], [1, 0, !has(f, cx + 1, cz)]];
      for (const [dx, dz, outside] of sides) {
        for (let i = 0; i <= CELL; i++)
          for (let y = y0 + 1; y < y0 + FH; y++) {
            const x = dx === 0 ? x0 + i : dx < 0 ? x0 : x0 + CELL;
            const z = dz === 0 ? z0 + i : dz < 0 ? z0 : z0 + CELL;
            const pillar = i === 0 || i === CELL;
            if (pillar) m.set(x, y, z, log);
            else if (outside) m.set(x, y, z, (y === y0 + 2 || y === y0 + 3) && (i === 3 || i === 5) ? glass : f === 0 && y === y0 + 1 ? cob : dk);
            else m.set(x, y, z, birch);
          }
        if (!outside) {
          // doorway to the neighbour when they're joined in the tree, or room ↔ corridor
          const n = c + dx + dz * G;
          const joined = tree.get(n) === c || tree.get(c) === n || kind.get(n) === 'corridor' || k === 'corridor';
          if (joined) {
            const x = dx === 0 ? x0 + 4 : dx < 0 ? x0 : x0 + CELL;
            const z = dz === 0 ? z0 + 4 : dz < 0 ? z0 : z0 + CELL;
            for (let y = y0 + 1; y <= y0 + 3; y++) {
              m.set(x, y, z, air);
              if (k === 'corridor' && kind.get(n) === 'corridor') {
                m.set(dx === 0 ? x - 1 : x, y, dz === 0 ? z - 1 : z, air);
                m.set(dx === 0 ? x + 1 : x, y, dz === 0 ? z + 1 : z, air);
              }
            }
          }
        }
      }
      m.set(x0 + 4, y0 + FH - 1, z0 + 4, S('lantern[hanging=true]'));
      furnish(m, r, k, x0, y0, z0, carpet, wool, f);
      // roof where nothing is built above
      if (!has(f + 1, cx, cz)) {
        const yr = y0 + FH;
        m.fill(x0, yr, z0, x0 + CELL, yr, z0 + CELL, dk);
        for (let i = 0; i <= CELL; i++) {
          if (!has(f, cx, cz - 1)) m.set(x0 + i, yr + 1, z0, S('dark_oak_stairs[facing=south]'));
          if (!has(f, cx, cz + 1)) m.set(x0 + i, yr + 1, z0 + CELL, S('dark_oak_stairs[facing=north]'));
          if (!has(f, cx - 1, cz)) m.set(x0, yr + 1, z0 + i, S('dark_oak_stairs[facing=east]'));
          if (!has(f, cx + 1, cz)) m.set(x0 + CELL, yr + 1, z0 + i, S('dark_oak_stairs[facing=west]'));
        }
        m.fill(x0 + 2, yr + 1, z0 + 2, x0 + CELL - 2, yr + 1, z0 + CELL - 2, dk);
        m.fill(x0 + 3, yr + 2, z0 + 3, x0 + CELL - 3, yr + 2, z0 + CELL - 3, S('dark_oak_slab[type=bottom]'));
      }
    }
  });
  // the double front door
  const ex = (G >> 1) * CELL + 4;
  for (let y = 1; y <= 3; y++) for (let x = ex - 1; x <= ex + 1; x++) m.set(x, y, 0, air);
  m.set(ex - 1, 1, 0, S('dark_oak_door[half=lower,facing=north,hinge=left]'));
  m.set(ex - 1, 2, 0, S('dark_oak_door[half=upper,facing=north,hinge=left]'));
  m.set(ex, 1, 0, S('dark_oak_door[half=lower,facing=north,hinge=right]'));
  m.set(ex, 2, 0, S('dark_oak_door[half=upper,facing=north,hinge=right]'));
  return m;
}

function furnish(m: Model, r: JavaRandom, k: Room, x0: number, y0: number, z0: number, carpet: number, wool: number, f: number): void {
  const y = y0 + 1;
  // the mansion's illagers: vindicators about the rooms, now and then an evoker
  if (k !== 'corridor' && k !== 'stairs' && r.nextInt(3) === 0) m.entity(x0 + 4, y, z0 + 5, r.nextInt(4) === 0 ? 'evoker' : 'vindicator');
  switch (k) {
    case 'corridor':
      m.fill(x0 + 1, y, z0 + 1, x0 + 7, y, z0 + 7, carpet);
      m.fill(x0 + 2, y, z0 + 2, x0 + 6, y, z0 + 6, wool);
      break;
    case 'stairs':
      // a straight flight along x up to the next floor
      for (let i = 0; i < FH; i++) {
        m.set(x0 + 1 + i, y + i, z0 + 3, S('dark_oak_stairs[facing=east]'));
        m.set(x0 + 1 + i, y + i, z0 + 4, S('dark_oak_stairs[facing=east]'));
        for (let h = 1; h <= 3; h++) {
          m.set(x0 + 1 + i, y + i + h, z0 + 3, S('air'));
          m.set(x0 + 1 + i, y + i + h, z0 + 4, S('air'));
        }
      }
      break;
    case 'bedroom':
      m.set(x0 + 2, y, z0 + 2, S('white_bed[part=head,facing=north]'));
      m.set(x0 + 2, y, z0 + 3, S('white_bed[part=foot,facing=north]'));
      m.set(x0 + 6, y, z0 + 2, S('white_bed[part=head,facing=north]'));
      m.set(x0 + 6, y, z0 + 3, S('white_bed[part=foot,facing=north]'));
      m.set(x0 + 4, y, z0 + 6, S('crafting_table'));
      m.set(x0 + 4, y, z0 + 2, S('potted_poppy'));
      break;
    case 'library':
      for (let i = 1; i <= 7; i++) {
        m.fill(x0 + 1, y, z0 + i, x0 + 1, y + 2, z0 + i, S('bookshelf'));
        m.fill(x0 + 7, y, z0 + i, x0 + 7, y + 2, z0 + i, S('bookshelf'));
      }
      m.set(x0 + 4, y, z0 + 4, S('lectern[facing=north]'));
      break;
    case 'store':
      m.chest(x0 + 2, y, z0 + 2, 'chests/woodland_mansion', S('chest[facing=south]'));
      if (r.nextInt(3) === 0) m.chest(x0 + 6, y, z0 + 6, 'chests/woodland_mansion', S('chest[facing=north]'));
      m.set(x0 + 6, y, z0 + 2, S('dark_oak_log[axis=x]'));
      m.set(x0 + 2, y, z0 + 6, S('pumpkin'));
      break;
    case 'dining':
      for (let x = x0 + 2; x <= x0 + 6; x++) {
        m.set(x, y, z0 + 4, S('dark_oak_fence'));
        m.set(x, y + 1, z0 + 4, S('white_carpet'));
        m.set(x, y, z0 + 3, S('dark_oak_stairs[facing=south]'));
        m.set(x, y, z0 + 5, S('dark_oak_stairs[facing=north]'));
      }
      break;
    case 'map':
      m.set(x0 + 4, y, z0 + 4, S('cartography_table'));
      m.fill(x0 + 2, y + 2, z0 + 1, x0 + 6, y + 3, z0 + 1, S('white_wool'));
      m.set(x0 + 2, y, z0 + 6, S('dark_oak_fence'));
      break;
    case 'webs':
      for (let i = 0; i < 10; i++) m.set(x0 + 1 + r.nextInt(7), y + r.nextInt(FH - 2), z0 + 1 + r.nextInt(7), S('cobweb'));
      if (f > 0) m.chest(x0 + 4, y, z0 + 4, 'chests/woodland_mansion', S('chest[facing=south]'));
      break;
    default:
      break;
  }
}

/** Terrain height (top block) at a column of the start's freshly generated chunk (vanilla getBaseHeight). */
function baseHeight(s: StartContext, x: number, z: number): number {
  const cx = x >> 4, cz = z >> 4;
  const chunk = s.gen.generate(cx, cz);
  return chunk.motionBlocking[((z & 15) << 4) | (x & 15)]! - 1;
}

export function woodlandMansion(s: StartContext): Piece[] {
  const r = s.rand;
  const rot = r.nextInt(4);
  // WoodlandMansionFeature: corners of a 5×5 area at (chunk + 7) must be at least y 60
  const x = (s.cx << 4) + 7, z = (s.cz << 4) + 7;
  let min = 255;
  for (const [dx, dz] of [[0, 0], [5, 0], [0, 5], [5, 5]] as const) min = Math.min(min, baseHeight(s, x + dx, z + dz));
  if (min < 60) return [];
  const model = build(r);
  const half = (G * CELL) >> 1;
  const piece = new TemplatePiece(model, x - half, min + 1, z - half, rot, null, null);
  piece.box = new BoundingBox(x - half, min + 1, z - half, x - half + model.sx - 1, min + model.sy, z - half + model.sz - 1);
  // foundation under every built cell (vanilla fills cobblestone below the ground floor)
  const inner = piece.postProcess.bind(piece);
  piece.postProcess = (c) => {
    for (let X = piece.box.x0; X <= piece.box.x1; X++)
      for (let Z = piece.box.z0; Z <= piece.box.z1; Z++) {
        if (!c.chunk.inside(X, piece.box.y0, Z)) continue;
        for (let Y = piece.box.y0 - 1; Y > piece.box.y0 - 16; Y--) {
          const st = c.lv.getState(X, Y, Z);
          if (IS_AIR[st] !== 1 && FLUID[st] === 0 && MATERIAL_BLOCKS_MOTION[st] === 1) break;
          if (!floorAt(piece, X, Z)) break;
          c.lv.setState(X, Y, Z, S('cobblestone'));
        }
      }
    return inner(c);
  };
  return [piece];
}

/** Whether the model has its ground floor at world column (X, Z) (inverse of the piece's frame). */
function floorAt(p: TemplatePiece, X: number, Z: number): boolean {
  const b = p.box;
  let x: number, z: number;
  switch (p.rot & 3) {
    case 1: z = b.x1 - X; x = Z - b.z0; break;
    case 2: x = b.x1 - X; z = b.z1 - Z; break;
    case 3: z = X - b.x0; x = b.z1 - Z; break;
    default: x = X - b.x0; z = Z - b.z0;
  }
  return p.model.get(x, 0, z) >= 0;
}
