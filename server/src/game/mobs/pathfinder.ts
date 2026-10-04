/**
 * Ground pathfinding (vanilla PathFinder + WalkNodeEvaluator, 1.17.1): A* over block nodes with
 * per-mob path type maluses (water 8, fire danger 8, fire 16, fences/lava/leaves impassable…),
 * step-up of one block, falls of up to getMaxFallDistance, diagonal moves and the closest
 * reachable node as a partial path when the target can't be reached.
 */
import { blockNameOf, getProp } from '@shared/world/blockstate';
import { collisionBoxes } from '@shared/world/shapes';
import { FLUID, FULL_COLLISION } from '@shared/world/blockinfo';
import { AABB, noCollision } from '@shared/entity/aabb';
import type { StateGetter } from '@shared/world/raycast';

export const enum PathType {
  BLOCKED, OPEN, WALKABLE, WALKABLE_DOOR, TRAPDOOR, POWDER_SNOW, FENCE, LAVA, WATER, WATER_BORDER, RAIL,
  DANGER_FIRE, DAMAGE_FIRE, DANGER_CACTUS, DAMAGE_CACTUS, DANGER_OTHER, DAMAGE_OTHER, DOOR_OPEN,
  DOOR_WOOD_CLOSED, DOOR_IRON_CLOSED, LEAVES, STICKY_HONEY, COCOA,
}

/** BlockPathTypes default maluses. */
export const DEFAULT_MALUS: Record<number, number> = {
  [PathType.BLOCKED]: -1, [PathType.OPEN]: 0, [PathType.WALKABLE]: 0, [PathType.WALKABLE_DOOR]: 0, [PathType.TRAPDOOR]: 0,
  [PathType.POWDER_SNOW]: -1, [PathType.FENCE]: -1, [PathType.LAVA]: -1, [PathType.WATER]: 8, [PathType.WATER_BORDER]: 8,
  [PathType.RAIL]: 0, [PathType.DANGER_FIRE]: 8, [PathType.DAMAGE_FIRE]: 16, [PathType.DANGER_CACTUS]: 8,
  [PathType.DAMAGE_CACTUS]: -1, [PathType.DANGER_OTHER]: 8, [PathType.DAMAGE_OTHER]: -1, [PathType.DOOR_OPEN]: 0,
  [PathType.DOOR_WOOD_CLOSED]: -1, [PathType.DOOR_IRON_CLOSED]: -1, [PathType.LEAVES]: -1, [PathType.STICKY_HONEY]: 8,
  [PathType.COCOA]: 0,
};

/** What the evaluator needs to know about the mob. */
export interface PathMob {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  onGround: boolean;
  /** step height (0.6 for mobs) */
  maxUpStep: number;
  canFloat: boolean;
  canOpenDoors: boolean;
  malus(t: PathType): number;
  maxFallDistance(): number;
}

export class Node {
  g = 0;
  h = 0;
  f = 0;
  walked = 0;
  costMalus = 0;
  heapIdx = -1;
  closed = false;
  cameFrom: Node | null = null;
  type: PathType = PathType.BLOCKED;
  constructor(readonly x: number, readonly y: number, readonly z: number) {}
  distanceTo(o: { x: number; y: number; z: number }): number {
    return Math.hypot(o.x - this.x, o.y - this.y, o.z - this.z);
  }
  manhattan(o: { x: number; y: number; z: number }): number {
    return Math.abs(o.x - this.x) + Math.abs(o.y - this.y) + Math.abs(o.z - this.z);
  }
}

export class Path {
  index = 0;
  constructor(readonly nodes: Node[], readonly target: { x: number; y: number; z: number }, readonly reached: boolean) {}
  get done(): boolean {
    return this.index >= this.nodes.length;
  }
  get next(): Node {
    return this.nodes[this.index]!;
  }
  get end(): Node | undefined {
    return this.nodes[this.nodes.length - 1];
  }
  advance(): void {
    this.index++;
  }
}

const isDoor = (n: string) => n.endsWith('_door');
const isFenceLike = (n: string) => n.endsWith('_fence') || n.endsWith('_wall') || n.endsWith('_fence_gate');

