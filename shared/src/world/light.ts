/**
 * Light engine: sky light and block light (0–15) with flood-fill propagation and removal.
 *
 * Rules (vanilla Java 1.17.1):
 * - Light entering a cell loses max(1, opacity of that cell).
 * - Sky light at level 15 travels straight down through opacity-0 cells without loss.
 * - Shape-occluding blocks (slabs, stairs, snow, ...) block light through faces their shape covers.
 * - Above the world (y > 255) sky light is 15.
 */
import { Chunk, sectionIndex } from './chunk';
import {
  LIGHT_EMIT, LIGHT_FILTER, USE_SHAPE_LIGHT, LIGHT_FACE_OCCLUSION, lightPasses,
  FACE_DX, FACE_DY, FACE_DZ,
} from './blockinfo';
import type { BlockWorld } from './world';

const SKY = 0;
const BLOCK = 1;

/** Growable FIFO of (x, y, z, level) integer tuples. */
class Queue {
  data = new Int32Array(4 * 4096);
  head = 0;
  tail = 0;
  push(x: number, y: number, z: number, l: number): void {
    if (this.tail + 4 > this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail + 4 > this.data.length) {
        const n = new Int32Array(this.data.length * 2);
        n.set(this.data.subarray(0, this.tail));
        this.data = n;
      }
    }
    const d = this.data;
    d[this.tail++] = x;
    d[this.tail++] = y;
    d[this.tail++] = z;
    d[this.tail++] = l;
  }
  get empty(): boolean {
    return this.head === this.tail;
  }
  clear(): void {
    this.head = this.tail = 0;
  }
}

/** Does sky light pass straight down out of this state (opacity 0, bottom face open)? */
function skyFallsThrough(state: number): boolean {
  if (LIGHT_FILTER[state] !== 0) return false;
  if (USE_SHAPE_LIGHT[state] && LIGHT_FACE_OCCLUSION[state]! & 0b11) return false;
  return true;
}

export class LightEngine {
  private add = new Queue();
  private rem = new Queue();
  /** Sections whose light changed: callback(cx, sectionY, cz). */
  onSectionChanged: ((cx: number, sy: number, cz: number) => void) | null = null;

  constructor(readonly world: BlockWorld) {}

  // ------------------------------------------------------------ cell access
  private chunk: Chunk | undefined;
  private ccx = 0;
  private ccz = 0;

  private chunkFor(x: number, z: number): Chunk | undefined {
    const cx = x >> 4, cz = z >> 4;
    if (this.chunk && this.ccx === cx && this.ccz === cz) return this.chunk;
    this.chunk = this.world.getChunk(cx, cz);
    this.ccx = cx;
    this.ccz = cz;
    return this.chunk;
  }

  private get(ch: number, x: number, y: number, z: number): number {
    if (y > 255) return ch === SKY ? 15 : 0;
    if (y < 0) return 0;
    const c = this.chunkFor(x, z);
    if (!c) return 0;
    const l = c.sections[y >> 4]!.getLight(sectionIndex(x & 15, y & 15, z & 15));
    return ch === SKY ? l >> 4 : l & 15;
  }

  private set(ch: number, x: number, y: number, z: number, v: number): void {
    const c = this.chunkFor(x, z);
    if (!c) return;
    const sec = c.sections[y >> 4]!;
    const i = sectionIndex(x & 15, y & 15, z & 15);
    if (ch === SKY) sec.setSky(i, v);
    else sec.setBlockLight(i, v);
    this.markChanged(c, x, y, z);
  }

  private state(x: number, y: number, z: number): number {
    if (y < 0 || y > 255) return 0;
    const c = this.chunkFor(x, z);
    if (!c) return 0;
    return c.sections[y >> 4]!.getState(sectionIndex(x & 15, y & 15, z & 15));
  }

  private changed = new Set<number>();
  private markChanged(c: Chunk, x: number, y: number, z: number): void {
    // also neighbors' meshes depend on border light; mark adjacent sections too
    const sy = y >> 4;
    this.mark(c.x, sy, c.z);
    const lx = x & 15, ly = y & 15, lz = z & 15;
    if (lx === 0) this.mark(c.x - 1, sy, c.z);
    else if (lx === 15) this.mark(c.x + 1, sy, c.z);
    if (lz === 0) this.mark(c.x, sy, c.z - 1);
    else if (lz === 15) this.mark(c.x, sy, c.z + 1);
    if (ly === 0 && sy > 0) this.mark(c.x, sy - 1, c.z);
    else if (ly === 15 && sy < 15) this.mark(c.x, sy + 1, c.z);
  }
  private mark(cx: number, sy: number, cz: number): void {
    if (!this.onSectionChanged) return;
    const key = ((cx + 0x200000) * 0x400000 + (cz + 0x200000)) * 16 + sy;
    if (this.changed.has(key)) return;
    this.changed.add(key);
    this.onSectionChanged(cx, sy, cz);
  }
  /** Clear the per-batch dedupe set (call after consumers have processed changes). */
  flushChanged(): void {
    this.changed.clear();
  }

