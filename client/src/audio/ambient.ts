/**
 * Client ambient sound handlers (vanilla 1.17.1), ticked at 20 TPS:
 * - BiomeAmbientSoundsHandler mood part with LEGACY_CAVE_SETTINGS (ambient.cave, tick delay 6000,
 *   block search extent 8, sound position offset 2): darkness around the player builds "moodiness";
 *   at 1.0 a cave sound plays 2 blocks beyond a random dark block and the counter resets.
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
  /** mood sounds only exist in overworld biomes (nether biomes have their own, not sourced yet) */
  moodSound: string | null;
}

export interface AmbientOut {
  playAt(event: string, x: number, y: number, z: number, volume: number, pitch: number): void;
  playLoop(event: string): SoundHandle;
}

export const MOOD_TICK_DELAY = 6000;
export const MOOD_SEARCH_EXTENT = 8;
export const MOOD_OFFSET = 2;

export class AmbientSounds {
  moodiness = 0;
  private wasUnderwater = false;
  private loop: SoundHandle | null = null;
  private fade = 0;

  constructor(private readonly out: AmbientOut, private readonly rand: () => number = Math.random) {}

  private nextInt(n: number): number {
    return Math.floor(this.rand() * n);
  }

  tick(world: AmbientWorld, p: AmbientPlayer): void {
    this.tickMood(world, p);
    this.tickUnderwater(p);
  }

  private tickMood(world: AmbientWorld, p: AmbientPlayer): void {
    if (!p.moodSound) return;
    const e = MOOD_SEARCH_EXTENT, n = e * 2 + 1;
    const bx = Math.floor(p.x + this.nextInt(n) - e);
    const by = Math.floor(p.eyeY + this.nextInt(n) - e);
    const bz = Math.floor(p.z + this.nextInt(n) - e);
    const sky = world.getSkyLight(bx, by, bz);
    if (sky > 0) this.moodiness -= (sky / 15) * 0.001;
    else this.moodiness -= (world.getBlockLight(bx, by, bz) - 1) / MOOD_TICK_DELAY;
    if (this.moodiness >= 1) {
      const dx = bx + 0.5 - p.x, dy = by + 0.5 - p.eyeY, dz = bz + 0.5 - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = (d + MOOD_OFFSET) / d;
      this.out.playAt(p.moodSound, p.x + dx * k, p.eyeY + dy * k, p.z + dz * k, 1, 1);
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
    this.fade = 0;
    this.wasUnderwater = false;
    this.moodiness = 0;
  }
}
