/**
 * Explosions (vanilla 1.17.1 Explosion) and primed TNT (PrimedTnt / TntBlock).
 *
 * explode(): 16×16×16 rays from the centre lose (resistance + 0.3) × 0.3 per 0.3-block step from a
 * strength of radius × (0.7–1.3); everything within 2 × radius is hurt by
 * ((1 − d)·seen)² + (1 − d)·seen)/2 × 7 × 2r + 1 and pushed away; blocks drop (with explosion decay
 * for DESTROY, all of them for BREAK like TNT), TNT in range is primed with a short fuse, and
 * incendiary explosions light a third of the cleared spots above solid ground.
 */
import { ServerEntity, ItemEntity, ExperienceOrb } from './entity';
import type { GameServer } from './server';
import { BLOCKS, ITEMS_BY_ID } from '@shared/data';
import { STATE_TO_BLOCK, blockNameOf } from '@shared/world/blockstate';
import { FLUID, FULL_COLLISION, IS_AIR } from '@shared/world/blockinfo';
import { blockDrops } from '@shared/game/loot';
import { Difficulty } from '@shared/game/food';
import { fireStateAt } from './fire';
import type { BlockWorld } from '@shared/world/world';
import type { ItemStack } from '@shared/item/stack';
import { Mob } from './mobs/mob';

export type BlockInteraction = 'none' | 'break' | 'destroy';

const f = Math.fround;

/** Primed TNT (PrimedTnt): 80-tick fuse, gravity 0.04, drag 0.98, bounces on the ground, explodes with power 4. */
export class PrimedTnt extends ServerEntity {
  readonly type = 'tnt';
  readonly width = 0.98;
  readonly height = 0.98;
  readonly trackRange = 160;
  fuse = 80;
  constructor(id: number, private readonly onExplode: (e: PrimedTnt) => void) {
    super(id);
  }
  tick(world: BlockWorld): void {
    if (this.removed) return;
    this.vy -= 0.04;
    this.moveWithCollision(world, this.vx, this.vy, this.vz);
    if (this.onGround && this.vy < 0) this.vy = 0;
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.vz *= 0.98;
    if (this.onGround) {
      this.vx *= 0.7;
      this.vy *= -0.5;
      this.vz *= 0.7;
    }
    if (--this.fuse <= 0) {
      this.removed = true;
      this.onExplode(this);
    }
  }
}

/** TntBlock.explode / wasExploded: replace the block with a primed TNT entity. */
export function primeTnt(s: GameServer, x: number, y: number, z: number, fuse?: number): PrimedTnt {
  const e = new PrimedTnt(s.newEntityId(), (t) => explode(s, t.x, t.y + 0.98 * 0.0625, t.z, 4, false, 'break', t));
  e.x = x + 0.5;
  e.y = y;
  e.z = z + 0.5;
  const a = s.rand.nextDouble() * 6.2831854820251465;
  e.vx = -Math.sin(a) * 0.02;
  e.vy = 0.2;
  e.vz = -Math.cos(a) * 0.02;
  if (fuse !== undefined) e.fuse = fuse;
  s.spawnEntity(e);
  if (fuse === undefined) s.playSound(null, 'entity.tnt.primed', 'block', e.x, e.y, e.z, 1, 1);
  return e;
}

/** Block explosion resistance (and 100 for water/lava). */
function resistance(st: number): number {
  const r = BLOCKS[STATE_TO_BLOCK[st]!]!.resistance ?? 0;
  return FLUID[st] !== 0 ? Math.max(r, 100) : r;
}

/** Explosion.getSeenPercent: the share of rays from points on the box that reach the centre unblocked. */
function seenPercent(w: BlockWorld, cx: number, cy: number, cz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  const d = 1 / ((maxX - minX) * 2 + 1), e = 1 / ((maxY - minY) * 2 + 1), fz = 1 / ((maxZ - minZ) * 2 + 1);
  const g = (1 - Math.floor(1 / d) * d) / 2, h = (1 - Math.floor(1 / fz) * fz) / 2;
  let seen = 0, total = 0;
  for (let k = 0; k <= 1; k += d)
    for (let l = 0; l <= 1; l += e)
      for (let m = 0; m <= 1; m += fz) {
        const px = minX + (maxX - minX) * k + g, py = minY + (maxY - minY) * l, pz = minZ + (maxZ - minZ) * m + h;
        if (!blocked(w, px, py, pz, cx, cy, cz)) seen++;
        total++;
      }
  return seen / total;
}

