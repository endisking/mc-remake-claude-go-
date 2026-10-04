/**
 * Sound engine (vanilla SoundEngine semantics on WebAudio): sound events resolve to weighted
 * file variants from /sounds/sounds.json; positional sounds use linear attenuation over
 * max(volume, 1) × 16 blocks; volume is clamped to 0..1 and pitch to 0.5..2 (playback rate);
 * per-category volumes multiply with the master volume.
 */

export type SoundCategory = 'master' | 'music' | 'record' | 'weather' | 'block' | 'hostile' | 'neutral' | 'player' | 'ambient' | 'voice';

export const SOUND_CATEGORIES: SoundCategory[] = ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'];

interface SoundFile {
  /** path under /sounds without extension */
  name: string;
  volume?: number;
  pitch?: number;
  weight?: number;
  /** long sounds (music, ambience loops) are streamed instead of decoded up front */
  stream?: boolean;
  /** attenuation distance in blocks (default 16) */
  attenuation_distance?: number;
}

interface SoundEventDef {
  sounds: SoundFile[];
  /** registered vanilla event that has no recording yet (silent) */
  placeholder?: boolean;
}

/** A long-running sound (music track or ambience loop) the caller can fade and stop. */
export interface SoundHandle {
  /** true until the track ends or is stopped */
  readonly active: boolean;
  setVolume(v: number): void;
  stop(): void;
}

const NO_HANDLE: SoundHandle = { active: false, setVolume() {}, stop() {} };

const MAX_CHANNELS = 48;

interface Playing {
  source: AudioBufferSourceNode;
  started: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private categories = new Map<SoundCategory, GainNode>();
  private manifest: Record<string, SoundEventDef> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private playing: Playing[] = [];
  private warned = new Set<string>();
  readonly volumes: Record<SoundCategory, number>;

  constructor(volumes?: Partial<Record<SoundCategory, number>>) {
    this.volumes = Object.fromEntries(SOUND_CATEGORIES.map((c) => [c, volumes?.[c] ?? 1])) as Record<SoundCategory, number>;
  }

  async load(base = './sounds/'): Promise<void> {
    try {
      this.manifest = (await (await fetch(`${base}sounds.json`)).json()) as Record<string, SoundEventDef>;
    } catch {
      this.manifest = {};
    }
  }

  /** Browsers only allow audio after a user gesture: call from input handlers. */
  resume(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const c of SOUND_CATEGORIES) {
        if (c === 'master') continue;
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.categories.set(c, g);
      }
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    for (const [c, g] of this.categories) g.gain.value = this.volumes[c];
  }

  /** Listener at the camera, facing yaw/pitch (degrees, vanilla convention). */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const yr = (yaw * Math.PI) / 180, pr = (pitch * Math.PI) / 180;
    const fx = -Math.sin(yr) * Math.cos(pr), fy = -Math.sin(pr), fz = Math.cos(yr) * Math.cos(pr);
    const ux = -Math.sin(yr) * -Math.sin(pr), uy = Math.cos(pr), uz = Math.cos(yr) * -Math.sin(pr);
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  private buffer(name: string): Promise<AudioBuffer | null> {
    let b = this.buffers.get(name);
    if (!b) {
      const ctx = this.ctx!;
      b = fetch(`./sounds/${name}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((a) => ctx.decodeAudioData(a))
        .catch(() => null);
      this.buffers.set(name, b);
    }
    return b;
  }

  /**
   * Stream a long sound (music, ambience loop) through an <audio> element instead of decoding it
   * to a buffer: keeps memory low on Chromebooks. Not positional (vanilla music and the underwater
   * loop are relative sounds). Returns an inactive handle when audio is locked or the event is silent.
   */
  playStream(event: string, category: SoundCategory, volume: number, loop = false): SoundHandle {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return NO_HANDLE;
    const file = this.pick(event);
    if (!file) return NO_HANDLE;
    let el: HTMLAudioElement;
    try {
      el = new Audio(`./sounds/${file.name}.ogg`);
    } catch {
      return NO_HANDLE;
    }
    el.loop = loop;
    el.preload = 'auto';
    el.playbackRate = Math.max(0.5, Math.min(2, file.pitch ?? 1));
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
    const g = ctx.createGain();
    const base = file.volume ?? 1;
    g.gain.value = Math.max(0, Math.min(1, volume * base));
    let node: MediaElementAudioSourceNode | null = null;
    try {
      node = ctx.createMediaElementSource(el);
      node.connect(g);
      g.connect(this.categories.get(category) ?? this.master);
    } catch {
      node = null;
    }
    let active = true;
    const finish = () => {
      if (!active) return;
      active = false;
      el.pause();
      el.removeAttribute('src');
      try {
        node?.disconnect();
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    void el.play().catch(finish);
    return {
      get active() {
        return active;
      },
      setVolume: (v: number) => {
        g.gain.value = Math.max(0, Math.min(1, v * base));
      },
      stop: finish,
    };
  }

  /** Whether the event is registered as an explicit silent placeholder. */
  isPlaceholder(event: string): boolean {
    return this.manifest[event]?.placeholder === true;
  }

  /** Whether an event has at least one real audio file. */
  has(event: string): boolean {
    return (this.manifest[event]?.sounds.length ?? 0) > 0;
  }

  private pick(event: string): SoundFile | null {
    const def = this.manifest[event];
    if (!def || def.sounds.length === 0) {
      if (!this.warned.has(event)) {
        this.warned.add(event);
        console.debug(`[sound] no audio for ${event} (placeholder)`);
      }
      return null;
    }
    let total = 0;
    for (const s of def.sounds) total += s.weight ?? 1;
    let r = Math.random() * total;
    for (const s of def.sounds) {
      r -= s.weight ?? 1;
      if (r < 0) return s;
    }
    return def.sounds[def.sounds.length - 1]!;
  }

  /**
   * Play a sound event. Positional when x/y/z are given; `relative` sounds (UI, music) are not
   * attenuated.
   */
  play(event: string, category: SoundCategory, volume: number, pitch: number, x?: number, y?: number, z?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.volumes[category] <= 0 || this.volumes.master <= 0) return;
    const file = this.pick(event);
    if (!file) return;
    const gainValue = Math.max(0, Math.min(1, volume * (file.volume ?? 1)));
    const rate = Math.max(0.5, Math.min(2, pitch * (file.pitch ?? 1)));
    const atten = Math.max(volume, 1) * (file.attenuation_distance ?? 16);
    void this.buffer(file.name).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gainValue;
      src.connect(g);
      let out: AudioNode = g;
      if (x !== undefined && y !== undefined && z !== undefined) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'linear';
        p.refDistance = 0;
        p.maxDistance = atten;
        p.rolloffFactor = 1;
        if (p.positionX) {
          p.positionX.value = x;
          p.positionY.value = y;
          p.positionZ.value = z;
        } else p.setPosition(x, y, z);
        g.connect(p);
        out = p;
      }
      out.connect(this.categories.get(category) ?? this.master);
      // channel limit: stop the oldest
      if (this.playing.length >= MAX_CHANNELS) {
        const old = this.playing.shift()!;
        try {
          old.source.stop();
        } catch {
          /* already stopped */
        }
      }
      const entry = { source: src, started: ctx.currentTime };
      this.playing.push(entry);
      src.onended = () => {
        const i = this.playing.indexOf(entry);
        if (i >= 0) this.playing.splice(i, 1);
        src.disconnect();
      };
      src.start();
    });
  }
}
