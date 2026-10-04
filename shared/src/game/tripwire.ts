/**
 * Tripwire hooks and string (vanilla TripWireHookBlock.calculateState / TripWireBlock.checkPressed,
 * updateSource): hooks facing each other up to 40 strings apart attach, string an entity touches
 * is powered (re-checked every 10 ticks), the hooks then output 15 (strong into their wall).
 * Disarmed (sheared) string never powers the hooks.
 */
import { BLOCKS_BY_NAME } from '../data';
import { blockIdOf, blockNameOf, getProp, withProp } from '../world/blockstate';

export interface TripwireHost {
  getState(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number, flags?: number): void;
  scheduleTick(x: number, y: number, z: number, state: number, delay: number): void;
  updateNeighborsAt(x: number, y: number, z: number, fromBlock: number): void;
  /** any entity (not ignoring block triggers) in the box */
  entitiesIn(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean;
  playSound?(event: string, x: number, y: number, z: number, volume: number, pitch: number): void;
}

const HOOK = BLOCKS_BY_NAME.get('tripwire_hook')?.id ?? -1;
const WIRE = BLOCKS_BY_NAME.get('tripwire')?.id ?? -1;
const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DX = [0, 0, 0, 0, -1, 1];
const DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];

const dirOf = (s: number) => DIRS.indexOf(getProp(s, 'facing') as string);

function sound(h: TripwireHost, x: number, y: number, z: number, attached: boolean, powered: boolean, wasAttached: boolean, wasPowered: boolean): void {
  const p = (e: string, pitch: number) => h.playSound?.(e, x + 0.5, y + 0.5, z + 0.5, 0.4, pitch);
  if (powered && !wasPowered) p('block.tripwire.click_on', 0.6);
  else if (!powered && wasPowered) p('block.tripwire.click_off', 0.5);
  else if (attached && !wasAttached) p('block.tripwire.attach', 0.7);
  else if (!attached && wasAttached) p('block.tripwire.detach', 1.2 / 1.0);
}

function notifyNeighbors(h: TripwireHost, x: number, y: number, z: number, d: number): void {
  h.updateNeighborsAt(x, y, z, HOOK);
  h.updateNeighborsAt(x - DX[d]!, y, z - DZ[d]!, HOOK);
}

/** TripWireHookBlock.calculateState */
export function hookCalculateState(h: TripwireHost, x: number, y: number, z: number, hook: number, beingRemoved: boolean, notify: boolean, wireIndex: number, wireState: number | null): void {
  const d = dirOf(hook);
  const wasAttached = getProp(hook, 'attached') === true;
  const wasPowered = getProp(hook, 'powered') === true;
  let attached = !beingRemoved;
  let powered = false;
  let i = 0;
  const wires: (number | null)[] = new Array(42).fill(null);
  for (let j = 1; j < 42; j++) {
    const px = x + DX[d]! * j, pz = z + DZ[d]! * j;
    let bs = h.getState(px, y, pz);
    if (blockIdOf(bs) === HOOK) {
      if (dirOf(bs) === OPP[d]) i = j;
      break;
    }
    if (blockIdOf(bs) !== WIRE && j !== wireIndex) {
      wires[j] = null;
      attached = false;
    } else {
      if (j === wireIndex && wireState !== null) bs = wireState;
      const armed = getProp(bs, 'disarmed') !== true;
      const pw = getProp(bs, 'powered') === true;
      powered = powered || (armed && pw);
      wires[j] = bs;
      if (j === wireIndex) {
        h.scheduleTick(x, y, z, hook, 10);
        attached = attached && armed;
      }
    }
  }
  attached = attached && i > 1;
  powered = powered && attached;
  if (i > 0) {
    const ox = x + DX[d]! * i, oz = z + DZ[d]! * i;
    const other = h.getState(ox, y, oz);
    h.setBlock(ox, y, oz, withProp(withProp(withProp(other, 'attached', attached), 'powered', powered), 'facing', DIRS[OPP[d]!]!), 3);
    notifyNeighbors(h, ox, y, oz, OPP[d]!);
    sound(h, ox, y, oz, attached, powered, wasAttached, wasPowered);
  }
  sound(h, x, y, z, attached, powered, wasAttached, wasPowered);
  if (!beingRemoved) {
    h.setBlock(x, y, z, withProp(withProp(hook, 'attached', attached), 'powered', powered), 3);
    if (notify) notifyNeighbors(h, x, y, z, d);
  }
  if (wasAttached !== attached) {
    for (let k = 1; k < i; k++) {
      const w = wires[k];
      if (w !== null && w !== undefined) h.setBlock(x + DX[d]! * k, y, z + DZ[d]! * k, withProp(w, 'attached', attached), 3);
    }
  }
}

