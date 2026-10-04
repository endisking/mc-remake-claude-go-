import { describe, it, expect } from 'vitest';
import { ActiveEffects, EffectInstance, effectByName, isDurationEffectTick, applyEffectTick, effectsColor, resistanceReduce, nightVisionScale, formatDuration, MOB_EFFECTS, type EffectTarget } from './effects';
import { EFFECTS } from '../data';

function target(health = 10, max = 20) {
  const log: string[] = [];
  const t: EffectTarget & { h: number; log: string[]; exhaustion: number } = {
    h: health, log, exhaustion: 0,
    get health() { return this.h; },
    maxHealth: max,
    heal(a) { this.h = Math.min(this.maxHealth, this.h + a); log.push(`heal ${a}`); },
    hurt(src, a) { this.h -= a; log.push(`${src} ${a}`); },
    causeFoodExhaustion(a) { this.exhaustion += a; },
  };
  return t;
}

function run(name: string, duration: number, amp: number, t = target()) {
  const fx = new ActiveEffects();
  fx.add(new EffectInstance(effectByName(name), duration, amp));
  for (let i = 0; i < duration + 5; i++) fx.tick((inst) => applyEffectTick(t, inst));
  return { t, fx };
}

describe('status effects', () => {
  it('matches minecraft-data ids and names', () => {
    expect(MOB_EFFECTS.length).toBe(EFFECTS.length);
    for (const e of EFFECTS) {
      const m = MOB_EFFECTS.find((x) => x.id === e.id)!;
      expect(m.displayName.replace(/'/g, '').replace(/ /g, '')).toBe(e.displayName.replace(/'/g, '').replace(/ /g, ''));
    }
  });

  it('regeneration/poison/wither intervals are 50>>amp, 25>>amp, 40>>amp', () => {
    const regen = effectByName('regeneration'), poison = effectByName('poison'), wither = effectByName('wither');
    expect(isDurationEffectTick(regen, 100, 0)).toBe(true);
    expect(isDurationEffectTick(regen, 99, 0)).toBe(false);
    expect(isDurationEffectTick(regen, 25, 1)).toBe(true);
    expect(isDurationEffectTick(regen, 7, 5)).toBe(true); // 50>>5 = 1
    expect(isDurationEffectTick(regen, 7, 6)).toBe(true); // 50>>6 = 0: every tick
    expect(isDurationEffectTick(poison, 25, 0)).toBe(true);
    expect(isDurationEffectTick(poison, 24, 0)).toBe(false);
    expect(isDurationEffectTick(wither, 40, 0)).toBe(true);
    expect(isDurationEffectTick(wither, 20, 1)).toBe(true);
  });

  it('regeneration I heals 1 every 50 ticks', () => {
    const { t } = run('regeneration', 200, 0, target(5));
    expect(t.log.filter((l) => l.startsWith('heal')).length).toBe(4);
  });

  it('poison never kills (stops at 1 health)', () => {
    const { t } = run('poison', 2000, 1, target(10));
    expect(t.h).toBe(1);
    expect(t.log.every((l) => l === 'magic 1')).toBe(true);
  });

  it('wither II hits every 20 ticks', () => {
    const { t } = run('wither', 100, 1, target(20));
    expect(t.log.filter((l) => l === 'wither 1').length).toBe(5);
  });

  it('instant health/damage', () => {
    const t = target(5);
    applyEffectTick(t, new EffectInstance(effectByName('instant_health'), 1, 1));
    expect(t.h).toBe(13);
    applyEffectTick(t, new EffectInstance(effectByName('instant_damage'), 1, 0));
    expect(t.h).toBe(7);
    const undead = { ...target(5), undead: true } as EffectTarget & { h: number };
    applyEffectTick(undead, new EffectInstance(effectByName('instant_health'), 1, 0));
    expect(undead.h).toBe(-1);
  });

  it('hunger exhaustion 0.005·(amp+1) per tick', () => {
    const { t } = run('hunger', 600, 2);
    expect(t.exhaustion).toBeCloseTo(600 * 0.015, 6);
  });

  it('a stronger shorter effect hides the weaker longer one, which resumes', () => {
    const fx = new ActiveEffects();
    fx.add(new EffectInstance(effectByName('speed'), 1000, 0));
    expect(fx.add(new EffectInstance(effectByName('speed'), 100, 1))).toBe(true);
    expect(fx.get('speed')!.amplifier).toBe(1);
    for (let i = 0; i < 100; i++) fx.tick(() => {});
    const s = fx.get('speed')!;
    expect(s.amplifier).toBe(0);
    expect(s.duration).toBe(900);
  });

  it('a weaker effect does not replace a stronger one; same level extends', () => {
    const fx = new ActiveEffects();
    fx.add(new EffectInstance(effectByName('strength'), 100, 1));
    expect(fx.add(new EffectInstance(effectByName('strength'), 50, 0))).toBe(false);
    expect(fx.add(new EffectInstance(effectByName('strength'), 200, 1))).toBe(true);
    expect(fx.get('strength')!.duration).toBe(200);
  });

  it('effects run out and are removed', () => {
    const { fx } = run('speed', 20, 0);
    expect(fx.size).toBe(0);
  });

  it('attribute modifiers: speed +20%/level, slowness −15%/level, strength +3, weakness −4, health boost +4', () => {
    const fx = new ActiveEffects();
    fx.add(new EffectInstance(effectByName('speed'), 100, 1));
    expect(fx.attributeValue('movement_speed', 0.1)).toBeCloseTo(0.14, 9);
    fx.add(new EffectInstance(effectByName('slowness'), 100, 0));
    expect(fx.attributeValue('movement_speed', 0.1)).toBeCloseTo(0.1 * 1.4 * 0.85, 9);
    fx.add(new EffectInstance(effectByName('strength'), 100, 1));
    fx.add(new EffectInstance(effectByName('weakness'), 100, 0));
    expect(fx.attributeValue('attack_damage', 1)).toBe(1 + 6 - 4);
    fx.add(new EffectInstance(effectByName('health_boost'), 100, 2));
    expect(fx.attributeValue('max_health', 20)).toBe(32);
  });

  it('particle colour mixes visible effects weighted by level (PotionUtils.getColor)', () => {
    expect(effectsColor([])).toBe(3694022);
    const c = effectsColor([{ effect: effectByName('speed'), amplifier: 0, visible: true }]);
    expect(c).toBe(8171462);
    const mix = effectsColor([
      { effect: effectByName('poison'), amplifier: 0, visible: true },
      { effect: effectByName('regeneration'), amplifier: 1, visible: true },
    ]);
    const ch = (x: number, s: number) => (x >> s) & 255;
    const P = 5149489, R = 13458603;
    expect(ch(mix, 16)).toBe(Math.trunc(((ch(P, 16) / 255 + 2 * ch(R, 16) / 255) / 3) * 255));
    expect(effectsColor([{ effect: effectByName('speed'), amplifier: 0, visible: false }])).toBe(0);
  });

  it('resistance reduces 20% per level and caps at 100%', () => {
    expect(resistanceReduce(10, -1)).toBe(10);
    expect(resistanceReduce(10, 0)).toBe(8);
    expect(resistanceReduce(10, 3)).toBeCloseTo(2, 9);
    expect(resistanceReduce(10, 4)).toBe(0);
    expect(resistanceReduce(10, 9)).toBe(0);
  });

  it('night vision flickers only in the last 200 ticks', () => {
    expect(nightVisionScale(201, 0)).toBe(1);
    expect(nightVisionScale(200, 0)).toBeCloseTo(0.7 + Math.sin(200 * Math.PI * 0.2) * 0.3, 9);
    expect(nightVisionScale(5, 0.5)).toBeLessThan(1);
  });

  it('formats durations', () => {
    expect(formatDuration({ duration: 3600 })).toBe('3:00');
    expect(formatDuration({ duration: 190 })).toBe('0:09');
    expect(formatDuration({ duration: 40000 })).toBe('**:**');
  });
});
