/**
 * Respawn anchors (vanilla 1.17.1 RespawnAnchorBlock): glowstone charges them (0–4), a charged
 * anchor sets the player's spawn in the Nether, and anywhere else it explodes (power 5, fire).
 * Respawning at a charged anchor uses one charge and stands the player next to it
 * (findStandUpPosition: the 8 horizontal neighbours, then those one lower, one higher, then above).
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { blockNameOf, getProp, withProp } from '@shared/world/blockstate';
import { ITEMS_BY_NAME } from '@shared/data';
import { explode } from './explosion';

const GLOWSTONE = ITEMS_BY_NAME.get('glowstone')?.id ?? -1;
const HORIZONTAL: [number, number][] = [[0, -1], [-1, 0], [0, 1], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const OFFSETS: [number, number, number][] = [
  ...HORIZONTAL.map(([x, z]): [number, number, number] => [x, 0, z]),
  ...HORIZONTAL.map(([x, z]): [number, number, number] => [x, -1, z]),
  ...HORIZONTAL.map(([x, z]): [number, number, number] => [x, 1, z]),
  [0, 1, 0],
];

export const isAnchor = (st: number) => blockNameOf(st) === 'respawn_anchor';

/** RespawnAnchorBlock.use; true when the click was consumed. */
export function useAnchor(s: GameServer, p: ServerPlayer, x: number, y: number, z: number): boolean {
  const st = s.world.getState(x, y, z);
  if (!isAnchor(st)) return false;
  const charge = Number(getProp(st, 'charges') ?? 0);
  const inv = p.inventory;
  const slot = inv.selectedStack?.id === GLOWSTONE ? inv.selected : inv.get(40)?.id === GLOWSTONE ? 40 : -1;
  if (slot >= 0 && charge < 4) {
    s.setBlock(x, y, z, withProp(st, 'charges', charge + 1));
    s.updateNeighbors(x, y, z);
    s.playSound(null, 'block.respawn_anchor.charge', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    if (p.gameMode !== 1) {
      const stack = inv.get(slot)!;
      if (--stack.count <= 0) inv.set(slot, null);
      s.syncSlot(p, slot);
    }
    return true;
  }
  if (charge === 0) return false;
  if (!s.level.type.respawnAnchorWorks) {
    s.setBlock(x, y, z, 0);
    explode(s, x + 0.5, y + 0.5, z + 0.5, 5, true, 'destroy');
    return true;
  }
  const r = p.respawn;
  if (!r || r.dimension !== s.level.id || r.x !== x || r.y !== y || r.z !== z) {
    p.respawn = { x, y, z, angle: 0, dimension: s.level.id };
    s.playSound(null, 'block.respawn_anchor.set_spawn', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    s.send(p, { t: 'chat', json: JSON.stringify({ text: 'Respawn point set' }) });
  }
  return true;
}

/**
 * ServerPlayer.findRespawnPositionAndUseSpawnBlock for an anchor (run in the anchor's level):
 * the stand-up position and yaw, using one charge; null when uncharged, gone or obstructed.
 */
export function respawnAtAnchor(s: GameServer, x: number, y: number, z: number): { pos: [number, number, number]; yaw: number } | null {
  const st = s.world.getState(x, y, z);
  if (!isAnchor(st)) return null;
  const charge = Number(getProp(st, 'charges') ?? 0);
  if (charge <= 0) return null;
  const dismount = (s.sleep as unknown as { safeDismount(x: number, y: number, z: number, safe: boolean): [number, number, number] | null }).safeDismount.bind(s.sleep);
  let pos: [number, number, number] | null = null;
  for (const safe of [true, false]) {
    for (const [ox, oy, oz] of OFFSETS) if ((pos = dismount(x + ox, y + oy, z + oz, safe))) break;
    if (pos) break;
  }
  if (!pos) return null;
  s.setBlock(x, y, z, withProp(st, 'charges', charge - 1));
  s.playSound(null, 'block.respawn_anchor.deplete', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
  const vx = x + 0.5 - pos[0], vz = z + 0.5 - pos[2];
  return { pos, yaw: (Math.atan2(vz, vx) * 180) / Math.PI - 90 };
}
