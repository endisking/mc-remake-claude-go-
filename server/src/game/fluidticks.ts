/**
 * The liquid tick list (vanilla ServerTickList<Fluid> for level.getLiquidTicks()): ticks keyed by
 * position + fluid type (a duplicate schedule is ignored), run in trigger-time then insertion
 * order, at most 65536 per game tick, and only in ticking chunks (others wait, as vanilla's stay
 * in the set until their chunk ticks again).
 */
import { chunkKey } from '@shared/world/chunk';
import { tickFluid, onBlockChanged, fluidTickType, type FluidLevel } from '@shared/game/fluids';

interface Tick {
  x: number;
  y: number;
  z: number;
  type: number;
  key: string;
}

export interface FluidHost {
  getState(x: number, y: number, z: number): number;
  /** setBlock with neighbour updates (flag 3); must call FluidTicks.blockChanged. */
  setBlock(x: number, y: number, z: number, state: number): void;
  dropResources(x: number, y: number, z: number, state: number): void;
  fizz(x: number, y: number, z: number): void;
  nextInt(bound: number): number;
  isTickingChunk(cx: number, cz: number): boolean;
  now(): number;
}

const MAX_PER_TICK = 65536;

export class FluidTicks implements FluidLevel {
  /** trigger game time → ticks in insertion order */
  private readonly buckets = new Map<number, Tick[]>();
  private readonly scheduled = new Set<string>();
  /** due ticks whose chunk isn't ticking, by chunk */
  private readonly waiting = new Map<number, Tick[]>();
  ultraWarm = false;

  constructor(private readonly host: FluidHost) {}

  get size(): number {
    return this.scheduled.size;
  }

  getState(x: number, y: number, z: number): number {
    return this.host.getState(x, y, z);
  }
  setBlock(x: number, y: number, z: number, state: number): void {
    this.host.setBlock(x, y, z, state);
  }
  dropResources(x: number, y: number, z: number, state: number): void {
    this.host.dropResources(x, y, z, state);
  }
  fizz(x: number, y: number, z: number): void {
    this.host.fizz(x, y, z);
  }
  nextInt(bound: number): number {
    return this.host.nextInt(bound);
  }

  /** TickList.scheduleTick(pos, fluid, delay). */
  scheduleTick(x: number, y: number, z: number, type: number, delay: number): void {
    if (type === 0 || y < 0 || y > 255) return;
    const key = `${x},${y},${z},${type}`;
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const at = this.host.now() + delay;
    let b = this.buckets.get(at);
    if (!b) this.buckets.set(at, (b = []));
    b.push({ x, y, z, type, key });
  }

  /** Schedule a tick for whatever fluid is at a position now (worldgen springs: delay 0). */
  scheduleFluidAt(x: number, y: number, z: number, delay = 0): void {
    this.scheduleTick(x, y, z, fluidTickType(this.host.getState(x, y, z)), delay);
  }

  /** Hook for every block change (after the write). */
  blockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    onBlockChanged(this, x, y, z, oldState, newState);
  }

  /** ServerTickList.tick for the current game time. */
  tick(): void {
    const now = this.host.now();
    const due: Tick[] = [];
    // ticks waiting on chunks that have started ticking again come first (they are older)
    if (this.waiting.size) {
      for (const [ck, list] of this.waiting) {
        const t = list[0]!;
        if (!this.host.isTickingChunk(t.x >> 4, t.z >> 4)) continue;
        this.waiting.delete(ck);
        for (const w of list) due.push(w);
      }
    }
    if (this.buckets.size) {
      const times = [...this.buckets.keys()].filter((t) => t <= now).sort((a, b) => a - b);
      for (const t of times) {
        const list = this.buckets.get(t)!;
        this.buckets.delete(t);
        for (const tk of list) {
          if (this.host.isTickingChunk(tk.x >> 4, tk.z >> 4)) due.push(tk);
          else {
            const ck = chunkKey(tk.x >> 4, tk.z >> 4);
            let w = this.waiting.get(ck);
            if (!w) this.waiting.set(ck, (w = []));
            w.push(tk);
          }
        }
      }
    }
    // over the per-tick cap: the rest runs next tick, ahead of anything newer
    if (due.length > MAX_PER_TICK) {
      const rest = due.splice(MAX_PER_TICK);
      const b = this.buckets.get(now) ?? [];
      this.buckets.set(now, [...rest, ...b]);
    }
    for (const tk of due) this.scheduled.delete(tk.key);
    for (const tk of due) tickFluid(this, tk.x, tk.y, tk.z, tk.type);
  }
}