  // ------------------------------------------------------------ propagation
  /** Level a neighbor at (level) passes into a cell of `toState`, moving in direction `face`. */
  private static pass(ch: number, level: number, toState: number, face: number): number {
    const op = LIGHT_FILTER[toState]!;
    if (ch === SKY && face === 0 && level === 15 && op === 0) return 15;
    return level - (op > 1 ? op : 1);
  }

  private propagate(ch: number): void {
    const q = this.add;
    const d = () => q.data;
    while (q.head < q.tail) {
      const x = d()[q.head++]!, y = d()[q.head++]!, z = d()[q.head++]!;
      q.head++; // stored level unused; read the live value
      const level = this.get(ch, x, y, z);
      if (level <= 1) continue;
      const from = this.state(x, y, z);
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f], ny = y + FACE_DY[f], nz = z + FACE_DZ[f];
        if (ny < 0 || ny > 255) continue;
        if (!this.chunkFor(nx, nz)) continue;
        const to = this.state(nx, ny, nz);
        if (LIGHT_FILTER[to] === 15 && !USE_SHAPE_LIGHT[to]) continue;
        if (!lightPasses(from, to, f)) continue;
        const nl = LightEngine.pass(ch, level, to, f);
        if (nl > this.get(ch, nx, ny, nz)) {
          this.set(ch, nx, ny, nz, nl);
          q.push(nx, ny, nz, nl);
        }
      }
    }
    q.clear();
  }

  private unpropagate(ch: number): void {
    const r = this.rem;
    while (r.head < r.tail) {
      const d = r.data;
      const x = d[r.head++]!, y = d[r.head++]!, z = d[r.head++]!, level = d[r.head++]!;
      for (let f = 0; f < 6; f++) {
        const nx = x + FACE_DX[f], ny = y + FACE_DY[f], nz = z + FACE_DZ[f];
        if (ny < 0 || ny > 255) continue;
        if (!this.chunkFor(nx, nz)) continue;
        const nl = this.get(ch, nx, ny, nz);
        if (nl === 0) continue;
        const dependent = nl < level || (ch === SKY && f === 0 && level === 15 && nl === 15);
        if (dependent) {
          this.set(ch, nx, ny, nz, 0);
          r.push(nx, ny, nz, nl);
          if (ch === BLOCK) {
            const e = LIGHT_EMIT[this.state(nx, ny, nz)]!;
            if (e > 0) {
              this.set(ch, nx, ny, nz, e);
              this.add.push(nx, ny, nz, e);
            }
          }
        } else {
          this.add.push(nx, ny, nz, nl);
        }
      }
    }
    r.clear();
  }

  /** Light a cell would receive from its neighbors (and itself, for block light). */
  private expected(ch: number, x: number, y: number, z: number): number {
    const st = this.state(x, y, z);
    let best = ch === BLOCK ? LIGHT_EMIT[st]! : 0;
    if (LIGHT_FILTER[st] === 15 && !USE_SHAPE_LIGHT[st]) return best;
    for (let f = 0; f < 6; f++) {
      // neighbor at the opposite side flows toward us in direction f
      const nx = x - FACE_DX[f], ny = y - FACE_DY[f], nz = z - FACE_DZ[f];
      let nl: number;
      let ns: number;
      if (ny > 255) {
        if (ch !== SKY) continue;
        nl = 15;
        ns = 0;
      } else if (ny < 0) continue;
      else {
        if (!this.chunkFor(nx, nz)) continue;
        nl = this.get(ch, nx, ny, nz);
        ns = this.state(nx, ny, nz);
      }
      if (nl <= 1 && !(ch === SKY && nl === 15)) continue;
      if (!lightPasses(ns, st, f)) continue;
      const v = LightEngine.pass(ch, nl, st, f);
      if (v > best) best = v;
    }
    return best;
  }

  // ------------------------------------------------------------ public API
  /** Recompute light around a block whose state just changed from `oldState`. */
  onBlockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    if (
      LIGHT_EMIT[oldState] === LIGHT_EMIT[newState] &&
      LIGHT_FILTER[oldState] === LIGHT_FILTER[newState] &&
      LIGHT_FACE_OCCLUSION[oldState] === LIGHT_FACE_OCCLUSION[newState]
    ) {
      return;
    }
    const c = this.chunkFor(x, z);
    if (c) this.updateSkyTop(c, x & 15, z & 15);
    for (const ch of [SKY, BLOCK]) {
      const old = this.get(ch, x, y, z);
      const exp = this.expected(ch, x, y, z);
      if (exp < old || LIGHT_FILTER[newState]! > LIGHT_FILTER[oldState]! || LIGHT_FACE_OCCLUSION[newState] !== LIGHT_FACE_OCCLUSION[oldState]) {
        // darken: remove our old contribution, then refill from what remains
        this.set(ch, x, y, z, 0);
        this.rem.push(x, y, z, old);
        this.unpropagate(ch);
        const e = this.expected(ch, x, y, z);
        if (e > this.get(ch, x, y, z)) this.set(ch, x, y, z, e);
        this.add.push(x, y, z, e);
        this.propagate(ch);
      } else if (exp > old) {
        this.set(ch, x, y, z, exp);
        this.add.push(x, y, z, exp);
        this.propagate(ch);
      }
    }
  }

  private updateSkyTop(c: Chunk, lx: number, lz: number): void {
    let top = 0;
    for (let y = 255; y >= 0; y--) {
      if (!skyFallsThrough(c.getState(lx, y, lz))) {
        top = y + 1;
        break;
      }
    }
    c.skyTop[lz * 16 + lx] = top;
  }

  /**
   * Compute all light for a freshly generated/loaded chunk, pulling light in from (and
   * pushing it out to) already-loaded neighbors.
   */
  lightChunk(c: Chunk): void {
    const bx = c.x << 4, bz = c.z << 4;
    // reset light: every section starts dark (sky computed below)
    for (const s of c.sections) {
      s.light = null;
      s.uniformLight = 0;
    }
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) this.updateSkyTop(c, lx, lz);

    // straight-down sky fill: 15 above skyTop. Whole empty sections above all tops stay uniform.
    let maxTop = 0;
    for (let i = 0; i < 256; i++) if (c.skyTop[i]! > maxTop) maxTop = c.skyTop[i]!;
    for (let s = 15; s >= 0; s--) {
      if (s << 4 >= maxTop) c.sections[s]!.uniformLight = 0xf0;
    }
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const top = c.skyTop[lz * 16 + lx]!;
        for (let y = top; y < Math.min(256, ((maxTop + 15) >> 4) << 4); y++) {
          c.sections[y >> 4]!.setSky(sectionIndex(lx, y & 15, lz), 15);
        }
      }

    // seed sky spread: lit cells next to darker columns
    const SKYQ = this.add;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const top = c.skyTop[lz * 16 + lx]!;
        let hi = top;
        for (let f = 2; f < 6; f++) {
          const nx = lx + FACE_DX[f], nz = lz + FACE_DZ[f];
          let nTop: number;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) nTop = c.skyTop[nz * 16 + nx]!;
          else {
            const n = this.world.getChunk((bx + nx) >> 4, (bz + nz) >> 4);
            nTop = n ? n.skyTop[((bz + nz) & 15) * 16 + ((bx + nx) & 15)]! : 0;
          }
          if (nTop > hi) hi = nTop;
        }
        for (let y = top; y <= Math.min(255, hi); y++) SKYQ.push(bx + lx, y, bz + lz, 15);
      }
    // pull sky light from loaded neighbors' border cells
    this.seedFromNeighbors(c, SKY);
    this.propagate(SKY);

    // block light: emitters
    for (let s = 0; s < 16; s++) {
      const sec = c.sections[s]!;
      if (!sec.blocks) continue;
      const b = sec.blocks;
      for (let i = 0; i < 4096; i++) {
        const e = LIGHT_EMIT[b[i]!]!;
        if (e > 0) {
          const x = bx + (i & 15), y = (s << 4) | (i >> 8), z = bz + ((i >> 4) & 15);
          sec.setBlockLight(i, e);
          this.add.push(x, y, z, e);
        }
      }
    }
    this.seedFromNeighbors(c, BLOCK);
    this.propagate(BLOCK);

    for (const s of c.sections) s.compactLight();
    c.lit = true;
    for (let s = 0; s < 16; s++) this.mark(c.x, s, c.z);
  }

  private seedFromNeighbors(c: Chunk, ch: number): void {
    const bx = c.x << 4, bz = c.z << 4;
    const sides: [number, number, number, number][] = [
      // neighbor chunk dx, dz, border local coordinate on the neighbor side, axis (0 = x varies along z border)
      [-1, 0, 15, 0],
      [1, 0, 0, 0],
      [0, -1, 15, 1],
      [0, 1, 0, 1],
    ];
    for (const [dx, dz, border, axis] of sides) {
      const n = this.world.getChunk(c.x + dx, c.z + dz);
      if (!n || !n.lit) continue;
      for (let s = 0; s < 16; s++) {
        const sec = n.sections[s]!;
        if (!sec.light && (ch === SKY ? sec.uniformLight >> 4 : sec.uniformLight & 15) <= 1) continue;
        for (let ly = 0; ly < 16; ly++)
          for (let k = 0; k < 16; k++) {
            const lx = axis === 0 ? border : k;
            const lz = axis === 0 ? k : border;
            const packed = sec.getLight(sectionIndex(lx, ly, lz));
            const l = ch === SKY ? packed >> 4 : packed & 15;
            if (l > 1) this.add.push(bx + dx * 16 + lx, (s << 4) | ly, bz + dz * 16 + lz, l);
          }
      }
    }
  }
}
