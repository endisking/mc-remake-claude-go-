/**
 * Client-side dimension effects (vanilla DimensionSpecialEffects / FogRenderer / LocalPlayer
 * portal handling): Nether fog colour per biome (biome effects fog_color, Gaussian-sampled over
 * quart cells like CubicSampler), the Nether's thick "foggy" distance, and the portal overlay
 * timer and screen wobble.
 */
import type { BlockWorld } from '@shared/world/world';
import { B } from '@shared/worldgen/biome/biomeids';
import type { Mat4 } from '../render/math';
import { multiply } from '../render/math';

/** fog_color of the 1.17.1 nether biomes */
export const NETHER_FOG: Record<number, number> = {
  [B.nether_wastes]: 0x330808,
  [B.soul_sand_valley]: 0x1b4745,
  [B.crimson_forest]: 0x330303,
  [B.warped_forest]: 0x1a051a,
  [B.basalt_deltas]: 0x685f70,
};

/** Dimension ambient light (DimensionType.ambientLight). */
export function ambientLight(dim: string): number {
  return dim === 'the_nether' ? 0.1 : 0;
}

export const hasSky = (dim: string) => dim === 'overworld';

const W = [0, 1, 4, 6, 4, 1, 0];
/**
 * FogRenderer.setupColor for the Nether: CubicSampler.gaussianSampleVec3 of biome fog colours
 * around the camera (unchanged by brightness), pulled toward the black night sky by the render
 * distance factor, darkened below y 32 (the void fade, clear colour scale 1/32).
 */
