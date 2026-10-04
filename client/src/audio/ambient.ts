/**
 * Client ambient sound handlers (vanilla 1.17.1), ticked at 20 TPS:
 * - BiomeAmbientSoundsHandler: per-biome ambient loop (fades in/out over 40 ticks when the biome
 *   changes), additions (random one-shots at a per-tick chance) and mood sounds. Overworld biomes
 *   use LEGACY_CAVE_SETTINGS (ambient.cave); the five Nether biomes have their own loop, mood and
 *   additions (chance 0.0111). Mood: darkness around the player builds "moodiness" (tick delay
 *   6000, block search extent 8); at 1.0 the sound plays 2 blocks beyond a random dark block.
 * - LocalPlayer.updateIsUnderwater + UnderwaterAmbientSoundInstance (looping, fades in over 40 ticks
 *   and out twice as fast) + UnderwaterAmbientSoundHandler additions (1% / 0.1% / 0.01% per tick).
 */
import type { SoundHandle } from './engine';

export interface AmbientWorld {
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
}

export interface AmbientPlayer {
  x: number;
  y: number;
  z: number;
  eyeY: number;
  underWater: boolean;
  /** biome name at the player (null: unknown / not loaded) */
  biome: string | null;
}

export interface AmbientOut {
  /** positional ambient sound */
  playAt(event: string, x: number, y: number, z: number, volume: number, pitch: number): void;
  /** non-positional ambient one-shot (SimpleSoundInstance.forAmbientAddition) */
  playRelative(event: string, volume: number, pitch: number): void;
  /** streamed looping ambience, starting silent */
  playLoop(event: string): SoundHandle;
}

export interface BiomeAmbience {
  loop?: string;
  mood: { event: string; tickDelay: number; extent: number; offset: number };
  additions?: { event: string; chance: number };
}

const LEGACY_CAVE: BiomeAmbience = { mood: { event: 'ambient.cave', tickDelay: 6000, extent: 8, offset: 2 } };
const nether = (b: string): BiomeAmbience => ({
  loop: `ambient.${b}.loop`,
  mood: { event: `ambient.${b}.mood`, tickDelay: 6000, extent: 8, offset: 2 },
  additions: { event: `ambient.${b}.additions`, chance: 0.0111 },
});
/** Biome.getAmbientLoop / getAmbientMood / getAmbientAdditions (End biomes: cave mood like overworld) */
export const BIOME_AMBIENCE: Record<string, BiomeAmbience> = {
  nether_wastes: nether('nether_wastes'),
  crimson_forest: nether('crimson_forest'),
  warped_forest: nether('warped_forest'),
  soul_sand_valley: nether('soul_sand_valley'),
  basalt_deltas: nether('basalt_deltas'),
};
export const ambienceOf = (biome: string): BiomeAmbience => BIOME_AMBIENCE[biome] ?? LEGACY_CAVE;

export const MOOD_TICK_DELAY = 6000;
export const MOOD_OFFSET = 2;

/** BiomeAmbientSoundsHandler.LoopSoundInstance */
class LoopInstance {
  fade = 0;
  dir = 0;
  constructor(readonly handle: SoundHandle) {}
  fadeIn(): void {
    this.fade = Math.max(0, this.fade);
    this.dir = 1;
  }
  fadeOut(): void {
    this.dir = -1;
  }
  /** returns false once stopped */
  tick(): boolean {
    if (!this.handle.active) return false;
    this.fade = Math.min(40, this.fade + this.dir);
    if (this.fade < 0) {
      this.handle.stop();
      return false;
    }
    this.handle.setVolume(Math.max(0, Math.min(1, this.fade / 40)));
    return true;
  }
}

export class AmbientSounds {
  moodiness = 0;
  private wasUnderwater = false;
  private loop: SoundHandle | null = null;
  private fade = 0;
  private previousBiome: string | null = null;
  private readonly biomeLoops = new Map<string, LoopInstance>();

  constructor(private readonly out: AmbientOut, private readonly rand: () => number = Math.random) {}