/** TripWireBlock.updateSource: tell the hooks south and west of this string (vanilla order). */
export function wireUpdateSource(h: TripwireHost, x: number, y: number, z: number, wire: number): void {
  for (const d of [3, 4]) {
    for (let i = 1; i < 42; i++) {
      const px = x + DX[d]! * i, pz = z + DZ[d]! * i;
      const bs = h.getState(px, y, pz);
      if (blockIdOf(bs) === HOOK) {
        if (dirOf(bs) === OPP[d]) hookCalculateState(h, px, y, pz, bs, false, true, i, wire);
        break;
      }
      if (blockIdOf(bs) !== WIRE) break;
    }
  }
}

/** TripWireBlock.checkPressed */
export function wireCheckPressed(h: TripwireHost, x: number, y: number, z: number): void {
  let s = h.getState(x, y, z);
  if (blockIdOf(s) !== WIRE) return;
  const was = getProp(s, 'powered') === true;
  // shape: attached 1..2.5 px, otherwise 0..8 px
  const attached = getProp(s, 'attached') === true;
  const on = h.entitiesIn(x, y + (attached ? 1 / 16 : 0), z, x + 1, y + (attached ? 2.5 / 16 : 0.5), z + 1);
  if (on !== was) {
    s = withProp(s, 'powered', on);
    h.setBlock(x, y, z, s, 3);
    wireUpdateSource(h, x, y, z, s);
  }
  if (on) h.scheduleTick(x, y, z, s, 10);
}

/** TripWireBlock.entityInside */
export function wireEntityInside(h: TripwireHost, x: number, y: number, z: number): void {
  const s = h.getState(x, y, z);
  if (blockIdOf(s) === WIRE && getProp(s, 'powered') !== true) wireCheckPressed(h, x, y, z);
}

/** Scheduled tick of a hook or string; true when handled. */
export function tripwireTick(h: TripwireHost, x: number, y: number, z: number, s: number): boolean {
  if (blockIdOf(s) === HOOK) {
    hookCalculateState(h, x, y, z, s, false, true, -1, null);
    return true;
  }
  if (blockIdOf(s) === WIRE) {
    if (getProp(s, 'powered') === true) wireCheckPressed(h, x, y, z);
    return true;
  }
  return false;
}

/** onPlace / onRemove of hooks and string (setPlacedBy for hooks, updateSource for string). */
export function tripwireChanged(h: TripwireHost, x: number, y: number, z: number, old: number, st: number): void {
  const on = blockNameOf(st), wasN = blockNameOf(old);
  if (on === wasN) return;
  if (on === 'tripwire_hook') hookCalculateState(h, x, y, z, st, false, false, -1, null);
  else if (on === 'tripwire') wireUpdateSource(h, x, y, z, st);
  if (wasN === 'tripwire_hook') {
    if (getProp(old, 'attached') === true || getProp(old, 'powered') === true) hookCalculateState(h, x, y, z, old, true, false, -1, null);
    if (getProp(old, 'powered') === true) notifyNeighbors(h, x, y, z, dirOf(old));
  } else if (wasN === 'tripwire') wireUpdateSource(h, x, y, z, withProp(old, 'powered', true));
}

/** TripWireBlock.playerWillDestroy with shears: disarm first (flag 4) so the hooks do not fire. */
export function disarmTripwire(h: TripwireHost, x: number, y: number, z: number): void {
  const s = h.getState(x, y, z);
  if (blockIdOf(s) === WIRE) h.setBlock(x, y, z, withProp(s, 'disarmed', true), 4);
}