export function netherFogColor(world: BlockWorld, x: number, y: number, z: number, renderChunks: number, out: [number, number, number]): [number, number, number] {
  const qx = Math.floor((x - 2) / 4), qz = Math.floor((z - 2) / 4);
  const fx = (x - 2) / 4 - qx, fz = (z - 2) / 4 - qz;
  let r = 0, g = 0, b = 0, tw = 0;
  for (let i = 0; i < 6; i++)
    for (let k = 0; k < 6; k++) {
      // weights interpolated between neighbouring kernel taps (CubicSampler's fractional offset)
      const wx = W[i]! + (W[i + 1]! - W[i]!) * fx, wz = W[k]! + (W[k + 1]! - W[k]!) * fz;
      const w = wx * wz;
      if (w <= 0) continue;
      const col = NETHER_FOG[world.getBiome((qx + i - 2) * 4 + 2, Math.floor(y), (qz + k - 2) * 4 + 2)] ?? NETHER_FOG[B.nether_wastes]!;
      r += ((col >> 16) & 255) * w;
      g += ((col >> 8) & 255) * w;
      b += (col & 255) * w;
      tw += w;
    }
  r /= tw * 255;
  g /= tw * 255;
  b /= tw * 255;
  // fog += (sky - fog) × u with a black sky at the nether's fixed midnight
  let u = 0.25 + (0.75 * renderChunks) / 32;
  u = 1 - Math.pow(u, 0.25);
  r *= 1 - u;
  g *= 1 - u;
  b *= 1 - u;
  let d = y * 0.03125;
  if (d < 1) {
    if (d < 0) d = 0;
    d *= d;
    r *= d;
    g *= d;
    b *= d;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

/** DimensionSpecialEffects.isFoggyAt (Nether): fog from 5% of the render distance to half of it (max 192). */
export function netherFogRange(renderBlocks: number): [number, number] {
  return [renderBlocks * 0.05, Math.min(renderBlocks, 192) * 0.5];
}

/** LocalPlayer.portalTime / oPortalTime (handleNetherPortalClient). */
export class PortalEffect {
  time = 0;
  old = 0;

  /** Per tick; returns true when the trigger sound should play (just stepped in). */
  tick(inside: boolean): boolean {
    this.old = this.time;
    if (inside) {
      const trigger = this.time === 0;
      this.time = Math.min(1, this.time + 0.0125);
      return trigger;
    }
    if (this.time > 0) this.time = Math.max(0, this.time - 0.05);
    return false;
  }

  value(partial: number): number {
    return this.old + (this.time - this.old) * partial;
  }

  /** Gui.renderPortalOverlay alpha. */
  overlayAlpha(partial: number): number {
    let f = this.value(partial);
    if (f <= 0) return 0;
    if (f < 1) {
      f *= f;
      f *= f;
      f = f * 0.8 + 0.2;
    }
    return f;
  }
}

const tmp = new Float32Array(16);
/** GameRenderer.renderLevel portal/nausea wobble: rotate about (0, √½, √½), squash x by 1/h, rotate back. */
export function applyPortalWobble(target: Mat4, amount: number, ticks: number, effectScale: number): void {
  const g = amount * effectScale * effectScale;
  if (g <= 0) return;
  let h = 5 / (g * g + 5) - g * 0.04;
  h *= h;
  const ang = ((ticks * 20) % 360) * (Math.PI / 180);
  const s = Math.SQRT1_2;
  rotAxis(tmp, ang, 0, s, s);
  multiply(target, target, tmp);
  tmp.set([1 / h, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  multiply(target, target, tmp);
  rotAxis(tmp, -ang, 0, s, s);
  multiply(target, target, tmp);
}

function rotAxis(out: Float32Array, a: number, x: number, y: number, z: number): void {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  out.set([
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * NetherPortalBlock.animateTick ambience (the sound part; ClientLevel.animateTick samples random
 * blocks near the player): 1 in 100 portal blocks hums each time it is picked.
 */
export function animatePortals(world: BlockWorld, px: number, py: number, pz: number, r: { nextInt(n: number): number; nextFloat(): number }, isPortal: (s: number) => boolean, play: (event: string, x: number, y: number, z: number, volume: number, pitch: number) => void): void {
  const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
  for (let l = 0; l < 667; l++) {
    const x = bx + r.nextInt(16) - r.nextInt(16), y = by + r.nextInt(16) - r.nextInt(16), z = bz + r.nextInt(16) - r.nextInt(16);
    if (isPortal(world.getState(x, y, z)) && r.nextInt(100) === 0) play('block.portal.ambient', x + 0.5, y + 0.5, z + 0.5, 0.5, r.nextFloat() * 0.4 + 0.8);
  }
}

/** Is the player's box (deflated by 0.001) touching a nether portal block? (Entity.checkInsideBlocks) */
export function insidePortal(world: BlockWorld, x: number, y: number, z: number, height: number, isPortal: (s: number) => boolean): boolean {
  const h = 0.3 - 0.001;
  for (let bx = Math.floor(x - h); bx <= Math.floor(x + h); bx++)
    for (let by = Math.floor(y + 0.001); by <= Math.floor(y + height - 0.001); by++)
      for (let bz = Math.floor(z - h); bz <= Math.floor(z + h); bz++) if (isPortal(world.getState(bx, by, bz))) return true;
  return false;
}

/** fog_color of the End biomes (all five share it) */
export const END_FOG = 0xa080a0;

/**
 * FogRenderer.setupColor in the End: the biome fog colour through EndEffects.getBrightnessDependentFogColor
 * (× 0.15), pulled toward the black End sky by the render-distance factor, darkened below y 32 (void fade).
 */
export function endFogColor(y: number, renderChunks: number, out: [number, number, number]): [number, number, number] {
  let u = 0.25 + (0.75 * renderChunks) / 32;
  u = 1 - Math.pow(u, 0.25);
  const k = (0.15 * (1 - u)) / 255;
  let r = ((END_FOG >> 16) & 255) * k, g = ((END_FOG >> 8) & 255) * k, b = (END_FOG & 255) * k;
  let d = y * 0.03125;
  if (d < 1) {
    if (d < 0) d = 0;
    d *= d;
    r *= d;
    g *= d;
    b *= d;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}
