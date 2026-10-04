import { describe, it, expect } from 'vitest';
import { BossOverlay } from './bossbar';

describe('boss bar overlay', () => {
  it('adds, updates (keeping the name) and removes bars by id', () => {
    const o = new BossOverlay();
    o.handle({ op: 0, id: 5, name: 'Ender Dragon', progress: 1, color: 0 });
    expect(o.bars.get(5)).toEqual({ name: 'Ender Dragon', progress: 1, color: 0 });
    o.handle({ op: 2, id: 5, name: '', progress: 0.5, color: 0 });
    expect(o.bars.get(5)!.name).toBe('Ender Dragon');
    expect(o.bars.get(5)!.progress).toBe(0.5);
    o.handle({ op: 1, id: 5, name: '', progress: 0, color: 0 });
    expect(o.bars.size).toBe(0);
  });
});
