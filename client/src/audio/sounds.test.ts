/**
 * Sound asset coverage: every block state has a vanilla sound group whose events all have audio,
 * every event in sounds.json is a real 1.17.1 event with existing files (or an explicit silent
 * placeholder), and every sound event the game's code plays is registered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOUND_EVENTS, BLOCK_STATE_COUNT } from '@shared/data';
import { soundTypeOf, SOUND_TYPES } from '@shared/world/soundtype';
import { MOB_INFO } from '../world/mobs';

const root = new URL('../../../', import.meta.url).pathname;
const soundsDir = join(root, 'client/public/sounds');
type Manifest = Record<string, { sounds: { name: string; volume?: number; pitch?: number; stream?: boolean }[]; placeholder?: boolean }>;
const manifest = JSON.parse(readFileSync(join(soundsDir, 'sounds.json'), 'utf8')) as Manifest;
const valid = new Set(SOUND_EVENTS.map((e) => e.name));
const withAudio = (e: string) => (manifest[e]?.sounds.length ?? 0) > 0;

describe('sounds.json', () => {
  it('only registers vanilla 1.17.1 sound events', () => {
    expect(Object.keys(manifest).filter((e) => !valid.has(e))).toEqual([]);
  });

  it('every listed file exists and is a non-trivial ogg; empty events are explicit placeholders', () => {
    const missingFiles: string[] = [];
    const unmarked: string[] = [];
    for (const [ev, def] of Object.entries(manifest)) {
      if (def.sounds.length === 0 && !def.placeholder) unmarked.push(ev);
      if (def.sounds.length > 0 && def.placeholder) unmarked.push(`${ev} (placeholder with files)`);
      for (const s of def.sounds) {
        const f = join(soundsDir, `${s.name}.ogg`);
        if (!existsSync(f) || statSync(f).size < 500) missingFiles.push(`${ev}: ${s.name}`);
        if (s.pitch !== undefined) expect(s.pitch).toBeGreaterThan(0);
        if (s.volume !== undefined) expect(s.volume).toBeGreaterThan(0);
      }
    }
    expect(missingFiles).toEqual([]);
    expect(unmarked).toEqual([]);
  });

  it('every block state maps to a sound group whose five events all have audio', () => {
    const silent = new Set<string>();
    for (let st = 0; st < BLOCK_STATE_COUNT; st++) {
      const t = soundTypeOf(st);
      expect(t, `state ${st}`).toBeDefined();
      for (const e of [t.break, t.place, t.step, t.hit, t.fall]) if (!withAudio(e)) silent.add(e);
    }
    expect([...silent]).toEqual([]);
    for (const t of Object.values(SOUND_TYPES)) for (const e of [t.break, t.place, t.step, t.hit, t.fall]) expect(withAudio(e), e).toBe(true);
  });

  it('every sound event quoted in the game code is registered (audio or placeholder)', () => {
    const found = new Set<string>();
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.ts') && !f.name.endsWith('.test.ts')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/'((?:block|entity|item|ambient|weather|ui|music)\.[a-z0-9_.]+)'/g)) if (valid.has(m[1]!)) found.add(m[1]!);
        }
      }
    };
    for (const d of ['client/src', 'server/src', 'shared/src']) walk(join(root, d));
    expect([...found].filter((e) => !manifest[e])).toEqual([]);
  });

  it('core gameplay events have real recordings', () => {
    const core = [
      'entity.player.hurt', 'entity.player.death', 'entity.generic.eat', 'entity.player.burp', 'entity.generic.drink', 'entity.player.levelup',
      'entity.experience_orb.pickup', 'entity.player.attack.strong', 'entity.player.attack.weak', 'entity.player.attack.crit',
      'entity.player.attack.sweep', 'entity.player.attack.knockback', 'entity.player.attack.nodamage', 'entity.item.pickup',
      'entity.arrow.shoot', 'entity.arrow.hit', 'item.bucket.fill', 'item.bucket.empty', 'item.bucket.fill_lava', 'item.bucket.empty_lava',
      'block.water.ambient', 'block.lava.pop', 'block.lava.ambient', 'block.lava.extinguish', 'block.fire.ambient', 'block.fire.extinguish',
      'entity.generic.explode', 'block.wooden_door.open', 'block.wooden_door.close', 'block.wooden_trapdoor.open', 'block.fence_gate.open',
      'block.chest.open', 'block.chest.close', 'block.furnace.fire_crackle', 'ui.button.click', 'ambient.cave', 'weather.rain',
      'entity.lightning_bolt.thunder', 'ambient.underwater.loop', 'ambient.underwater.enter', 'ambient.underwater.exit',
      'music.game', 'music.creative', 'music.menu', 'music.under_water',
    ];
    for (const mob of ['zombie', 'skeleton', 'spider', 'pig', 'cow', 'sheep', 'chicken']) for (const k of ['ambient', 'hurt', 'death', 'step']) core.push(`entity.${mob}.${k}`);
    core.push('entity.creeper.hurt', 'entity.creeper.death', 'entity.creeper.primed', 'entity.tnt.primed');
    expect(core.filter((e) => !withAudio(e))).toEqual([]);
  });

  it('music and the underwater loop are streamed; every event has 1+ variants and block groups 2+', () => {
    for (const [ev, def] of Object.entries(manifest)) {
      if (ev.startsWith('music.') || ev === 'ambient.underwater.loop') expect(def.sounds.every((s) => s.stream), ev).toBe(true);
    }
    for (const t of Object.values(SOUND_TYPES)) expect(manifest[t.step]!.sounds.length, t.step).toBeGreaterThanOrEqual(2);
  });

  it('every client mob has audio for each of its vanilla ambient / hurt / death / step events', () => {
    const silent: string[] = [];
    for (const [type, info] of Object.entries(MOB_INFO)) {
      for (const k of ['ambient', 'hurt', 'death', 'step', 'hurt_small', 'death_small']) {
        const e = `entity.${type}.${k}`;
        if (k === 'step' && info.step === null) continue;
        if (valid.has(e) && !withAudio(e)) silent.push(e);
      }
      if (typeof info.step === 'string' && !withAudio(info.step)) silent.push(info.step);
    }
    expect(silent).toEqual([]);
  });
});