/** A collider ray test (full collision cubes block), stepping 0.05 blocks. */
function blocked(w: BlockWorld, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len / 0.05);
  let lx = NaN, ly = NaN, lz = NaN;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const bx = Math.floor(x0 + dx * t), by = Math.floor(y0 + dy * t), bz = Math.floor(z0 + dz * t);
    if (bx === lx && by === ly && bz === lz) continue;
    lx = bx;
    ly = by;
    lz = bz;
    if (FULL_COLLISION[w.getState(bx, by, bz)] === 1) return true;
  }
  return false;
}

/** Level.explode */
export function explode(s: GameServer, x: number, y: number, z: number, radius: number, fire: boolean, mode: BlockInteraction, source: ServerEntity | null = null): void {
  const w = s.world, r = s.rand;
  // ---- explode(): find the blocks
  const toBlow = new Map<string, [number, number, number]>();
  for (let j = 0; j < 16; j++)
    for (let k = 0; k < 16; k++)
      for (let l = 0; l < 16; l++) {
        if (!(j === 0 || j === 15 || k === 0 || k === 15 || l === 0 || l === 15)) continue;
        let d = f(j / 15) * 2 - 1, e = f(k / 15) * 2 - 1, g = f(l / 15) * 2 - 1;
        const len = Math.sqrt(d * d + e * e + g * g);
        d /= len;
        e /= len;
        g /= len;
        let h = f(radius * f(0.7 + f(r.nextFloat() * 0.6)));
        let m = x, n = y, o = z;
        for (; h > 0; h = f(h - 0.22500001)) {
          const bx = Math.floor(m), by = Math.floor(n), bz = Math.floor(o);
          if (by < 0 || by > 255) break;
          const st = w.getState(bx, by, bz);
          if (!IS_AIR[st] || FLUID[st] !== 0) h = f(h - f((resistance(st) + 0.3) * 0.3));
          if (h > 0 && mode !== 'none') toBlow.set(`${bx},${by},${bz}`, [bx, by, bz]);
          m += d * 0.3;
          n += e * 0.3;
          o += g * 0.3;
        }
      }
  // ---- entities: damage and knockback
  const q = radius * 2;
  for (const p of s.players) {
    if (p.gameMode === 3 || p.living.dead) continue;
    const dist = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2) / q;
    if (dist > 1) continue;
    let dx = p.x - x, dy = p.y + p.phys.eyeHeight - y, dz = p.z - z;
    const ab = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (ab === 0) continue;
    dx /= ab;
    dy /= ab;
    dz /= ab;
    const seen = seenPercent(w, x, y, z, p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + 1.8, p.z + 0.3);
    const ad = (1 - dist) * seen;
    let dmg = Math.trunc(((ad * ad + ad) / 2) * 7 * q + 1);
    // Player.hurt: explosions scale with difficulty
    if (s.difficulty === Difficulty.Peaceful) dmg = 0;
    else if (s.difficulty === Difficulty.Easy) dmg = Math.min(dmg / 2 + 1, dmg);
    else if (s.difficulty === Difficulty.Hard) dmg = (dmg * 3) / 2;
    // a creeper's explosion is attributed to it ("blown up by Creeper")
    const by = source instanceof Mob ? { name: s.mobs.displayName(source), player: false } : undefined;
    if (dmg > 0) s.survival.hurt(p, { id: by ? 'explosion.player' : 'explosion', explosion: true, entity: by }, dmg);
    if (!(p.gameMode === 1 && p.flying)) {
      p.vx += dx * ad;
      p.vy += dy * ad;
      p.vz += dz * ad;
      p.knockbackDirty = true;
    }
  }
  for (const e of s.entities.values()) {
    if (e.removed || e === source) continue;
    const dist = Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2) / q;
    if (dist > 1) continue;
    let dx = e.x - x, dy = e.y + (e instanceof PrimedTnt ? 0 : e.height * 0.85) - y, dz = e.z - z;
    const ab = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (ab === 0) continue;
    dx /= ab;
    dy /= ab;
    dz /= ab;
    const bb = e.bb();
    const ad = (1 - dist) * seenPercent(w, x, y, z, bb.minX, bb.minY, bb.minZ, bb.maxX, bb.maxY, bb.maxZ);
    const dmg = Math.trunc(((ad * ad + ad) / 2) * 7 * q + 1);
    // mobs take the explosion damage (LivingEntity.hurt; their knockback below)
    if (e instanceof Mob) {
      if (e.dead) continue;
      e.hurt({ id: source instanceof Mob ? 'explosion.player' : 'explosion', explosion: true }, dmg, source instanceof Mob ? source : null);
      e.velocityDirty = true;
    }
    // items and orbs have 5 health (nether stars survive)
    if ((e instanceof ItemEntity && ITEMS_BY_ID[e.stack.id]?.name !== 'nether_star') || e instanceof ExperienceOrb) {
      if (dmg >= 5) {
        e.removed = true;
        continue;
      }
    }
    e.vx += dx * ad;
    e.vy += dy * ad;
    e.vz += dz * ad;
  }
  // ---- finalizeExplosion
  s.playSound(null, 'entity.generic.explode', 'block', x, y, z, 4, (1 + (r.nextFloat() - r.nextFloat()) * 0.2) * 0.7);
  // explosion particles for clients (vanilla ClientboundExplodePacket without the block list)
  for (const o of s.players) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.viewDistance * 16 + 16) ** 2) s.send(o, { t: 'explode', x, y, z, power: radius, destroy: mode !== 'none' });
  const list = [...toBlow.values()];
  if (mode !== 'none') {
    // Util.shuffle
    for (let i = list.length; i > 1; i--) {
      const j = r.nextInt(i);
      [list[i - 1], list[j]] = [list[j]!, list[i - 1]!];
    }
    const drops: { x: number; y: number; z: number; stack: ItemStack }[] = [];
    for (const [bx, by, bz] of list) {
      const st = w.getState(bx, by, bz);
      if (IS_AIR[st]) continue;
      const name = blockNameOf(st);
      if (name === 'tnt') {
        // TntBlock.wasExploded: a short random fuse
        s.setBlock(bx, by, bz, 0);
        primeTnt(s, bx, by, bz, r.nextInt(20) + 10);
        continue;
      }
      if (FLUID[st] !== 0 && (name === 'water' || name === 'lava')) continue;
      if ((BLOCKS[STATE_TO_BLOCK[st]!]!.resistance ?? 0) >= 1200) continue;
      if (s.gameRules.doTileDrops) {
        for (const it of blockDrops(st, { silkTouch: false, canHarvest: true, random: () => r.nextFloat() })) {
          // ExplosionDecay (DESTROY): each item survives with chance 1 / radius
          if (mode === 'destroy') {
            let c = 0;
            for (let i = 0; i < it.count; i++) if (r.nextFloat() <= 1 / radius) c++;
            it.count = c;
          }
          if (it.count <= 0) continue;
          // Explosion.addBlockDrops: merge equal stacks
          const same = drops.find((d) => d.stack.id === it.id && d.stack.damage === it.damage && d.stack.count + it.count <= 64);
          if (same) same.stack.count += it.count;
          else drops.push({ x: bx, y: by, z: bz, stack: it });
        }
      }
      s.setBlock(bx, by, bz, 0);
      for (const o of s.players) s.send(o, { t: 'levelEvent', event: 2001, x: bx, y: by, z: bz, data: st });
    }
    for (const d of drops) s.popResource(d.x, d.y, d.z, d.stack);
    for (const [bx, by, bz] of list) s.updateNeighbors(bx, by, bz);
  }
  if (fire) {
    for (const [bx, by, bz] of list) {
      if (r.nextInt(3) === 0 && IS_AIR[w.getState(bx, by, bz)] && FULL_COLLISION[w.getState(bx, by - 1, bz)] === 1) s.setBlock(bx, by, bz, fireStateAt(w, bx, by, bz));
    }
  }
}
