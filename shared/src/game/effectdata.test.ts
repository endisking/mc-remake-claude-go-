import { describe, it, expect } from 'vitest';
import { MOB_EFFECTS, effectByName, effectsColor, formatDuration, modifierValue } from './effectdata';
import { EFFECTS } from '../data';
import { EFFECT_ID } from './effects';

describe('status effect data', () => {
  it('matches minecraft-data ids and the EffectMap registry names', () => {
    expect(MOB_EFFECTS.length).toBe(EFFECTS.length);
    for (const e of MOB_EFFECTS) expect(EFFECT_ID[e.name]).toBe(e.id);
  });

  it('attribute modifiers scale with the level', () => {
    expect(modifierValue(effectByName('speed').mods[0]!, 1)).toBeCloseTo(0.4, 9);
    expect(modifierValue(effectByName('weakness').mods[0]!, 0)).toBe(-4);
    expect(modifierValue(effectByName('health_boost').mods[0]!, 2)).toBe(12);
  });

  it('particle colour mixes visible effects weighted by level (PotionUtils.getColor)', () => {
    expect(effectsColor([])).toBe(3694022);
    expect(effectsColor([{ effect: effectByName('speed'), amplifier: 0, visible: true }])).toBe(8171462);
    const mix = effectsColor([
      { effect: effectByName('poison'), amplifier: 0, visible: true },
      { effect: effectByName('regeneration'), amplifier: 1, visible: true },
    ]);
    const ch = (x: number, s: number) => (x >> s) & 255;
    const P = 5149489, R = 13458603;
    expect(ch(mix, 16)).toBe(Math.trunc(((ch(P, 16) / 255 + (2 * ch(R, 16)) / 255) / 3) * 255));
    expect(effectsColor([{ effect: effectByName('speed'), amplifier: 0, visible: false }])).toBe(0);
  });

  it('formats durations', () => {
    expect(formatDuration({ duration: 3600 })).toBe('3:00');
    expect(formatDuration({ duration: 190 })).toBe('0:09');
    expect(formatDuration({ duration: 40000 })).toBe('**:**');
  });
});
