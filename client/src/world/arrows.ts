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
