/**
 * Client-side mirror of the server world: chunk storage plus change notifications for
 * the renderer.
 */
import { BlockWorld } from '@shared/world/world';
import { Chunk } from '@shared/world/chunk';

export class ClientWorld extends BlockWorld {
  gameTime = 0;
  dayTime = 0;
  doDaylightCycle = true;
  rain = 0;
  thunder = 0;
  /** Called with (cx, sy, cz) when a section needs re-meshing. */
  onSectionDirty: ((cx: number, sy: number, cz: number) => void) | null = null;
  onChunkLoaded: ((c: Chunk) => void) | null = null;
  onChunkUnloaded: ((cx: number, cz: number) => void) | null = null;

  loadChunk(c: Chunk): void {
    this.addChunk(c);
    this.onChunkLoaded?.(c);
  }

  unloadChunk(cx: number, cz: number): void {
    if (this.removeChunk(cx, cz)) this.onChunkUnloaded?.(cx, cz);
  }

  /** Mark the section containing a block, plus neighbours touching it, dirty. */
  markBlockDirty(x: number, y: number, z: number): void {
    const cx = x >> 4, cz = z >> 4, sy = y >> 4;
    const d = this.onSectionDirty;
    if (!d) return;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++) {
          const nx = (x + dx) >> 4, nz = (z + dz) >> 4, ny = (y + dy) >> 4;
          if (ny < 0 || ny > 15) continue;
          if (nx === cx && nz === cz && ny === sy && (dx || dy || dz)) continue;
          d(nx, ny, nz);
        }
    d(cx, sy, cz);
  }
}
