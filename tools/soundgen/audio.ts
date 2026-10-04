/** Audio processing for the sound build (ffmpeg for decode/encode, everything else in JS). */
import { execFileSync } from 'node:child_process';

export const RATE = 44100;

/** Decode any audio file to mono float samples at 44.1 kHz. */
export function decode(path: string): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

/** Encode mono float samples to Ogg Vorbis. */
export function encode(samples: Float32Array, out: string, quality = 4): void {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-', '-c:a', 'libvorbis', '-q:a', String(quality), out], {
    input: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
  });
}

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** Remove leading/trailing audio below `thresholdDb` (with a little padding). */
export function trim(s: Float32Array, thresholdDb = -48, padMs = 8): Float32Array {
  const t = 10 ** (thresholdDb / 20);
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]!) < t) a++;
  while (b > a && Math.abs(s[b]!) < t) b--;
  const pad = Math.round((padMs / 1000) * RATE);
  return s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad));
}

/** Peak-normalize to `peakDb` dBFS. */
export function normalize(s: Float32Array, peakDb = -3): Float32Array {
  let p = 0;
  for (const v of s) p = Math.max(p, Math.abs(v));
  if (p <= 0) return s;
  const g = 10 ** (peakDb / 20) / p;
  return s.map((v) => v * g);
}

export function gain(s: Float32Array, dbGain: number): Float32Array {
  const g = 10 ** (dbGain / 20);
  return s.map((v) => v * g);
}

/** Short fade-in and fade-out to avoid clicks. */
export function fade(s: Float32Array, inMs = 3, outMs = 25): Float32Array {
  const o = s.slice();
  const fi = Math.min(o.length, Math.round((inMs / 1000) * RATE));
  const fo = Math.min(o.length, Math.round((outMs / 1000) * RATE));
  for (let i = 0; i < fi; i++) o[i]! *= i / fi;
  for (let i = 0; i < fo; i++) o[o.length - 1 - i]! *= i / fo;
  return o;
}

/** A plain section [start, start + len) seconds. */
export function section(s: Float32Array, start: number, len: number): Float32Array {
  return s.slice(Math.round(start * RATE), Math.min(s.length, Math.round((start + len) * RATE)));
}

/**
 * Split a recording of repeated events (footsteps, hits) into single events: onsets are
 * frames whose short-term energy jumps well above the recent average; each slice runs from
 * just before an onset to the next onset (at most `maxLen` seconds).
 */
export function sliceOnsets(s: Float32Array, opts: { count: number; maxLen: number; minGap?: number; skip?: number; minLen?: number }): Float32Array[] {
  const hop = 256;
  const frames = Math.floor(s.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) e += s[f * hop + i]! ** 2;
    env[f] = Math.sqrt(e / hop);
  }
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const minGap = Math.round(((opts.minGap ?? 0.25) * RATE) / hop);
  const onsets: number[] = [];
  let avg = env[0] ?? 0;
  for (let f = 1; f < frames; f++) {
    const v = env[f]!;
    if (v > peak * 0.12 && v > avg * 3 && (onsets.length === 0 || f - onsets[onsets.length - 1]! >= minGap)) onsets.push(f);
    avg = avg * 0.9 + v * 0.1;
  }
  const out: Float32Array[] = [];
  const pre = Math.round(0.01 * RATE);
  for (let k = opts.skip ?? 0; k < onsets.length && out.length < opts.count; k++) {
    const a = Math.max(0, onsets[k]! * hop - pre);
    const next = k + 1 < onsets.length ? onsets[k + 1]! * hop - pre : s.length;
    const b = Math.min(next, a + Math.round(opts.maxLen * RATE));
    // too short to be a whole event (e.g. a second transient inside one footstep)
    if (b - a < (opts.minLen ?? 0.15) * RATE) continue;
    out.push(s.slice(a, b));
  }
  return out;
}

export function durationOf(s: Float32Array): number {
  return s.length / RATE;
}

void db;

/**
 * Fundamental frequency of a single note (YIN difference function, cumulative-mean normalized,
 * first dip below the threshold, parabolic refinement), measured just after the loudest point.
 */
export function detectPitch(s: Float32Array, minHz = 40, maxHz = 3000): number | null {
  let peakAt = 0;
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]!) > Math.abs(s[peakAt]!)) peakAt = i;
  const start = Math.min(peakAt + Math.round(0.02 * RATE), Math.max(0, s.length - 8192));
  const W = 4096;
  const maxLag = Math.min(Math.floor(RATE / minHz), 2048), minLag = Math.max(2, Math.floor(RATE / maxHz));
  if (start + W + maxLag > s.length) return null;
  const d = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const x = s[start + i]! - s[start + i + lag]!;
      sum += x * x;
    }
    d[lag] = sum;
  }
  // cumulative mean normalized difference
  const c = new Float64Array(maxLag + 1);
  c[0] = 1;
  let run = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    run += d[lag]!;
    c[lag] = run > 0 ? (d[lag]! * lag) / run : 1;
  }
  let best = -1;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (c[lag]! < 0.15) {
      while (lag + 1 < maxLag && c[lag + 1]! < c[lag]!) lag++;
      best = lag;
      break;
    }
  }
  if (best < 0) {
    // no clear dip: take the global minimum
    let m = minLag;
    for (let lag = minLag; lag < maxLag; lag++) if (c[lag]! < c[m]!) m = lag;
    if (c[m]! > 0.4) return null;
    best = m;
  }
  const a = c[best - 1]!, b = c[best]!, e = c[best + 1] ?? b;
  const shift = (a - e) / (2 * (a - 2 * b + e) || 1);
  return RATE / (best + (Number.isFinite(shift) ? shift : 0));
}

/** Resample by `ratio` (2 = one octave up and half as long), linear interpolation. */
export function repitch(s: Float32Array, ratio: number): Float32Array {
  const n = Math.floor(s.length / ratio);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, k = Math.floor(p), f = p - k;
    o[i] = (s[k] ?? 0) * (1 - f) + (s[k + 1] ?? 0) * f;
  }
  return o;
}
