/**
 * Vanilla MusicManager + Musics (1.17.1): one track at a time, chosen from the situation
 * (Minecraft.getSituationalMusic), with a random delay between tracks. Ticked at 20 TPS.
 *
 * Musics: MENU (20..600 ticks, replaces current), GAME / CREATIVE / UNDER_WATER / Nether biome
 * music (12000..24000, does not replace), END (6000..24000, replaces), END_BOSS and CREDITS
 * (0..0, replace). The first track starts after 100 ticks.
 */
import type { SoundHandle } from './engine';

export interface Music {
  event: string;
  minDelay: number;
  maxDelay: number;
  replaceCurrent: boolean;
}

const game = (event: string): Music => ({ event, minDelay: 12000, maxDelay: 24000, replaceCurrent: false });

export const MUSICS = {
  menu: { event: 'music.menu', minDelay: 20, maxDelay: 600, replaceCurrent: true },
  creative: game('music.creative'),
  credits: { event: 'music.credits', minDelay: 0, maxDelay: 0, replaceCurrent: true },
  endBoss: { event: 'music.dragon', minDelay: 0, maxDelay: 0, replaceCurrent: true },
  end: { event: 'music.end', minDelay: 6000, maxDelay: 24000, replaceCurrent: true },
  underWater: game('music.under_water'),
  game: game('music.game'),
} satisfies Record<string, Music>;

/** Nether biomes carry their own background music (Biome.getBackgroundMusic). */
export const NETHER_MUSIC: Record<string, Music> = {
  nether_wastes: game('music.nether.nether_wastes'),
  crimson_forest: game('music.nether.crimson_forest'),
  warped_forest: game('music.nether.warped_forest'),
  soul_sand_valley: game('music.nether.soul_sand_valley'),
  basalt_deltas: game('music.nether.basalt_deltas'),
};

export interface MusicSituation {
  /** no world loaded (title / menus) */
  inMenu: boolean;
  credits?: boolean;
  dimension: 'overworld' | 'the_nether' | 'the_end';
  /** boss bar asks for boss music (ender dragon fight) */
  bossMusic?: boolean;
  /** player biome name and category */
  biome: string;
  biomeCategory: string;
  underWater: boolean;
  /** abilities.instabuild && abilities.mayfly */
  creativeFlying: boolean;
}

/** Minecraft.getSituationalMusic (1.17.1). `playingUnderwater`: the current track is the underwater music. */
export function situationalMusic(s: MusicSituation, playingUnderwater: boolean): Music {
  if (s.credits) return MUSICS.credits;
  if (s.inMenu) return MUSICS.menu;
  if (s.dimension === 'the_end') return s.bossMusic ? MUSICS.endBoss : MUSICS.end;
  if (!playingUnderwater && (!s.underWater || (s.biomeCategory !== 'ocean' && s.biomeCategory !== 'river'))) {
    if (s.dimension !== 'the_nether' && s.creativeFlying) return MUSICS.creative;
    return NETHER_MUSIC[s.biome] ?? MUSICS.game;
  }
  return MUSICS.underWater;
}

/** Mth.nextInt(random, a, b): uniform integer in [a, b]. */
function nextInt(rand: () => number, a: number, b: number): number {
  return a >= b ? a : a + Math.floor(rand() * (b - a + 1));
}

export type PlayMusic = (event: string) => SoundHandle;

export class MusicManager {
  private current: SoundHandle | null = null;
  private currentEvent: string | null = null;
  nextSongDelay = 100;

  constructor(private readonly play: PlayMusic, private readonly rand: () => number = Math.random) {}

  get playingEvent(): string | null {
    return this.current ? this.currentEvent : null;
  }

  isPlaying(m: Music): boolean {
    return this.current !== null && this.currentEvent === m.event;
  }

  /** MusicManager.tick */
  tick(music: Music): void {
    if (this.current) {
      if (music.event !== this.currentEvent && music.replaceCurrent) {
        this.current.stop();
        this.nextSongDelay = nextInt(this.rand, 0, music.minDelay / 2);
      }
      if (!this.current.active) {
        this.current = null;
        this.currentEvent = null;
        this.nextSongDelay = Math.min(this.nextSongDelay, nextInt(this.rand, music.minDelay, music.maxDelay));
      }
    }
    this.nextSongDelay = Math.min(this.nextSongDelay, music.maxDelay);
    if (this.current === null && this.nextSongDelay-- <= 0) this.startPlaying(music);
  }

  startPlaying(music: Music): void {
    const h = this.play(music.event);
    // audio still locked (no user gesture yet) or a silent event: try again in 5 s instead of every tick
    this.current = h.active ? h : null;
    this.currentEvent = h.active ? music.event : null;
    this.nextSongDelay = h.active ? Number.MAX_SAFE_INTEGER : 100;
  }

  stopPlaying(): void {
    if (this.current) {
      this.current.stop();
      this.current = null;
      this.currentEvent = null;
    }
    this.nextSongDelay += 100;
  }
}
