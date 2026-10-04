/**
 * Block-resolution biomes (vanilla BiomeManager): the world seed is hashed with SHA-256
 * (BiomeManager.obfuscateSeed) and every block picks one of the 8 surrounding quart cells by a
 * jittered ("fiddled") distance — FuzzyOffsetConstantColumnBiomeZoomer, which ignores y in the
 * 1.15–1.17 overworld.
 */
import { H, L, step, stepInt, splitBig, floorModShift24 } from './lcg';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a short message (one 64-byte block is enough for 8 bytes). */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  buf[buf.length - 4] = (bits >>> 24) & 255;
  buf[buf.length - 3] = (bits >>> 16) & 255;
  buf[buf.length - 2] = (bits >>> 8) & 255;
  buf[buf.length - 1] = bits & 255;
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) {
      const o = b * 64 + i * 4;
      w[i] = (buf[o]! << 24) | (buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (hh! + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & bb!) ^ (a! & c!) ^ (bb! & c!);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d! + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0]! += a!; h[1]! += bb!; h[2]! += c!; h[3]! += d!; h[4]! += e!; h[5]! += f!; h[6]! += g!; h[7]! += hh!;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = h[i]! >>> 24; out[i * 4 + 1] = (h[i]! >>> 16) & 255; out[i * 4 + 2] = (h[i]! >>> 8) & 255; out[i * 4 + 3] = h[i]! & 255;
  }
  return out;
}

/** BiomeManager.obfuscateSeed: Guava sha256().hashLong(seed).asLong() (little-endian both ways). */
export function obfuscateSeed(seed: bigint): bigint {
  const u = BigInt.asUintN(64, seed);
  const msg = new Uint8Array(8);
  for (let i = 0; i < 8; i++) msg[i] = Number((u >> BigInt(8 * i)) & 255n);
  const d = sha256(msg);
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[i]!);
  return BigInt.asIntN(64, v);
}

function fiddle(h: number, l: number): number {
  return (floorModShift24(h, l, 1024) / 1024 - 0.5) * 0.9;
}

/**
 * FuzzyOffsetBiomeZoomer.getBiome: the quart cell (qx, qz) whose jittered centre is nearest to the
 * block; writes into `out`. `sha` is the obfuscated seed.
 */
export function zoomToQuart(sha: bigint, x: number, z: number, out: [number, number]): [number, number] {
  const [sh, sl] = splitBig(sha);
  const i = x - 2, j = -2, k = z - 2;
  const l = i >> 2, i1 = j >> 2, j1 = k >> 2;
  const d0 = (i & 3) / 4, d1 = (j & 3) / 4, d2 = (k & 3) / 4;
  let best = 0, bestD = Infinity;
  for (let c = 0; c < 8; c++) {
    const fx = (c & 4) === 0, fy = (c & 2) === 0, fz = (c & 1) === 0;
    const cx = fx ? l : l + 1, cy = fy ? i1 : i1 + 1, cz = fz ? j1 : j1 + 1;
    const dx = fx ? d0 : d0 - 1, dy = fy ? d1 : d1 - 1, dz = fz ? d2 : d2 - 1;
    // getFiddledDistance
    stepInt(sh, sl, cx); stepInt(H, L, cy); stepInt(H, L, cz);
    stepInt(H, L, cx); stepInt(H, L, cy); stepInt(H, L, cz);
    const ox = fiddle(H, L);
    step(H, L, sh, sl);
    const oy = fiddle(H, L);
    step(H, L, sh, sl);
    const oz = fiddle(H, L);
    const d = (dz + oz) * (dz + oz) + (dy + oy) * (dy + oy) + (dx + ox) * (dx + ox);
    if (bestD > d) {
      bestD = d;
      best = c;
    }
  }
  out[0] = (best & 4) === 0 ? l : l + 1;
  out[1] = (best & 1) === 0 ? j1 : j1 + 1;
  return out;
}
