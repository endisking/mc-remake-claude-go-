/**
 * Dispenser item behaviours (vanilla DispenseItemBehavior registry, 1.17.1): projectiles (arrows,
 * tipped/spectral arrows, snowballs, eggs, splash/lingering potions), buckets (empty a fluid /
 * scoop a source), bone meal, flint and steel, shears on sheep, TNT. Anything else falls back to
 * DefaultDispenseItemBehavior (the item flies out) in ServerRedstone.dispense.
 *
 * `dispenseSpecial` returns null when the item has no special behaviour, otherwise whether it
 * succeeded (true: 1000/1002 click + smoke handled here; false: the 1001 fail click).
 */
import type { GameServer } from './server';
import { Arrow, Pickup } from './arrow';
import { Thrown, type ThrownKind } from './throwable';
import { primeTnt } from './explosion';
import { fireStateAt } from './fire';
import { Sheep } from './mobs/animals';
import { blockNameOf, defaultState, getProp } from '@shared/world/blockstate';
import { isReplaceable } from '@shared/game/placement';
import { ITEMS_BY_ID, ITEMS_BY_NAME } from '@shared/data';
import { potionOf } from '@shared/game/potions';
import type { ItemStack } from '@shared/item/stack';

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const itemId = (n: string) => ITEMS_BY_NAME.get(n)?.id ?? -1;
const nameOf = (id: number) => ITEMS_BY_ID[id]?.name ?? '';

export interface DispenseResult {
  ok: boolean;
  /** what replaces the dispensed item in its slot (buckets), or undefined to just use one up */
  replace?: ItemStack | null;
  /** level event sound: launch (1002) for projectiles, click (1000) otherwise */
  launch?: boolean;
}

function sound(s: GameServer, event: string, x: number, y: number, z: number, vol = 1, pitch = 1): void {
  try {
    s.playSound(null, event, 'block', x + 0.5, y + 0.5, z + 0.5, vol, pitch);
  } catch {
    /* missing sound */
  }
}

/** DispenserBlock.getDispensePosition */
function dispensePos(x: number, y: number, z: number, d: number): [number, number, number] {
  return [x + 0.5 + 0.7 * DX[d]!, y + 0.5 + 0.7 * DY[d]!, z + 0.5 + 0.7 * DZ[d]!];
}

/** AbstractProjectileDispenseBehavior.execute: shoot(dx, dy + 0.1, dz, power, uncertainty). */
function shootFrom(s: GameServer, e: Arrow | Thrown, x: number, y: number, z: number, d: number, power: number, uncertainty: number): void {
  const [px, py, pz] = dispensePos(x, y, z, d);
  e.x = px;
  e.y = py;
  e.z = pz;
  const dx = DX[d]!, dy = DY[d]! + 0.1, dz = DZ[d]!;
  const len = Math.hypot(dx, dy, dz);
  const r = s.rand, g = 0.0075 * uncertainty;
  e.vx = (dx / len + r.nextGaussian() * g) * power;
  e.vy = (dy / len + r.nextGaussian() * g) * power;
  e.vz = (dz / len + r.nextGaussian() * g) * power;
  s.spawnEntity(e);
}

