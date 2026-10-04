/**
 * Rails (vanilla RailState + BaseRailBlock / RailBlock / PoweredRailBlock / DetectorRailBlock):
 * shape auto-connection with slopes and (plain rail only) curves, powered/activator rail power
 * propagation (up to 8 rails from a powered one) and the detector rail's minecart output.
 */
import { BLOCKS_BY_NAME } from '../data';
import { blockIdOf, blockNameOf, getProp, withProp } from '../world/blockstate';

export interface RailHost {
  getState(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number, flags?: number): void;
  hasNeighborSignal(x: number, y: number, z: number): boolean;
  updateNeighborsAt(x: number, y: number, z: number, fromBlock: number): void;
}

const RAIL_IDS = new Set(['rail', 'powered_rail', 'detector_rail', 'activator_rail'].map((n) => BLOCKS_BY_NAME.get(n)?.id ?? -1));
const PLAIN_RAIL = BLOCKS_BY_NAME.get('rail')?.id ?? -1;

export function isRailState(s: number): boolean {
  return RAIL_IDS.has(blockIdOf(s));
}

type P = [number, number, number];

/** connections of a shape relative to the rail (RailState.updateConnections) */
function connectionsOf(x: number, y: number, z: number, shape: string): P[] {
  const n: P = [x, y, z - 1], s: P = [x, y, z + 1], w: P = [x - 1, y, z], e: P = [x + 1, y, z];
  const up = (p: P): P => [p[0], p[1] + 1, p[2]];
  switch (shape) {
    case 'north_south': return [n, s];
    case 'east_west': return [w, e];
    case 'ascending_east': return [w, up(e)];
    case 'ascending_west': return [up(w), e];
    case 'ascending_north': return [up(n), s];
    case 'ascending_south': return [n, up(s)];
    case 'south_east': return [e, s];
    case 'south_west': return [w, s];
    case 'north_west': return [w, n];
    case 'north_east': return [e, n];
    default: return [];
  }
}

/** RailState */
export class RailState {
  connections: P[];
  readonly straight: boolean;
  constructor(private readonly h: RailHost, readonly x: number, readonly y: number, readonly z: number, public state: number) {
    this.straight = blockIdOf(state) !== PLAIN_RAIL;
    this.connections = connectionsOf(x, y, z, getProp(state, 'shape') as string);
  }

  private isRail(x: number, y: number, z: number): boolean {
    return y >= 0 && y <= 255 && isRailState(this.h.getState(x, y, z));
  }

  private getRail(p: P): RailState | null {
    const [x, y, z] = p;
    for (const yy of [y, y + 1, y - 1]) if (this.isRail(x, yy, z)) return new RailState(this.h, x, yy, z, this.h.getState(x, yy, z));
    return null;
  }

  private hasRail(p: P): boolean {
    return this.isRail(p[0], p[1], p[2]) || this.isRail(p[0], p[1] + 1, p[2]) || this.isRail(p[0], p[1] - 1, p[2]);
  }

  private connected(r: RailState): boolean {
    return this.hasConnection(r.x, r.z);
  }

  private hasConnection(x: number, z: number): boolean {
    return this.connections.some((c) => c[0] === x && c[2] === z);
  }

  removeSoftConnections(): void {
    this.connections = this.connections.filter((c) => {
      const r = this.getRail(c);
      return r !== null && r.connected(this);
    });
  }

