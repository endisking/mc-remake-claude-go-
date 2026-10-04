/**
 * Scheduled ticks (vanilla 1.17.1 ServerTickList), generic over the tick type: blocks use the block
 * id, fluids can use their own scheduler instance with the fluid id.
 *
 * - schedule(pos, type, delay, priority) is ignored while the same (pos, type) is already pending
 *   (TickNextTickData equality is position + type).
 * - Ticks run in TickNextTickData.createTimeComparator order: trigger tick, then priority
 *   (TickPriority: −3 extremely high … 3 extremely low), then scheduling order.
 * - At most 65536 ticks run per game tick; ticks whose position is not in a ticking chunk stay
 *   pending (vanilla leaves them in the list; one taken but then unloaded is rescheduled with delay 0).
 */

export const TickPriority = {
  EXTREMELY_HIGH: -3,
  VERY_HIGH: -2,
  HIGH: -1,
  NORMAL: 0,
  LOW: 1,
  VERY_LOW: 2,
  EXTREMELY_LOW: 3,
} as const;

export interface ScheduledTick<T> {
  x: number;
  y: number;
  z: number;
  type: T;
  /** game time it fires at */
  time: number;
  priority: number;
  /** scheduling order (tie-breaker) */
  seq: number;
}

const MAX_TICKS_PER_TICK = 65536;

function before<T>(a: ScheduledTick<T>, b: ScheduledTick<T>): boolean {
  if (a.time !== b.time) return a.time < b.time;
  if (a.priority !== b.priority) return a.priority < b.priority;
  return a.seq < b.seq;
}

export class TickScheduler<T extends string | number> {
  private heap: ScheduledTick<T>[] = [];
  private readonly pending = new Map<string, ScheduledTick<T>>();
  private seq = 0;

  private static key(x: number, y: number, z: number, type: string | number): string {
    return `${x},${y},${z},${type}`;
  }

  get size(): number {
    return this.pending.size;
  }

  /** LevelTickAccess.scheduleTick(pos, type, delay, priority) relative to `gameTime`. */
  schedule(gameTime: number, x: number, y: number, z: number, type: T, delay: number, priority = 0): void {
    const k = TickScheduler.key(x, y, z, type);
    if (this.pending.has(k)) return;
    const t: ScheduledTick<T> = { x, y, z, type, time: gameTime + delay, priority, seq: this.seq++ };
    this.pending.set(k, t);
    this.push(t);
  }

  /** ServerTickList.hasScheduledTick */
  has(x: number, y: number, z: number, type: T): boolean {
    return this.pending.has(TickScheduler.key(x, y, z, type));
  }

  /** ServerTickList.willTickThisTick: pending and due by `gameTime`. */
  willTickThisTick(gameTime: number, x: number, y: number, z: number, type: T): boolean {
    const t = this.pending.get(TickScheduler.key(x, y, z, type));
    return !!t && t.time <= gameTime;
  }

  /**
   * Run every due tick (time ≤ gameTime) in order. `ticking(x, z)` says whether the position's
   * chunk is ticking; `run` executes one tick (it may schedule more, which wait for a later time).
   */
  tick(gameTime: number, ticking: (x: number, z: number) => boolean, run: (t: ScheduledTick<T>) => void): void {
    const due: ScheduledTick<T>[] = [];
    const skipped: ScheduledTick<T>[] = [];
    let budget = MAX_TICKS_PER_TICK;
    while (budget > 0 && this.heap.length && this.heap[0]!.time <= gameTime) {
      const t = this.pop();
      if (!ticking(t.x, t.z)) {
        skipped.push(t);
        continue;
      }
      this.pending.delete(TickScheduler.key(t.x, t.y, t.z, t.type));
      due.push(t);
      budget--;
    }
    for (const t of skipped) this.push(t);
    for (const t of due) {
      if (ticking(t.x, t.z)) run(t);
      else this.schedule(gameTime, t.x, t.y, t.z, t.type, 0, t.priority);
    }
  }

  /** All pending ticks (for saving), in firing order. */
  list(): ScheduledTick<T>[] {
    return [...this.pending.values()].sort((a, b) => (before(a, b) ? -1 : 1));
  }

  clear(): void {
    this.heap = [];
    this.pending.clear();
  }

  // binary heap ------------------------------------------------------------
  private push(t: ScheduledTick<T>): void {
    const h = this.heap;
    h.push(t);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private pop(): ScheduledTick<T> {
    const h = this.heap;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && before(h[l]!, h[m]!)) m = l;
        if (r < h.length && before(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}