export function dispenseSpecial(s: GameServer, x: number, y: number, z: number, d: number, stack: ItemStack): DispenseResult | null {
  const n = nameOf(stack.id);
  const fx = x + DX[d]!, fy = y + DY[d]!, fz = z + DZ[d]!;
  const front = fy < 0 || fy > 255 ? 0 : s.world.getState(fx, fy, fz);
  const fn = blockNameOf(front);
  switch (n) {
    case 'arrow':
    case 'tipped_arrow':
    case 'spectral_arrow': {
      const a = new Arrow(s.newEntityId(), s.items.arrowHost, { ...stack, count: 1 });
      a.pickup = Pickup.Allowed;
      shootFrom(s, a, x, y, z, d, 1.1, 6);
      return { ok: true, launch: true };
    }
    case 'snowball':
    case 'egg': {
      const t = new Thrown(s.newEntityId(), n as ThrownKind, stack.id, s.items.arrowHost);
      t.onHit = (e, hit) => s.items.thrownHit(e, hit);
      shootFrom(s, t, x, y, z, d, 1.1, 6);
      return { ok: true, launch: true };
    }
    case 'splash_potion':
    case 'lingering_potion': {
      // DispenserBlock potion behaviour: power ×1.25, uncertainty ×0.5
      const t = new Thrown(s.newEntityId(), 'potion', stack.id, s.items.arrowHost);
      const potion = potionOf(stack);
      t.onHit = (e, hit) => (n === 'lingering_potion' ? s.items.linger(e, hit, potion) : s.items.splash(e, hit, potion));
      shootFrom(s, t, x, y, z, d, 1.1 * 1.25, 6 * 0.5);
      return { ok: true, launch: true };
    }
    case 'water_bucket':
    case 'lava_bucket': {
      // DispensibleContainerItem.emptyContents: replaceable (or the same fluid) in front
      const fluid = n === 'water_bucket' ? 'water' : 'lava';
      if (!(front === 0 || isReplaceable(front) || fn === fluid)) return { ok: false };
      if (fluid === 'water' && s.level?.type.ultraWarm) {
        sound(s, 'block.fire.extinguish', fx, fy, fz, 0.5, 2.6 + (s.rand.nextFloat() - s.rand.nextFloat()) * 0.8);
      } else {
        if (front !== 0 && fn !== fluid && fn !== 'water' && fn !== 'lava') s.blocks.breakNaturally(fx, fy, fz, true);
        s.setBlock(fx, fy, fz, defaultState(fluid));
        sound(s, fluid === 'water' ? 'item.bucket.empty' : 'item.bucket.empty_lava', fx, fy, fz);
      }
      return { ok: true, replace: { id: itemId('bucket'), count: 1, damage: 0 } };
    }
    case 'bucket': {
      // BucketPickup: a fluid source in front
      if ((fn !== 'water' && fn !== 'lava') || getProp(front, 'level') !== 0) return { ok: false };
      s.setBlock(fx, fy, fz, 0);
      sound(s, fn === 'water' ? 'item.bucket.fill' : 'item.bucket.fill_lava', fx, fy, fz);
      return { ok: true, replace: { id: itemId(fn + '_bucket'), count: 1, damage: 0 } };
    }
    case 'bone_meal': {
      const ok = s.blocks.boneMeal(fx, fy, fz);
      return { ok };
    }
    case 'flint_and_steel': {
      // FlintAndSteel dispense: fire into air, prime TNT; damages the item
      let ok = false;
      if (fn === 'tnt') {
        s.setBlock(fx, fy, fz, 0);
        primeTnt(s, fx, fy, fz);
        ok = true;
      } else if (front === 0 || fn === 'cave_air') {
        const fire = fireStateAt(s.world, fx, fy, fz);
        s.setBlock(fx, fy, fz, fire);
        ok = true;
      }
      if (!ok) return { ok: false };
      const max = ITEMS_BY_ID[stack.id]?.maxDurability ?? 64;
      const dmg: ItemStack = { ...stack, count: 1, damage: (stack.damage ?? 0) + 1 };
      return { ok: true, replace: dmg.damage >= max ? null : dmg };
    }
    case 'shears': {
      // ShearsDispenseItemBehavior: shear one shearable sheep in front
      for (const m of s.mobs.mobs()) {
        if (!(m instanceof Sheep) || m.dead || m.sheared || m.isBaby()) continue;
        const b = m.bb();
        if (b.maxX <= fx || b.minX >= fx + 1 || b.maxY <= fy || b.minY >= fy + 1 || b.maxZ <= fz || b.minZ >= fz + 1) continue;
        m.shear();
        const max = ITEMS_BY_ID[stack.id]?.maxDurability ?? 238;
        const dmg: ItemStack = { ...stack, count: 1, damage: (stack.damage ?? 0) + 1 };
        return { ok: true, replace: dmg.damage >= max ? null : dmg };
      }
      return { ok: false };
    }
    case 'tnt': {
      const t = primeTnt(s, fx, fy, fz);
      void t;
      sound(s, 'entity.tnt.primed', fx, fy, fz);
      return { ok: true };
    }
    default:
      return null;
  }
}

/** level events 1000 (click) / 1002 (launch) and 1001 (fail) */
export function dispenseSound(s: GameServer, x: number, y: number, z: number, r: DispenseResult): void {
  if (!r.ok) sound(s, 'block.dispenser.fail', x, y, z, 1, 1.2);
  else sound(s, r.launch ? 'block.dispenser.launch' : 'block.dispenser.dispense', x, y, z, 1, r.launch ? 1.2 : 1);
}
