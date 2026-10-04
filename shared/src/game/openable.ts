/**
 * Opening doors, trapdoors and fence gates by hand (DoorBlock / TrapDoorBlock / FenceGateBlock.use).
 * Shared so the client can predict the click like vanilla's client-side use().
 */
import { blockNameOf, getProp, withProp } from '../world/blockstate';
import type { StateGetter } from '../world/raycast';
import { horizontalFacing } from './placement';

export interface OpenResult {
  /** block changes to apply */
  changes: { x: number; y: number; z: number; state: number }[];
  /** sound event and whether it opened */
  sound: string;
  open: boolean;
}

/** The changes for using an openable block at (x, y, z), or null if it doesn't open by hand. */
export function useOpenable(w: StateGetter, x: number, y: number, z: number, yaw: number): OpenResult | null {
  const st = w.getState(x, y, z);
  const n = blockNameOf(st);
  if (n.endsWith('_door') && n !== 'iron_door') {
    const open = !(getProp(st, 'open') as boolean);
    const changes = [{ x, y, z, state: withProp(st, 'open', open) }];
    const oy = getProp(st, 'half') === 'upper' ? y - 1 : y + 1;
    const other = w.getState(x, oy, z);
    if (blockNameOf(other) === n) changes.push({ x, y: oy, z, state: withProp(other, 'open', open) });
    return { changes, open, sound: open ? 'block.wooden_door.open' : 'block.wooden_door.close' };
  }
  if (n.endsWith('_trapdoor') && n !== 'iron_trapdoor') {
    const open = !(getProp(st, 'open') as boolean);
    return { changes: [{ x, y, z, state: withProp(st, 'open', open) }], open, sound: open ? 'block.wooden_trapdoor.open' : 'block.wooden_trapdoor.close' };
  }
  if (n.endsWith('_fence_gate')) {
    let ns: number;
    if (getProp(st, 'open') === true) ns = withProp(st, 'open', false);
    else {
      // swing away from the player
      const dir = horizontalFacing(yaw);
      const opp: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' };
      ns = st;
      if (getProp(st, 'facing') === opp[dir]) ns = withProp(ns, 'facing', dir);
      ns = withProp(ns, 'open', true);
    }
    const open = getProp(ns, 'open') === true;
    return { changes: [{ x, y, z, state: ns }], open, sound: open ? 'block.fence_gate.open' : 'block.fence_gate.close' };
  }
  return null;
}
