import { describe, it, expect } from 'vitest';
import { SOUND_TYPES, soundTypeNameOf } from './soundtype';
import { SOUND_EVENTS } from '../data';

describe('block sound types', () => {
  it('every event is a vanilla 1.17.1 sound event', () => {
    const names = new Set(SOUND_EVENTS.map((e) => e.name));
    const missing: string[] = [];
    for (const t of Object.values(SOUND_TYPES)) for (const e of [t.break, t.step, t.place, t.hit, t.fall]) if (!names.has(e)) missing.push(e);
    expect([...new Set(missing)]).toEqual([]);
  });
  it('assigns vanilla groups', () => {
    expect(soundTypeNameOf('oak_planks')).toBe('wood');
    expect(soundTypeNameOf('dirt')).toBe('gravel');
    expect(soundTypeNameOf('grass_block')).toBe('grass');
    expect(soundTypeNameOf('white_wool')).toBe('wool');
    expect(soundTypeNameOf('glass_pane')).toBe('glass');
    expect(soundTypeNameOf('iron_block')).toBe('metal');
    expect(soundTypeNameOf('crimson_stem')).toBe('stem');
    expect(soundTypeNameOf('crimson_planks')).toBe('wood');
    expect(soundTypeNameOf('stone_bricks')).toBe('stone');
    expect(soundTypeNameOf('cobbled_deepslate')).toBe('deepslate');
  });
});
