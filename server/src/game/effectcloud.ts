/**
 * Lingering potion clouds (vanilla AreaEffectCloud as made by ThrownPotion.makeAreaOfEffectCloud,
 * 1.17.1): radius 3 shrinking to nothing over 600 ticks after a 10-tick wait, −0.5 radius per
 * entity affected, every 5 ticks, effects at a quarter of their duration, reapplied after 20
 * ticks. Clients see it through effectCloud packets (coloured swirls over the disc).
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import type { PotionEffect } from '@shared/game/potions';

export class EffectCloud {
  radius = 3;
  readonly radiusOnUse = -0.5;
  readonly waitTime = 10;
  readonly duration = 600;
  readonly radiusPerTick: number;
  readonly reapplicationDelay = 20;
  tickCount = 0;
  removed = false;
  /** the dimension (ServerLevel) the cloud is in; undefined = whichever is ticking */
  level: unknown = undefined;
  private readonly victims = new Map<ServerPlayer, number>();

  constructor(readonly id: number, public x: number, public y: number, public z: number, readonly effects: PotionEffect[], readonly color: number) {
    this.radiusPerTick = -this.radius / this.duration;
  }

  /** AreaEffectCloud.tick (server). */
  tick(s: GameServer, apply: (p: ServerPlayer, e: PotionEffect, durationQuarter: number) => void): void {
    this.tickCount++;
    if (this.tickCount >= this.waitTime + this.duration) {
      this.removed = true;
      return;
    }
    const waiting = this.tickCount < this.waitTime;
    if (waiting) return;
    this.radius += this.radiusPerTick;
    if (this.radius < 0.5) {
      this.removed = true;
      return;
    }
    if (this.tickCount % 5 === 0) {
      for (const [p, t] of this.victims) if (this.tickCount >= t || !s.players.includes(p)) this.victims.delete(p);
      for (const p of s.players) {
        if (this.victims.has(p) || p.gameMode === 3 || p.living.dead) continue;
        // bounding box: the disc, 0.5 tall
        if (p.y > this.y + 0.5 || p.y + 1.8 < this.y) continue;
        const dx = p.x - this.x, dz = p.z - this.z;
        if (dx * dx + dz * dz > this.radius * this.radius) continue;
        this.victims.set(p, this.tickCount + this.reapplicationDelay);
        for (const e of this.effects) apply(p, e, Math.trunc(e.duration / 4));
        this.radius += this.radiusOnUse;
        if (this.radius < 0.5) {
          this.removed = true;
          return;
        }
      }
      for (const o of s.players) s.send(o, { t: 'effectCloud', id: this.id, x: this.x, y: this.y, z: this.z, radius: this.radius, color: this.color });
    }
  }
}
