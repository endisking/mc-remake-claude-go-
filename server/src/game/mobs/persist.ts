/**
 * Mob save data (the subset of vanilla entity NBT that matters for these mobs), JSON-compatible so
 * world saves can store it per region/chunk: GameServer.mobs.save() / GameServer.mobs.load(list).
 */
import type { ItemStack } from '@shared/item/stack';
import { Mob } from './mob';
import { Zombie } from './monsters';
import { Creeper } from './monsters';
import { Animal, Sheep, Pig, Chicken } from './animals';
import { Slime } from './slime';
import { Enderman } from './enderman';

export interface MobSave {
  type: string;
  pos: [number, number, number];
  motion: [number, number, number];
  rot: [number, number];
  health: number;
  fire: number;
  air: number;
  persistent: boolean;
  hand?: ItemStack | null;
  /** AgeableMob Age / InLove */
  age?: number;
  inLove?: number;
  baby?: boolean;
  color?: number;
  sheared?: boolean;
  saddle?: boolean;
  eggTime?: number;
  size?: number;
  powered?: boolean;
  carried?: number;
  inWaterTime?: number;
  conversionTime?: number;
}

export function saveMob(m: Mob): MobSave {
  const o: MobSave = {
    type: m.type, pos: [m.x, m.y, m.z], motion: [m.vx, m.vy, m.vz], rot: [m.yaw, m.yHeadRot], health: m.health,
    fire: m.remainingFireTicks, air: m.airSupply, persistent: m.persistenceRequired,
  };
  if (m.mainHand) o.hand = { ...m.mainHand };
  if (m instanceof Animal) {
    o.age = m.ageTicks;
    o.inLove = m.inLove;
  }
  if (m instanceof Zombie) {
    o.baby = m.baby;
    o.inWaterTime = m.inWaterTime;
    o.conversionTime = m.conversionTime;
  }
  if (m instanceof Sheep) {
    o.color = m.color;
    o.sheared = m.sheared;
  }
  if (m instanceof Pig) o.saddle = m.saddled;
  if (m instanceof Chicken) o.eggTime = m.eggTime;
  if (m instanceof Slime) o.size = m.size;
  if (m instanceof Creeper) o.powered = m.powered;
  if (m instanceof Enderman) o.carried = m.carried;
  return o;
}

/** Apply saved state to a freshly constructed (init()ed, not finalized) mob. */
export function applyMobSave(m: Mob, o: MobSave): void {
  [m.x, m.y, m.z] = o.pos;
  [m.vx, m.vy, m.vz] = o.motion;
  [m.yaw, m.yHeadRot] = o.rot;
  m.yBodyRot = m.yaw;
  if (m instanceof Slime && o.size) m.setSize(o.size);
  m.health = o.health;
  m.remainingFireTicks = o.fire;
  m.airSupply = o.air;
  m.persistenceRequired = o.persistent;
  m.mainHand = o.hand ?? null;
  if (m instanceof Animal) {
    m.ageTicks = o.age ?? 0;
    m.inLove = o.inLove ?? 0;
  }
  if (m instanceof Zombie) {
    m.baby = !!o.baby;
    m.inWaterTime = o.inWaterTime ?? 0;
    m.conversionTime = o.conversionTime ?? -1;
  }
  if (m instanceof Sheep) {
    m.color = o.color ?? 0;
    m.sheared = !!o.sheared;
  }
  if (m instanceof Pig) m.saddled = !!o.saddle;
  if (m instanceof Chicken && o.eggTime) m.eggTime = o.eggTime;
  if (m instanceof Creeper) m.powered = !!o.powered;
  if (m instanceof Enderman) m.carried = o.carried ?? 0;
  m.flagsDirty = true;
}
