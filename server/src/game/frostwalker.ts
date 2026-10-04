/**
 * Frost Walker (FrostWalkerEnchantment.onEntityMoved) and frosted ice melting
 * (FrostedIceBlock.tick / randomTick), Java Edition 1.17.1.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { blockNameOf, getProp, withProp, stateOf } from '@shared/world/blockstate';
import { entityEnchLevel } from '@shared/game/enchantments';
import { BLOCKS_BY_NAME } from '@shared/data';

const FROSTED = stateOf('frosted_ice');
const WATER = stateOf('water');
const FROSTED_LIGHT_BLOCK = BLOCKS_BY_NAME.get('frosted_ice')?.filterLight ?? 1;

/** Called when a player's block position changed while on the ground. */
export function frostWalk(s: GameServer, p: ServerPlayer): void {
  if (!p.onGround || p.gameMode === 3) return;
  const level = entityEnchLevel('frost_walker', p.inventory);
  if (level <= 0) return;
  const w = s.world;
  const f = Math.min(16, 2 + level);
  const bx = Math.floor(p.x), by = Math.floor(p.y) - 1, bz = Math.floor(p.z);
  for (let x = bx - f; x <= bx + f; x++)
    for (let z = bz - f; z <= bz + f; z++) {
      // BlockPos.closerThan(entity position, f): block corner to the entity's position
      const dx = x - p.x, dy = by - p.y, dz = z - p.z;
      if (dx * dx + dy * dy + dz * dz >= f * f) continue;
      if (w.getState(x, by + 1, z) !== 0) continue;
      const st = w.getState(x, by, z);
      if (blockNameOf(st) !== 'water' || getProp(st, 'level') !== 0) continue;
      // isUnobstructed: no entity collision box in the way (other players)
      if (s.players.some((o) => o !== p && o.gameMode !== 3 && Math.abs(o.x - (x + 0.5)) < 0.8 && Math.abs(o.z - (z + 0.5)) < 0.8 && o.y < by + 1 && o.y + 1.8 > by)) continue;
      s.setBlock(x, by, z, FROSTED);
      s.blocks.scheduleTick(x, by, z, FROSTED, 60 + s.rand.nextInt(61));
    }
}

/** FrostedIceBlock.slightlyMelt: age up, or turn back into water at age 3. */
function slightlyMelt(s: GameServer, x: number, y: number, z: number, st: number): boolean {
  const age = getProp(st, 'age') as number;
  if (age < 3) {
    s.setBlock(x, y, z, withProp(st, 'age', age + 1));
    return false;
  }
  s.setBlock(x, y, z, WATER);
  s.updateNeighbors(x, y, z);
  return true;
}

const DIRS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

/** FrostedIceBlock.tick (also its randomTick). */
export function tickFrostedIce(s: GameServer, x: number, y: number, z: number, st: number, skyDarken: number): void {
  const w = s.world;
  const r = s.rand;
  let neighbours = 0;
  for (const [dx, dy, dz] of DIRS) if (blockNameOf(w.getState(x + dx, y + dy, z + dz)) === 'frosted_ice') neighbours++;
  const light = Math.max(w.getSkyLight(x, y, z) - skyDarken, w.getBlockLight(x, y, z));
  const age = getProp(st, 'age') as number;
  if ((r.nextInt(3) === 0 || neighbours < 4) && light > 11 - age - FROSTED_LIGHT_BLOCK && slightlyMelt(s, x, y, z, st)) {
    for (const [dx, dy, dz] of DIRS) {
      const ns = w.getState(x + dx, y + dy, z + dz);
      if (blockNameOf(ns) === 'frosted_ice') slightlyMelt(s, x + dx, y + dy, z + dz, ns);
    }
  } else {
    s.blocks.scheduleTick(x, y, z, st, 20 + r.nextInt(21));
  }
}
