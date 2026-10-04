/**
 * Client falling block entities (vanilla FallingBlockRenderer): the block model drawn at the
 * entity position (centred in x/z, bottom at y), following the server's position updates.
 */
import { mat4, type Mat4 } from '../render/math';
import type { BlockItemRenderer } from '../render/blockitem';
import type { BlockWorld } from '@shared/world/world';

interface Falling {
  state: number;
  x: number;
  y: number;
  z: number;
  xo: number;
  yo: number;
  zo: number;
  lx: number;
  ly: number;
  lz: number;
  steps: number;
}

export class FallingBlocks {
  readonly list = new Map<number, Falling>();
  private readonly m = mat4();

  add(id: number, state: number, x: number, y: number, z: number): void {
    this.list.set(id, { state, x, y, z, xo: x, yo: y, zo: z, lx: x, ly: y, lz: z, steps: 0 });
  }

  move(id: number, x: number, y: number, z: number): void {
    const f = this.list.get(id);
    if (!f) return;
    f.lx = x;
    f.ly = y;
    f.lz = z;
    f.steps = 1;
  }

  remove(id: number): void {
    this.list.delete(id);
  }

  tick(): void {
    for (const f of this.list.values()) {
      f.xo = f.x;
      f.yo = f.y;
      f.zo = f.z;
      if (f.steps > 0) {
        f.x += (f.lx - f.x) / f.steps;
        f.y += (f.ly - f.y) / f.steps;
        f.z += (f.lz - f.z) / f.steps;
        f.steps--;
      }
    }
  }

  render(
    blocks: BlockItemRenderer, world: BlockWorld, viewProj: Mat4, cx: number, cy: number, cz: number, partial: number,
    lightmap: WebGLTexture, fog: { color: [number, number, number]; start: number; end: number },
  ): void {
    const m = this.m;
    for (const f of this.list.values()) {
      const x = f.xo + (f.x - f.xo) * partial, y = f.yo + (f.y - f.yo) * partial, z = f.zo + (f.z - f.zo) * partial;
      // the renderer skips a falling block when the same block already stands at its position
      if (world.getState(Math.floor(x), Math.floor(y), Math.floor(z)) === f.state) continue;
      m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x - cx, y - cy + 0.5, z - cz, 1]);
      const light = world.getLight(Math.floor(x), Math.floor(y + 0.5), Math.floor(z));
      blocks.draw(f.state, viewProj, m, light, lightmap, fog);
    }
  }
}