/** WalkNodeEvaluator.getBlockPathTypeRaw. */
export function rawPathType(w: StateGetter, x: number, y: number, z: number): PathType {
  const st = w.getState(x, y, z);
  if (st === 0) return PathType.OPEN;
  const n = blockNameOf(st);
  if (n === 'cave_air' || n === 'void_air') return PathType.OPEN;
  if (n.endsWith('_trapdoor') || n === 'lily_pad' || n === 'big_dripleaf') return PathType.TRAPDOOR;
  if (n === 'powder_snow') return PathType.POWDER_SNOW;
  if (n === 'cactus') return PathType.DAMAGE_CACTUS;
  if (n === 'sweet_berry_bush') return PathType.DAMAGE_OTHER;
  if (n === 'honey_block') return PathType.STICKY_HONEY;
  if (n === 'cocoa') return PathType.COCOA;
  const fl = FLUID[st];
  if (fl === 1 && !getProp(st, 'waterlogged')) return PathType.WATER;
  if (fl === 2) return PathType.LAVA;
  if (n === 'fire' || n === 'soul_fire' || n === 'magma_block' || ((n === 'campfire' || n === 'soul_campfire') && getProp(st, 'lit') === true)) return PathType.DAMAGE_FIRE;
  if (isDoor(n)) {
    if (getProp(st, 'open') === true) return PathType.DOOR_OPEN;
    return n === 'iron_door' ? PathType.DOOR_IRON_CLOSED : PathType.DOOR_WOOD_CLOSED;
  }
  if (n.endsWith('rail')) return PathType.RAIL;
  if (n.endsWith('_leaves')) return PathType.LEAVES;
  if (isFenceLike(n) && !(n.endsWith('_fence_gate') && getProp(st, 'open') === true)) return PathType.FENCE;
  if (fl === 1) return PathType.WATER;
  // BlockBehaviour.isPathfindable(LAND): anything without a full collision cube
  return FULL_COLLISION[st] ? PathType.BLOCKED : PathType.OPEN;
}

/** WalkNodeEvaluator.getBlockPathTypeStatic: walkable floors and nearby dangers. */
export function staticPathType(w: StateGetter, x: number, y: number, z: number): PathType {
  let t = rawPathType(w, x, y, z);
  if (t === PathType.OPEN && y >= 1) {
    const b = rawPathType(w, x, y - 1, z);
    t = b !== PathType.WALKABLE && b !== PathType.OPEN && b !== PathType.WATER && b !== PathType.LAVA ? PathType.WALKABLE : PathType.OPEN;
    if (b === PathType.DAMAGE_FIRE) t = PathType.DAMAGE_FIRE;
    if (b === PathType.DAMAGE_CACTUS) t = PathType.DAMAGE_CACTUS;
    if (b === PathType.DAMAGE_OTHER) t = PathType.DAMAGE_OTHER;
    if (b === PathType.STICKY_HONEY) t = PathType.STICKY_HONEY;
  }
  if (t === PathType.WALKABLE) t = checkNeighbours(w, x, y, z, t);
  return t;
}

function checkNeighbours(w: StateGetter, x: number, y: number, z: number, t: PathType): PathType {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const st = w.getState(x + dx, y + dy, z + dz);
        if (st === 0) continue;
        const n = blockNameOf(st);
        if (n === 'cactus') return PathType.DANGER_CACTUS;
        if (n === 'sweet_berry_bush') return PathType.DANGER_OTHER;
        if (n === 'fire' || n === 'soul_fire' || n === 'magma_block' || FLUID[st] === 2 || ((n === 'campfire' || n === 'soul_campfire') && getProp(st, 'lit') === true)) return PathType.DANGER_FIRE;
      }
  return t;
}

/** Collision-shape top of the block below (WalkNodeEvaluator.getFloorLevel). */
export function floorLevel(w: StateGetter, x: number, y: number, z: number, canFloat: boolean): number {
  if (canFloat && FLUID[w.getState(x, y, z)] === 1) return y + 0.5;
  const below = w.getState(x, y - 1, z);
  let top = 0;
  for (const b of collisionBoxes(below)) top = Math.max(top, b[4]);
  return y - 1 + top;
}

