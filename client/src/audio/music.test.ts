import { describe, it, expect } from 'vitest';
import { MusicManager, MUSICS, NETHER_MUSIC, situationalMusic, type MusicSituation } from './music';
import { AmbientSounds } from './ambient';
import type { SoundHandle } from './engine';

class FakeTrack implements SoundHandle {
  active = true;
  volume = 1;
  constructor(readonly event: string) {}
  setVolume(v: number): void {
    this.volume = v;
  }
  stop(): void {
    this.active = false;
  }
}

function manager(rand = () => 0.5) {
  const started: FakeTrack[] = [];
  const m = new MusicManager((event) => {
    const t = new FakeTrack(event);
    started.push(t);
    return t;
  }, rand);
  return { m, started };
}

const base: MusicSituation = { inMenu: false, dimension: 'overworld', biome: 'plains', biomeCategory: 'plains', underWater: false, creativeFlying: false };

describe('situational music (Minecraft.getSituationalMusic)', () => {
  it('picks menu / game / creative / underwater / nether / end', () => {
    expect(situationalMusic({ ...base, inMenu: true }, false)).toBe(MUSICS.menu);
    expect(situationalMusic(base, false)).toBe(MUSICS.game);
    expect(situationalMusic({ ...base, creativeFlying: true }, false)).toBe(MUSICS.creative);
    // underwater music only in oceans and rivers
    expect(situationalMusic({ ...base, underWater: true }, false)).toBe(MUSICS.game);
    expect(situationalMusic({ ...base, underWater: true, biomeCategory: 'ocean' }, false)).toBe(MUSICS.underWater);
    // and it keeps playing after surfacing
    expect(situationalMusic(base, true)).toBe(MUSICS.underWater);
    expect(situationalMusic({ ...base, dimension: 'the_nether', biome: 'crimson_forest', biomeCategory: 'nether', creativeFlying: true }, false)).toBe(NETHER_MUSIC.crimson_forest);
    expect(situationalMusic({ ...base, dimension: 'the_end' }, false)).toBe(MUSICS.end);
    expect(situationalMusic({ ...base, dimension: 'the_end', bossMusic: true }, false)).toBe(MUSICS.endBoss);
  });

  it('game music delays are 12000-24000 ticks; menu replaces the current track', () => {
    expect(MUSICS.game).toMatchObject({ minDelay: 12000, maxDelay: 24000, replaceCurrent: false });
    expect(MUSICS.creative).toMatchObject({ minDelay: 12000, maxDelay: 24000, replaceCurrent: false });
    expect(MUSICS.menu).toMatchObject({ minDelay: 20, maxDelay: 600, replaceCurrent: true });
  });
});

describe('MusicManager', () => {
  it('starts the first track after 100 ticks and plays only one at a time', () => {
    const { m, started } = manager();
    for (let i = 0; i < 100; i++) m.tick(MUSICS.game);
    expect(started.length).toBe(0);
    m.tick(MUSICS.game);
    expect(started.map((t) => t.event)).toEqual(['music.game']);
    for (let i = 0; i < 50000; i++) m.tick(MUSICS.game);
    expect(started.length).toBe(1);
  });

  it('waits a random 12000-24000 ticks after a track ends', () => {
    const { m, started } = manager(() => 0.5);
    for (let i = 0; i <= 100; i++) m.tick(MUSICS.game);
    started[0]!.active = false;
    let ticks = 0;
    while (started.length === 1 && ticks < 30000) {
      m.tick(MUSICS.game);
      ticks++;
    }
    // nextInt(12000, 24000) at 0.5 = 18000 (set and counted down on the tick the track ended)
    expect(ticks).toBe(18001);
  });

  it('a non-replacing situation change keeps the track; menu music replaces it quickly', () => {
    const { m, started } = manager(() => 0);
    for (let i = 0; i <= 100; i++) m.tick(MUSICS.game);
    m.tick(MUSICS.creative);
    expect(started[0]!.active).toBe(true);
    m.tick(MUSICS.menu);
    expect(started[0]!.active).toBe(false);
    m.tick(MUSICS.menu);
    expect(started.at(-1)!.event).toBe('music.menu');
  });

  it('retries soon when audio is still locked', () => {
    let calls = 0;
    const m = new MusicManager(() => {
      calls++;
      return { active: false, setVolume() {}, stop() {} };
    });
    for (let i = 0; i <= 100; i++) m.tick(MUSICS.game);
    expect(calls).toBe(1);
    for (let i = 0; i <= 100; i++) m.tick(MUSICS.game);
    expect(calls).toBe(2);
  });
});