  countPotentialConnections(): number {
    let i = 0;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) if (this.hasRail([this.x + dx, this.y, this.z + dz])) i++;
    return i;
  }

  canConnectTo(r: RailState): boolean {
    return this.connected(r) || this.connections.length !== 2;
  }

  private slope(shape: string | null): string | null {
    const { x, y, z } = this;
    if (shape === 'north_south') {
      if (this.isRail(x, y + 1, z - 1)) shape = 'ascending_north';
      if (this.isRail(x, y + 1, z + 1)) shape = 'ascending_south';
    }
    if (shape === 'east_west') {
      if (this.isRail(x + 1, y + 1, z)) shape = 'ascending_east';
      if (this.isRail(x - 1, y + 1, z)) shape = 'ascending_west';
    }
    return shape;
  }

  connectTo(r: RailState): void {
    this.connections.push([r.x, r.y, r.z]);
    const { x, z } = this;
    const n = this.hasConnection(x, z - 1), s = this.hasConnection(x, z + 1), w = this.hasConnection(x - 1, z), e = this.hasConnection(x + 1, z);
    let shape: string | null = null;
    if (n || s) shape = 'north_south';
    if (w || e) shape = 'east_west';
    if (!this.straight) {
      if (s && e && !n && !w) shape = 'south_east';
      if (s && w && !n && !e) shape = 'south_west';
      if (n && w && !s && !e) shape = 'north_west';
      if (n && e && !s && !w) shape = 'north_east';
    }
    shape = this.slope(shape) ?? 'north_south';
    this.state = withProp(this.state, 'shape', shape);
    this.h.setBlock(this.x, this.y, this.z, this.state, 3);
  }

  private hasNeighborRail(p: P): boolean {
    const r = this.getRail(p);
    if (!r) return false;
    r.removeSoftConnections();
    return r.canConnectTo(this);
  }

  /** RailState.place(powered, alwaysPlace, shape) */
  place(powered: boolean, alwaysPlace: boolean, current: string): RailState {
    const { x, y, z } = this;
    const n = this.hasNeighborRail([x, y, z - 1]), s = this.hasNeighborRail([x, y, z + 1]);
    const w = this.hasNeighborRail([x - 1, y, z]), e = this.hasNeighborRail([x + 1, y, z]);
    let shape: string | null = null;
    const ns = n || s, ew = w || e;
    if (ns && !ew) shape = 'north_south';
    if (ew && !ns) shape = 'east_west';
    const se = s && e, sw = s && w, ne = n && e, nw = n && w;
    if (!this.straight) {
      if (se && !n && !w) shape = 'south_east';
      if (sw && !n && !e) shape = 'south_west';
      if (nw && !s && !e) shape = 'north_west';
      if (ne && !s && !w) shape = 'north_east';
    }
    if (shape === null) {
      if (ns && ew) shape = current;
      else if (ns) shape = 'north_south';
      else if (ew) shape = 'east_west';
      if (!this.straight) {
        if (powered) {
          if (se) shape = 'south_east';
          if (sw) shape = 'south_west';
          if (ne) shape = 'north_east';
          if (nw) shape = 'north_west';
        } else {
          if (nw) shape = 'north_west';
          if (ne) shape = 'north_east';
          if (sw) shape = 'south_west';
          if (se) shape = 'south_east';
        }
      }
    }
    shape = this.slope(shape) ?? current;
    this.connections = connectionsOf(x, y, z, shape);
    const ns2 = withProp(this.state, 'shape', shape);
    if (alwaysPlace || this.h.getState(x, y, z) !== ns2) {
      this.state = ns2;
      this.h.setBlock(x, y, z, ns2, 3);
      for (const c of this.connections) {
        const r = this.getRail(c);
        if (!r) continue;
        r.removeSoftConnections();
        if (r.canConnectTo(this)) r.connectTo(this);
      }
    }
    this.state = ns2;
    return this;
  }
}

/** BaseRailBlock.onPlace (old state of another block): updateDir, then the powered-rail check. */
export function railPlaced(h: RailHost, x: number, y: number, z: number): void {
  const s = h.getState(x, y, z);
  if (!isRailState(s)) return;
  new RailState(h, x, y, z, s).place(h.hasNeighborSignal(x, y, z), true, getProp(s, 'shape') as string);
  const after = h.getState(x, y, z);
  if (isRailState(after) && blockIdOf(after) !== PLAIN_RAIL) railNeighborChanged(h, x, y, z, after, -1);
}

/** BaseRailBlock.neighborChanged → updateState (survival is handled by the host). */
export function railNeighborChanged(h: RailHost, x: number, y: number, z: number, s: number, fromBlock: number): void {
  const n = blockNameOf(s);
  if (n === 'rail') {
    // RailBlock.updateState: re-shape on a signal-source change at a 3-way junction
    if (fromBlock >= 0 && isSignalSourceBlock(fromBlock) && new RailState(h, x, y, z, s).countPotentialConnections() === 3) {
      new RailState(h, x, y, z, s).place(h.hasNeighborSignal(x, y, z), false, getProp(s, 'shape') as string);
    }
    return;
  }
  if (n === 'powered_rail' || n === 'activator_rail') {
    const was = getProp(s, 'powered') === true;
    const now = h.hasNeighborSignal(x, y, z) || findPoweredRailSignal(h, x, y, z, s, true, 0) || findPoweredRailSignal(h, x, y, z, s, false, 0);
    if (now !== was) {
      h.setBlock(x, y, z, withProp(s, 'powered', now), 3);
      h.updateNeighborsAt(x, y - 1, z, blockIdOf(s));
      if ((getProp(s, 'shape') as string).startsWith('ascending')) h.updateNeighborsAt(x, y + 1, z, blockIdOf(s));
    }
  }
}

