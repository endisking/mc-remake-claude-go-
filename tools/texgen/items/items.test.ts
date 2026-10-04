import { describe, expect, it } from 'vitest';
import { ITEMS, BLOCKS_BY_NAME } from '@shared/data';
import { ALL_ITEM_TEXTURES } from './index';

const byName = new Map(ALL_ITEM_TEXTURES.map((d) => [d.name, d]));

/** Items without a flat sprite in vanilla 1.17.1 either (drawn as 3D/builtin models or by animation frames). */
const NO_SPRITE = new Set(['air', 'compass', 'clock']);

describe('item sprites', () => {
  it('cover every non-block item of 1.17.1', () => {
    const missing = ITEMS.filter((it) => !BLOCKS_BY_NAME.has(it.name) && !NO_SPRITE.has(it.name) && !byName.has(it.name)).map((it) => it.name);
    expect(missing).toEqual([]);
  });

  it('have compass (32) and clock (64) angle frames', () => {
    for (let i = 0; i < 32; i++) expect(byName.has(`compass_${String(i).padStart(2, '0')}`)).toBe(true);
    for (let i = 0; i < 64; i++) expect(byName.has(`clock_${String(i).padStart(2, '0')}`)).toBe(true);
  });

  it('are 16×16, binary alpha, non-empty and deterministic', { timeout: 60000 }, () => {
    const bad: string[] = [];
    for (const d of ALL_ITEM_TEXTURES) {
      const a = d.make(), b = d.make();
      if (a.w !== 16 || a.h !== 16) bad.push(`${d.name}: size`);
      if (!Buffer.from(a.data).equals(Buffer.from(b.data))) bad.push(`${d.name}: not deterministic`);
      let opaque = 0;
      for (let i = 3; i < a.data.length; i += 4) {
        if (a.data[i] !== 0 && a.data[i] !== 255) bad.push(`${d.name}: partial alpha`);
        if (a.data[i]) opaque++;
      }
      if (opaque <= 8) bad.push(`${d.name}: empty`);
    }
    expect(bad).toEqual([]);
  });

  it('mark tools and sticks as handheld', () => {
    for (const n of ['wooden_pickaxe', 'netherite_sword', 'diamond_axe', 'stick', 'blaze_rod']) expect(byName.get(n)?.handheld, n).toBeTruthy();
    expect(byName.get('fishing_rod')?.handheld).toBe('rod');
    expect(byName.get('apple')?.handheld).toBeFalsy();
  });
});