const DIRS: [number, number][] = [[0, 1], [-1, 0], [1, 0], [0, -1]];

/** One path search (the node/type caches live for the search only, like vanilla's PathNavigationRegion). */
export class PathSearch {
  private readonly nodes = new Map<number, Node>();
  private readonly types = new Map<number, PathType>();
  private readonly sizeX: number;
  private readonly sizeY: number;

  constructor(private readonly w: StateGetter, private readonly mob: PathMob) {
    this.sizeX = Math.floor(mob.width + 1);
    this.sizeY = Math.floor(mob.height + 1);
  }

  private key(x: number, y: number, z: number): number {
    return ((x + 30000) * 60001 + (z + 30000)) * 512 + (y + 64);
  }

  node(x: number, y: number, z: number): Node {
    const k = this.key(x, y, z);
    let n = this.nodes.get(k);
    if (!n) this.nodes.set(k, (n = new Node(x, y, z)));
    return n;
  }

  /** WalkNodeEvaluator.getBlockPathType over the mob's footprint. */
  typeAt(x: number, y: number, z: number): PathType {
    const k = this.key(x, y, z);
    const c = this.types.get(k);
    if (c !== undefined) return c;
    const m = this.mob;
    let first = PathType.BLOCKED;
    const seen: PathType[] = [];
    for (let i = 0; i < this.sizeX; i++)
      for (let j = 0; j < this.sizeY; j++)
        for (let l = 0; l < this.sizeX; l++) {
          let t = staticPathType(this.w, x + i, y + j, z + l);
          if (t === PathType.DOOR_WOOD_CLOSED && m.canOpenDoors) t = PathType.WALKABLE_DOOR;
          if (i === 0 && j === 0 && l === 0) first = t;
          seen.push(t);
        }
    let res: PathType;
    if (seen.includes(PathType.FENCE)) res = PathType.FENCE;
    else {
      let best = PathType.BLOCKED;
      res = -1 as PathType;
      // EnumSet iteration: unique types in enum order
      for (const t of [...new Set(seen)].sort((a, b) => a - b)) {
        if (m.malus(t) < 0) {
          res = t;
          break;
        }
        if (m.malus(t) >= m.malus(best)) best = t;
      }
      if (res === (-1 as PathType)) res = first === PathType.OPEN && m.malus(best) === 0 && this.sizeX <= 1 ? PathType.OPEN : best;
    }
    this.types.set(k, res);
    return res;
  }

  /** WalkNodeEvaluator.getStart. */
  start(): Node {
    const m = this.mob;
    const bx = Math.floor(m.x), bz = Math.floor(m.z);
    let y = Math.floor(m.y);
    if (m.canFloat && FLUID[this.w.getState(bx, y, bz)] === 1) {
      while (FLUID[this.w.getState(bx, y, bz)] === 1 && y < 255) y++;
      y--;
    } else if (m.onGround) y = Math.floor(m.y + 0.5);
    else {
      let py = Math.floor(m.y);
      while (py > 0 && !FULL_COLLISION[this.w.getState(bx, py, bz)] && collisionBoxes(this.w.getState(bx, py, bz)).length === 0 && FLUID[this.w.getState(bx, py, bz)] === 0) py--;
      y = py + 1;
    }
    const n = this.node(bx, y, bz);
    n.type = this.typeAt(bx, y, bz);
    n.costMalus = m.malus(n.type);
    return n;
  }