describe('ambient sounds', () => {
  const dark = { getSkyLight: () => 0, getBlockLight: () => 0 };
  const lit = { getSkyLight: () => 15, getBlockLight: () => 0 };
  const player = { x: 0.5, y: 10, z: 0.5, eyeY: 11.62, underWater: false, biome: 'plains' };

  it('plays a cave sound after 6000 ticks of total darkness, 2 blocks beyond a dark block', () => {
    const played: { e: string; d: number }[] = [];
    const a = new AmbientSounds({ playAt: (e, x, y, z) => played.push({ e, d: Math.hypot(x - 0.5, y - 11.62, z - 0.5) }), playRelative: () => {}, playLoop: () => new FakeTrack('loop') }, () => 0.9);
    for (let i = 0; i < 5999; i++) a.tick(dark, player);
    expect(played.length).toBe(0);
    a.tick(dark, player);
    a.tick(dark, player);
    expect(played.length).toBe(1);
    expect(played[0]!.e).toBe('ambient.cave');
    expect(played[0]!.d).toBeGreaterThan(2);
    expect(a.moodiness).toBeLessThan(0.01);
  });

  it('daylight drains moodiness and nothing plays', () => {
    const played: string[] = [];
    const a = new AmbientSounds({ playAt: (e) => played.push(e), playRelative: () => {}, playLoop: () => new FakeTrack('loop') });
    a.moodiness = 0.5;
    for (let i = 0; i < 20000; i++) a.tick(lit, player);
    expect(played).toEqual([]);
    expect(a.moodiness).toBe(0);
  });

  it('underwater: enter sound + fading loop, exit sound, loop fades out twice as fast', () => {
    const played: string[] = [];
    let loop: FakeTrack | null = null;
    const a = new AmbientSounds({ playAt: (e) => played.push(e), playRelative: () => {}, playLoop: (e) => (loop = new FakeTrack(e)) }, () => 0.5);
    a.tick(lit, { ...player, underWater: true });
    expect(played).toEqual(['ambient.underwater.enter']);
    expect(loop!.event).toBe('ambient.underwater.loop');
    for (let i = 0; i < 50; i++) a.tick(lit, { ...player, underWater: true });
    expect(loop!.volume).toBe(1);
    a.tick(lit, player);
    expect(played.at(-1)).toBe('ambient.underwater.exit');
    for (let i = 0; i < 19; i++) a.tick(lit, player);
    expect(loop!.active).toBe(true);
    a.tick(lit, player);
    expect(loop!.active).toBe(false);
  });

  it('nether biomes fade their ambient loop in, and out when leaving; additions play', () => {
    const loops: FakeTrack[] = [];
    const rel: string[] = [];
    const a = new AmbientSounds({ playAt: () => {}, playRelative: (e) => rel.push(e), playLoop: (e) => { const t = new FakeTrack(e); loops.push(t); return t; } });
    for (let i = 0; i < 2000; i++) a.tick(lit, { ...player, biome: 'crimson_forest' });
    expect(loops[0]!.event).toBe('ambient.crimson_forest.loop');
    expect(loops[0]!.volume).toBe(1);
    expect(rel.length).toBeGreaterThan(5);
    expect(rel.every((e) => e === 'ambient.crimson_forest.additions')).toBe(true);
    for (let i = 0; i < 39; i++) a.tick(lit, player);
    expect(loops[0]!.active).toBe(true);
    for (let i = 0; i < 3; i++) a.tick(lit, player);
    expect(loops[0]!.active).toBe(false);
  });
});