  private nextInt(n: number): number {
    return Math.floor(this.rand() * n);
  }

  tick(world: AmbientWorld, p: AmbientPlayer): void {
    this.tickBiome(world, p);
    this.tickUnderwater(p);
  }

  private tickBiome(world: AmbientWorld, p: AmbientPlayer): void {
    for (const [b, l] of this.biomeLoops) if (!l.tick()) this.biomeLoops.delete(b);
    if (!p.biome) return;
    const amb = ambienceOf(p.biome);
    if (p.biome !== this.previousBiome) {
      this.previousBiome = p.biome;
      for (const l of this.biomeLoops.values()) l.fadeOut();
      if (amb.loop) {
        let l = this.biomeLoops.get(p.biome);
        if (!l) {
          const h = this.out.playLoop(amb.loop);
          if (h.active) this.biomeLoops.set(p.biome, (l = new LoopInstance(h)));
        }
        l?.fadeIn();
      }
    }
    if (amb.additions && this.rand() < amb.additions.chance) this.out.playRelative(amb.additions.event, 1, 1);
    this.tickMood(world, p, amb.mood);
  }

  private tickMood(world: AmbientWorld, p: AmbientPlayer, m: BiomeAmbience['mood']): void {
    const e = m.extent, n = e * 2 + 1;
    const bx = Math.floor(p.x + this.nextInt(n) - e);
    const by = Math.floor(p.eyeY + this.nextInt(n) - e);
    const bz = Math.floor(p.z + this.nextInt(n) - e);
    const sky = world.getSkyLight(bx, by, bz);
    if (sky > 0) this.moodiness -= (sky / 15) * 0.001;
    else this.moodiness -= (world.getBlockLight(bx, by, bz) - 1) / m.tickDelay;
    if (this.moodiness >= 1) {
      const dx = bx + 0.5 - p.x, dy = by + 0.5 - p.eyeY, dz = bz + 0.5 - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = (d + m.offset) / d;
      this.out.playAt(m.event, p.x + dx * k, p.eyeY + dy * k, p.z + dz * k, 1, 1);
      this.moodiness = 0;
    } else this.moodiness = Math.max(this.moodiness, 0);
  }

  private tickUnderwater(p: AmbientPlayer): void {
    const under = p.underWater;
    if (!this.wasUnderwater && under) {
      this.out.playAt('ambient.underwater.enter', p.x, p.y, p.z, 1, 1);
      if (!this.loop?.active) this.loop = this.out.playLoop('ambient.underwater.loop');
    }
    if (this.wasUnderwater && !under) this.out.playAt('ambient.underwater.exit', p.x, p.y, p.z, 1, 1);
    this.wasUnderwater = under;
    // UnderwaterAmbientSoundInstance.tick
    if (this.loop) {
      if (under) this.fade = Math.min(40, this.fade + 1);
      else this.fade -= 2;
      if (this.fade < 0 || !this.loop.active) {
        this.loop.stop();
        this.loop = null;
        this.fade = 0;
      } else this.loop.setVolume(Math.max(0, Math.min(1, this.fade / 40)));
    }
    // UnderwaterAmbientSoundHandler
    if (under) {
      const f = this.rand();
      if (f < 1e-4) this.out.playAt('ambient.underwater.loop.additions.ultra_rare', p.x, p.y, p.z, 1, 1);
      else if (f < 1e-3) this.out.playAt('ambient.underwater.loop.additions.rare', p.x, p.y, p.z, 1, 1);
      else if (f < 1e-2) this.out.playAt('ambient.underwater.loop.additions', p.x, p.y, p.z, 1, 1);
    }
  }

  /** world unload / disconnect */
  stop(): void {
    this.loop?.stop();
    this.loop = null;
    for (const l of this.biomeLoops.values()) l.handle.stop();
    this.biomeLoops.clear();
    this.previousBiome = null;
    this.fade = 0;
    this.wasUnderwater = false;
    this.moodiness = 0;
  }
}