  private findAccepted(x: number, y: number, z: number, jump: number, nodeFloor: number, dx: number, dz: number, prevType: PathType): Node | null {
    const m = this.mob, w = this.w;
    let node: Node | null = null;
    const fl = floorLevel(w, x, y, z, m.canFloat);
    if (fl - nodeFloor > 1.125) return null;
    let type = this.typeAt(x, y, z);
    let f = m.malus(type);
    const half = m.width / 2;
    if (f >= 0) {
      node = this.node(x, y, z);
      node.type = type;
      node.costMalus = Math.max(node.costMalus, f);
    }
    if (prevType === PathType.FENCE && node && node.costMalus >= 0 && !this.reachableWithoutCollision(node)) node = null;
    if (type !== PathType.WALKABLE) {
      if ((node === null || node.costMalus < 0) && jump > 0 && type !== PathType.FENCE && type !== PathType.TRAPDOOR) {
        node = this.findAccepted(x, y + 1, z, jump - 1, nodeFloor, dx, dz, prevType);
        if (node && (node.type === PathType.OPEN || node.type === PathType.WALKABLE) && m.width < 1) {
          const cx = x - dx + 0.5, cz = z - dz + 0.5;
          const bb = new AABB(cx - half, floorLevel(w, Math.floor(cx), y + 1, Math.floor(cz), false) + 0.001, cz - half, cx + half, m.height + floorLevel(w, node.x, node.y, node.z, false) - 0.002, cz + half);
          if (!noCollision(w, bb)) node = null;
        }
      }
      if (type === PathType.WATER && !m.canFloat) {
        if (this.typeAt(x, y - 1, z) !== PathType.WATER) return node;
        while (y > 0) {
          y--;
          type = this.typeAt(x, y, z);
          f = m.malus(type);
          if (type !== PathType.WATER) return node;
          node = this.node(x, y, z);
          node.type = type;
          node.costMalus = Math.max(node.costMalus, f);
        }
      }
      if (type === PathType.OPEN) {
        let fallen = 0;
        const y0 = y;
        while (type === PathType.OPEN) {
          y--;
          if (y < 0) {
            const b = this.node(x, y0, z);
            b.type = PathType.BLOCKED;
            b.costMalus = -1;
            return b;
          }
          if (fallen++ >= m.maxFallDistance()) {
            const b = this.node(x, y, z);
            b.type = PathType.BLOCKED;
            b.costMalus = -1;
            return b;
          }
          type = this.typeAt(x, y, z);
          f = m.malus(type);
          if (type !== PathType.OPEN && f >= 0) {
            node = this.node(x, y, z);
            node.type = type;
            node.costMalus = Math.max(node.costMalus, f);
            break;
          }
          if (f < 0) {
            const b = this.node(x, y, z);
            b.type = PathType.BLOCKED;
            b.costMalus = -1;
            return b;
          }
        }
      }
      if (type === PathType.FENCE) {
        node = this.node(x, y, z);
        node.closed = true;
        node.type = type;
        node.costMalus = DEFAULT_MALUS[PathType.FENCE]!;
      }
    }
    return node;
  }

  private reachableWithoutCollision(n: Node): boolean {
    const m = this.mob;
    const cx = n.x + 0.5, cz = n.z + 0.5;
    const bb = AABB.ofSize(cx, n.y + 0.001, cz, m.width, m.height - 0.002);
    return noCollision(this.w, bb);
  }

  /** WalkNodeEvaluator.getNeighbors. */
  neighbours(n: Node, out: Node[]): number {
    out.length = 0;
    const m = this.mob;
    const above = this.typeAt(n.x, n.y + 1, n.z);
    const here = this.typeAt(n.x, n.y, n.z);
    const jump = m.malus(above) >= 0 && here !== PathType.STICKY_HONEY ? Math.floor(Math.max(1, m.maxUpStep)) : 0;
    const fl = floorLevel(this.w, n.x, n.y, n.z, m.canFloat);
    const side: (Node | null)[] = [];
    for (const [dx, dz] of DIRS) {
      const s = this.findAccepted(n.x + dx, n.y, n.z + dz, jump, fl, dx, dz, here);
      side.push(s);
      if (s && !s.closed && (s.costMalus >= 0 || n.costMalus < 0)) out.push(s);
    }
    // diagonals: south-west, south-east, north-west, north-east (each needs both sides open)
    const [s, wst, e, nn] = side;
    const diag = (a: Node | null, b: Node | null, dx: number, dz: number) => {
      if (!a || !b) return;
      const d = this.findAccepted(n.x + dx, n.y, n.z + dz, jump, fl, dx, dz, here);
      if (d && !d.closed && a.y <= n.y && b.y <= n.y && a.type !== PathType.WALKABLE_DOOR && b.type !== PathType.WALKABLE_DOOR && d.costMalus >= 0 && (a.y < n.y || a.costMalus >= 0) && (b.y < n.y || b.costMalus >= 0)) out.push(d);
    };
    diag(nn!, wst!, -1, -1);
    diag(nn!, e!, 1, -1);
    diag(s!, wst!, -1, 1);
    diag(s!, e!, 1, 1);
    return out.length;
  }
}

