/**
 * Client arrows: position/rotation interpolation of server arrow entities and a minimal
 * line-drawn model (shaft + fletching), until a textured ArrowRenderer exists.
 */
import type { S2C } from '@shared/protocol/packets';
import type { LineRenderer } from '../render/lines';

interface ClientArrow {
  x: number; y: number; z: number;
  xo: number; yo: number; zo: number;
  lx: number; ly: number; lz: number;
  yaw: number; pitch: number;
  steps: number;
}

export class ClientArrows {
  readonly arrows = new Map<number, ClientArrow>();

  /** Returns true when the packet belonged to an arrow. */
  handle(p: S2C): boolean {
    switch (p.t) {
      case 'addEntity': {
        if (p.type !== 'arrow') return false;
        const h = Math.hypot(p.vx, p.vz);
        this.arrows.set(p.id, {
          x: p.x, y: p.y, z: p.z, xo: p.x, yo: p.y, zo: p.z, lx: p.x, ly: p.y, lz: p.z,
          yaw: (Math.atan2(p.vx, p.vz) * 180) / Math.PI, pitch: (Math.atan2(p.vy, h) * 180) / Math.PI, steps: 0,
        });
        return true;
      }
      case 'entityMove': {
        const a = this.arrows.get(p.id);
        if (!a) return false;
        a.lx = p.x;
        a.ly = p.y;
        a.lz = p.z;
        a.yaw = p.yaw;
        a.pitch = p.pitch;
        a.steps = 1;
        return true;
      }
      case 'removeEntities':
        for (const id of p.ids) this.arrows.delete(id);
        return false;
    }
    return false;
  }

  tick(): void {
    for (const a of this.arrows.values()) {
      a.xo = a.x;
      a.yo = a.y;
      a.zo = a.z;
      if (a.steps > 0) {
        a.x += (a.lx - a.x) / a.steps;
        a.y += (a.ly - a.y) / a.steps;
        a.z += (a.lz - a.z) / a.steps;
        a.steps--;
      }
    }
  }

  /**
   * Model matrices (camera-relative, column-major) that lay the diagonal arrow item sprite
   * along each arrow's flight direction. `out` receives [matrix, blockX, blockY, blockZ].
   */
  matrices(cx: number, cy: number, cz: number, partial: number, scale: number, fn: (m: Float32Array, x: number, y: number, z: number) => void): void {
    const D = Math.PI / 180, m = this.mat;
    for (const a of this.arrows.values()) {
      const x = a.xo + (a.x - a.xo) * partial, y = a.yo + (a.y - a.yo) * partial, z = a.zo + (a.z - a.zo) * partial;
      const fx = Math.sin(a.yaw * D) * Math.cos(a.pitch * D), fy = Math.sin(a.pitch * D), fz = Math.cos(a.yaw * D) * Math.cos(a.pitch * D);
      // u: world up made perpendicular to the flight direction
      let ux = -fy * fx, uy = 1 - fy * fy, uz = -fy * fz;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-4) {
        ux = 1; uy = 0; uz = 0; ul = 1;
      }
      ux /= ul; uy /= ul; uz /= ul;
      // sprite diagonal (1,1) → forward, (−1,1) → u
      const k = scale / Math.SQRT2;
      const Xx = (fx - ux) * k, Xy = (fy - uy) * k, Xz = (fz - uz) * k;
      const Yx = (fx + ux) * k, Yy = (fy + uy) * k, Yz = (fz + uz) * k;
      const Zx = (fy * uz - fz * uy) * scale, Zy = (fz * ux - fx * uz) * scale, Zz = (fx * uy - fy * ux) * scale;
      m.set([Xx, Xy, Xz, 0, Yx, Yy, Yz, 0, Zx, Zy, Zz, 0, x - cx, y + 0.1 - cy, z - cz, 1]);
      fn(m, Math.floor(x), Math.floor(y), Math.floor(z));
    }
  }
  private readonly mat = new Float32Array(16);

  /** Draw every arrow as a 0.5-block shaft with a pale tail (camera-relative). */
  render(L: LineRenderer, cx: number, cy: number, cz: number, partial: number): boolean {
    if (!this.arrows.size) return false;
    L.begin();
    const D = Math.PI / 180;
    for (const a of this.arrows.values()) {
      const x = a.xo + (a.x - a.xo) * partial - cx, y = a.yo + (a.y - a.yo) * partial - cy, z = a.zo + (a.z - a.zo) * partial - cz;
      const dx = Math.sin(a.yaw * D) * Math.cos(a.pitch * D), dy = Math.sin(a.pitch * D), dz = Math.cos(a.yaw * D) * Math.cos(a.pitch * D);
      L.line(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, x - dx * 0.15, y - dy * 0.15, z - dz * 0.15, 0.36, 0.25, 0.14, 1);
      L.line(x - dx * 0.15, y - dy * 0.15, z - dz * 0.15, x - dx * 0.25, y - dy * 0.25, z - dz * 0.25, 0.92, 0.92, 0.9, 1);
    }
    return true;
  }
}
