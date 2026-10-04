/**
 * Mobs that structures place when they generate (vanilla template entities and spawn calls:
 * villagers and iron golems in villages, the witch and black cat of a swamp hut, the igloo's
 * villager and zombie villager, elder guardians in monuments, the outpost's caged iron golem,
 * mansion illagers, drowned in ocean ruins). Like generated block entities they are queued per
 * world for the server to spawn once mobs exist (vanilla marks them persistent).
 */
import type { GenLevel } from '../features/level';

export interface GenEntity {
  type: string;
  x: number;
  y: number;
  z: number;
  /** PersistenceRequired (never despawns) */
  persistent: boolean;
}

const pending = new WeakMap<object, GenEntity[]>();

export function addGenEntity(lv: GenLevel, e: GenEntity): void {
  let list = pending.get(lv.world);
  if (!list) pending.set(lv.world, (list = []));
  list.push(e);
}

/** Structure mobs generated in this world since the last call (removes them from the queue). */
export function takeGenEntities(world: object): GenEntity[] {
  const list = pending.get(world) ?? [];
  pending.delete(world);
  return list;
}