/** Binary heap on Node.f (vanilla BinaryHeap). */
class Heap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  insert(n: Node): void {
    n.heapIdx = this.a.length;
    this.a.push(n);
    this.up(n.heapIdx);
  }
  change(n: Node, f: number): void {
    const old = n.f;
    n.f = f;
    if (f < old) this.up(n.heapIdx);
    else this.down(n.heapIdx);
  }
  pop(): Node {
    const top = this.a[0]!;
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      last.heapIdx = 0;
      this.down(0);
    }
    top.heapIdx = -1;
    return top;
  }
  private up(i: number): void {
    const n = this.a[i]!;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pn = this.a[p]!;
      if (n.f >= pn.f) break;
      this.a[i] = pn;
      pn.heapIdx = i;
      i = p;
    }
    this.a[i] = n;
    n.heapIdx = i;
  }
  private down(i: number): void {
    const n = this.a[i]!;
    const len = this.a.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= len) break;
      let c = l;
      if (r < len && this.a[r]!.f < this.a[l]!.f) c = r;
      if (this.a[c]!.f >= n.f) break;
      this.a[i] = this.a[c]!;
      this.a[i]!.heapIdx = i;
      i = c;
    }
    this.a[i] = n;
    n.heapIdx = i;
  }
}

/**
 * PathFinder.findPath: search towards the block target; stop when a node is within `accuracy`
 * (Manhattan) of it; nodes beyond `maxRange` aren't expanded; at most maxRange × 16 visits.
 * Unreachable targets give a path to the node with the best heuristic.
 */
export function findPath(w: StateGetter, mob: PathMob, tx: number, ty: number, tz: number, maxRange: number, accuracy: number): Path | null {
  const search = new PathSearch(w, mob);
  const startNode = search.start();
  const target = { x: tx, y: ty, z: tz };
  const maxVisited = Math.floor(maxRange * 16);
  let best: Node = startNode;
  let bestH = startNode.distanceTo(target);
  startNode.g = 0;
  startNode.h = bestH;
  startNode.f = startNode.h;
  const open = new Heap();
  open.insert(startNode);
  const nb: Node[] = [];
  let visited = 0;
  let reached: Node | null = null;
  while (open.size) {
    if (++visited >= maxVisited) break;
    const n = open.pop();
    n.closed = true;
    if (n.manhattan(target) <= accuracy) {
      reached = n;
      break;
    }
    if (n.distanceTo(startNode) >= maxRange) continue;
    search.neighbours(n, nb);
    for (const m of nb) {
      const d = n.distanceTo(m);
      m.walked = n.walked + d;
      const g = n.g + d + m.costMalus;
      if (m.walked < maxRange && (m.heapIdx < 0 || g < m.g)) {
        m.cameFrom = n;
        m.g = g;
        const h = m.distanceTo(target);
        if (h < bestH) {
          bestH = h;
          best = m;
        }
        m.h = h * 1.5;
        if (m.heapIdx >= 0) open.change(m, m.g + m.h);
        else {
          m.f = m.g + m.h;
          open.insert(m);
        }
      }
    }
  }
  const end = reached ?? best;
  const nodes: Node[] = [];
  for (let c: Node | null = end; c; c = c.cameFrom) nodes.unshift(c);
  if (nodes.length === 0) return null;
  return new Path(nodes, target, reached !== null);
}
