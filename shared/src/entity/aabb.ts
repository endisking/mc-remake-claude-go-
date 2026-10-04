/** Axis-aligned bounding boxes and swept collision against block shapes (vanilla Shapes.collide). */
import { collisionBoxesFor, type CollisionContext } from '../world/shapes';
export type { CollisionContext } from '../world/shapes';
import type { StateGetter } from '../world/raycast';

export class AABB {
  constructor(
    public minX: number,
    public minY: number,
    public minZ: number,
    public maxX: number,
    public maxY: number,
    public maxZ: number,
  ) {}

  static ofSize(x: number, y: number, z: number, width: number, height: number): AABB {
    const h = width / 2;
    return new AABB(x - h, y, z - h, x + h, y + height, z + h);
  }

  move(dx: number, dy: number, dz: number): AABB {
    return new AABB(this.minX + dx, this.minY + dy, this.minZ + dz, this.maxX + dx, this.maxY + dy, this.maxZ + dz);
  }

  expandTowards(dx: number, dy: number, dz: number): AABB {
    return new AABB(
      dx < 0 ? this.minX + dx : this.minX, dy < 0 ? this.minY + dy : this.minY, dz < 0 ? this.minZ + dz : this.minZ,
      dx > 0 ? this.maxX + dx : this.maxX, dy > 0 ? this.maxY + dy : this.maxY, dz > 0 ? this.maxZ + dz : this.maxZ,
    );
  }

  inflate(x: number, y = x, z = x): AABB {
    return new AABB(this.minX - x, this.minY - y, this.minZ - z, this.maxX + x, this.maxY + y, this.maxZ + z);
  }

  deflate(v: number): AABB {
    return this.inflate(-v);
  }

  intersects(o: AABB): boolean {
    return this.minX < o.maxX && this.maxX > o.minX && this.minY < o.maxY && this.maxY > o.minY && this.minZ < o.maxZ && this.maxZ > o.minZ;
  }
}

const EPS = 1e-7;

/** Collect block collision boxes (world space) overlapping `box`. */
export function blockBoxesIn(world: StateGetter, box: AABB, out: AABB[] = [], ctx: CollisionContext | null = null): AABB[] {
  out.length = 0;
  const x0 = Math.floor(box.minX - EPS) - 1, x1 = Math.floor(box.maxX + EPS) + 1;
  const y0 = Math.floor(box.minY - EPS) - 1, y1 = Math.floor(box.maxY + EPS) + 1;
  const z0 = Math.floor(box.minZ - EPS) - 1, z1 = Math.floor(box.maxZ + EPS) + 1;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y > 255) continue;
        const st = world.getState(x, y, z);
        if (st === 0) continue;
        for (const b of collisionBoxesFor(st, y, ctx)) {
          const bb = new AABB(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
          if (bb.maxX > box.minX - 1 && bb.minX < box.maxX + 1 && bb.maxY > box.minY - 1 && bb.minY < box.maxY + 1 && bb.maxZ > box.minZ - 1 && bb.minZ < box.maxZ + 1) out.push(bb);
        }
      }
  return out;
}

/** Vanilla Shapes.collide along one axis: clip `d` so `box` moved by it doesn't enter any of `shapes`. */
export function collideAxis(axis: 0 | 1 | 2, box: AABB, shapes: AABB[], d: number): number {
  if (Math.abs(d) < EPS) return 0;
  for (const s of shapes) {
    if (axis === 0) {
      if (box.maxY <= s.minY + EPS || box.minY >= s.maxY - EPS || box.maxZ <= s.minZ + EPS || box.minZ >= s.maxZ - EPS) continue;
      if (d > 0 && box.maxX <= s.minX + EPS) d = Math.min(d, s.minX - box.maxX);
      else if (d < 0 && box.minX >= s.maxX - EPS) d = Math.max(d, s.maxX - box.minX);
    } else if (axis === 1) {
      if (box.maxX <= s.minX + EPS || box.minX >= s.maxX - EPS || box.maxZ <= s.minZ + EPS || box.minZ >= s.maxZ - EPS) continue;
      if (d > 0 && box.maxY <= s.minY + EPS) d = Math.min(d, s.minY - box.maxY);
      else if (d < 0 && box.minY >= s.maxY - EPS) d = Math.max(d, s.maxY - box.minY);
    } else {
      if (box.maxX <= s.minX + EPS || box.minX >= s.maxX - EPS || box.maxY <= s.minY + EPS || box.minY >= s.maxY - EPS) continue;
      if (d > 0 && box.maxZ <= s.minZ + EPS) d = Math.min(d, s.minZ - box.maxZ);
      else if (d < 0 && box.minZ >= s.maxZ - EPS) d = Math.max(d, s.maxZ - box.minZ);
    }
  }
  return Math.abs(d) < EPS ? 0 : d;
}

/**
 * Vanilla Entity.collideBoundingBox: Y first, then the larger of X/Z first.
 * Returns the allowed movement.
 */
export function collideBox(world: StateGetter, box: AABB, dx: number, dy: number, dz: number, ctx: CollisionContext | null = null): [number, number, number] {
  const shapes = blockBoxesIn(world, box.expandTowards(dx, dy, dz), scratchShapes, ctx);
  let b = box;
  if (dy !== 0) {
    dy = collideAxis(1, b, shapes, dy);
    if (dy !== 0) b = b.move(0, dy, 0);
  }
  const zFirst = Math.abs(dx) < Math.abs(dz);
  if (zFirst && dz !== 0) {
    dz = collideAxis(2, b, shapes, dz);
    if (dz !== 0) b = b.move(0, 0, dz);
  }
  if (dx !== 0) {
    dx = collideAxis(0, b, shapes, dx);
    if (!zFirst && dx !== 0) b = b.move(dx, 0, 0);
  }
  if (!zFirst && dz !== 0) dz = collideAxis(2, b, shapes, dz);
  return [dx, dy, dz];
}

const scratchShapes: AABB[] = [];

/** True if no block collision box intersects `box`. */
export function noCollision(world: StateGetter, box: AABB, ctx: CollisionContext | null = null): boolean {
  const shapes = blockBoxesIn(world, box, scratchShapes, ctx);
  for (const s of shapes) if (s.intersects(box)) return false;
  return true;
}
