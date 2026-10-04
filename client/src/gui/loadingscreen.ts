/**
 * "Loading terrain…" (vanilla ReceivingLevelScreen + LevelLoadingScreen): a dirt background,
 * the progress percentage and the chunk progress grid, shown after joining until the chunks
 * around the player have arrived and been meshed, so the player never falls into a void.
 */
import { Screen } from './screen';
import type { Gui } from './gui';

/** LevelLoadingScreen.COLORS for the chunk states we can observe on the client. */
export const LOADING_COLORS = {
  empty: 0x545454,
  /** received from the server (generated, decorated and lit), not drawn yet */
  received: 0x21c600,
  /** meshed: ready to draw (ChunkStatus.FULL) */
  full: 0xffffff,
} as const;

export interface LoadingHost {
  gui: Gui;
  /** player chunk position */
  center(): [number, number];
  received(cx: number, cz: number): boolean;
  meshed(cx: number, cz: number): boolean;
  renderDistance: number;
}

/** Chunks that must be received / meshed around the player before play starts. */
export const READY_RECEIVED_RADIUS = 2;
export const READY_MESHED_RADIUS = 1;

/** Progress 0..1 toward ready: half for the received radius, half for the meshed radius. */
export function loadingProgress(h: Pick<LoadingHost, 'center' | 'received' | 'meshed'>): number {
  const [pcx, pcz] = h.center();
  let rec = 0, recN = 0, mesh = 0, meshN = 0;
  for (let dx = -READY_RECEIVED_RADIUS; dx <= READY_RECEIVED_RADIUS; dx++)
    for (let dz = -READY_RECEIVED_RADIUS; dz <= READY_RECEIVED_RADIUS; dz++) {
      recN++;
      if (h.received(pcx + dx, pcz + dz)) rec++;
      if (Math.abs(dx) <= READY_MESHED_RADIUS && Math.abs(dz) <= READY_MESHED_RADIUS) {
        meshN++;
        if (h.meshed(pcx + dx, pcz + dz)) mesh++;
      }
    }
  return (rec / recN) * 0.5 + (mesh / meshN) * 0.5;
}

export class LoadingTerrainScreen extends Screen {
  private done = false;
  /** ticks shown, so the screen doesn't flash for a frame on fast machines */
  private ticks = 0;

  constructor(private host: LoadingHost, private onReady: () => void) {
    super(host.gui, 'Loading terrain...');
    this.pausesGame = false;
  }

  init(): void {
    this.widgets = [];
  }

  override renderBackground(): void {
    this.gui.dirtBackground();
  }

  override tick(): void {
    this.ticks++;
    if (!this.done && this.ticks >= 2 && loadingProgress(this.host) >= 1) {
      this.done = true;
      this.onReady();
    }
  }

  override render(): void {
    const g = this.gui;
    this.renderBackground();
    const pct = Math.floor(loadingProgress(this.host) * 100);
    const cx = Math.floor(g.width / 2), cy = Math.floor(g.height / 2);
    g.centeredText(this.title, cx, cy - 9 / 2 - 50, 0xffffff);
    g.centeredText(`${Math.min(100, pct)}%`, cx, cy - 9 / 2 - 30, 0xffffff);
    // LevelLoadingScreen.renderChunks: 2px per chunk with a 0px gap, centred below the text
    const r = Math.max(READY_RECEIVED_RADIUS, Math.min(this.host.renderDistance + 1, 16));
    const size = 2, d = r * 2 + 1, w = d * size;
    const x0 = cx - Math.floor(w / 2), y0 = cy + 30 - Math.floor(w / 2);
    const [pcx, pcz] = this.host.center();
    g.fill(x0 - 1, y0 - 1, w + 2, w + 2, 0xff000000 | 0x000000);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = pcx + dx, z = pcz + dz;
        const col = this.host.meshed(x, z) ? LOADING_COLORS.full : this.host.received(x, z) ? LOADING_COLORS.received : LOADING_COLORS.empty;
        g.fill(x0 + (dx + r) * size, y0 + (dz + r) * size, size, size, 0xff000000 | col);
      }
  }

  // Escape doesn't close it (vanilla shouldCloseOnEsc false)
  override keyDown(): boolean {
    return true;
  }
}
