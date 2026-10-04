/** Vanilla GoalSelector / Goal / WrappedGoal (1.17.1): priorities, control flags, interruption. */

export const enum Flag {
  MOVE = 1,
  LOOK = 2,
  JUMP = 4,
  TARGET = 8,
}

export abstract class Goal {
  flags = 0;
  abstract canUse(): boolean;
  canContinueToUse(): boolean {
    return this.canUse();
  }
  isInterruptable(): boolean {
    return true;
  }
  start(): void {}
  stop(): void {}
  tick(): void {}
}

class Wrapped {
  running = false;
  constructor(readonly priority: number, readonly goal: Goal) {}
  canBeReplacedBy(o: Wrapped): boolean {
    return this.goal.isInterruptable() && o.priority < this.priority;
  }
}

const FLAGS = [Flag.MOVE, Flag.LOOK, Flag.JUMP, Flag.TARGET];
const NO_GOAL = new Wrapped(Infinity, new (class extends Goal {
  canUse(): boolean {
    return false;
  }
})());

export class GoalSelector {
  private readonly goals: Wrapped[] = [];
  private readonly locked = new Map<Flag, Wrapped>();
  disabledFlags = 0;

  add(priority: number, goal: Goal): void {
    this.goals.push(new Wrapped(priority, goal));
  }

  remove(goal: Goal): void {
    const i = this.goals.findIndex((w) => w.goal === goal);
    if (i < 0) return;
    const w = this.goals[i]!;
    if (w.running) {
      w.running = false;
      w.goal.stop();
    }
    this.goals.splice(i, 1);
  }

  running(): Goal[] {
    return this.goals.filter((w) => w.running).map((w) => w.goal);
  }

  isRunning(goal: Goal): boolean {
    return this.goals.some((w) => w.goal === goal && w.running);
  }

  tick(): void {
    // cleanup: stop goals that can't continue or whose flags got disabled
    for (const w of this.goals) {
      if (w.running && ((w.goal.flags & this.disabledFlags) !== 0 || !w.goal.canContinueToUse())) {
        w.running = false;
        w.goal.stop();
      }
    }
    for (const [f, w] of this.locked) if (!w.running) this.locked.delete(f);
    // update: start usable goals whose flags are free or held by lower-priority interruptable goals
    for (const w of this.goals) {
      if (w.running || (w.goal.flags & this.disabledFlags) !== 0) continue;
      let ok = true;
      for (const f of FLAGS) if ((w.goal.flags & f) !== 0 && !(this.locked.get(f) ?? NO_GOAL).canBeReplacedBy(w)) ok = false;
      if (!ok || !w.goal.canUse()) continue;
      for (const f of FLAGS) {
        if ((w.goal.flags & f) === 0) continue;
        const prev = this.locked.get(f);
        if (prev && prev.running) {
          prev.running = false;
          prev.goal.stop();
        }
        this.locked.set(f, w);
      }
      w.running = true;
      w.goal.start();
    }
    for (const w of this.goals) if (w.running) w.goal.tick();
  }
}