const SIGNAL_SOURCES = new Set<number>();
for (const [n, b] of BLOCKS_BY_NAME) {
  if (['redstone_wire', 'redstone_torch', 'redstone_wall_torch', 'lever', 'redstone_block', 'repeater', 'comparator', 'observer', 'daylight_detector', 'target', 'trapped_chest', 'detector_rail', 'tripwire_hook'].includes(n) ||
    n.endsWith('_button') || n.endsWith('_pressure_plate')) SIGNAL_SOURCES.add(b.id);
}
function isSignalSourceBlock(id: number): boolean {
  return SIGNAL_SOURCES.has(id);
}

/** PoweredRailBlock.findPoweredRailSignal */
export function findPoweredRailSignal(h: RailHost, x: number, y: number, z: number, s: number, forward: boolean, depth: number): boolean {
  if (depth >= 8) return false;
  let i = x, j = y, k = z, flag = true;
  let shape = getProp(s, 'shape') as string;
  switch (shape) {
    case 'north_south': if (forward) k++; else k--; break;
    case 'east_west': if (forward) i--; else i++; break;
    case 'ascending_east':
      if (forward) i--;
      else { i++; j++; flag = false; }
      shape = 'east_west';
      break;
    case 'ascending_west':
      if (forward) { i--; j++; flag = false; }
      else i++;
      shape = 'east_west';
      break;
    case 'ascending_north':
      if (forward) k++;
      else { k--; j++; flag = false; }
      shape = 'north_south';
      break;
    case 'ascending_south':
      if (forward) { k++; j++; flag = false; }
      else k--;
      shape = 'north_south';
      break;
  }
  if (isSameRailWithPower(h, blockIdOf(s), i, j, k, forward, depth, shape)) return true;
  return flag && isSameRailWithPower(h, blockIdOf(s), i, j - 1, k, forward, depth, shape);
}

function isSameRailWithPower(h: RailHost, block: number, x: number, y: number, z: number, forward: boolean, depth: number, shape: string): boolean {
  if (y < 0 || y > 255) return false;
  const s = h.getState(x, y, z);
  if (blockIdOf(s) !== block) return false;
  const o = getProp(s, 'shape') as string;
  if (shape === 'east_west' && (o === 'north_south' || o === 'ascending_north' || o === 'ascending_south')) return false;
  if (shape === 'north_south' && (o === 'east_west' || o === 'ascending_east' || o === 'ascending_west')) return false;
  if (getProp(s, 'powered') !== true) return false;
  return h.hasNeighborSignal(x, y, z) ? true : findPoweredRailSignal(h, x, y, z, s, forward, depth + 1);
}

/**
 * DetectorRailBlock.checkPressed: POWERED follows "a minecart is on the rail"; neighbours and the
 * block below are updated, and the rail re-checks itself every 20 ticks while pressed (host).
 * Returns true when still pressed (the host schedules the next check in 20 ticks).
 */
export function detectorRailCheck(h: RailHost, x: number, y: number, z: number, minecartOn: boolean): boolean {
  const s = h.getState(x, y, z);
  if (blockNameOf(s) !== 'detector_rail') return false;
  const was = getProp(s, 'powered') === true;
  if (minecartOn !== was) {
    const ns = withProp(s, 'powered', minecartOn);
    h.setBlock(x, y, z, ns, 3);
    h.updateNeighborsAt(x, y, z, blockIdOf(s));
    h.updateNeighborsAt(x, y - 1, z, blockIdOf(s));
    // RailState(...).place keeps shape; vanilla re-places the rail to refresh connections
    new RailState(h, x, y, z, ns).place(minecartOn, false, getProp(ns, 'shape') as string);
  }
  return minecartOn;
}
