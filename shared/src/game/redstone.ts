/**
 * Redstone (vanilla 1.17.1): the signal model of Level (getSignal / getDirectSignal /
 * hasNeighborSignal / getBestNeighborSignal), neighbour and shape updates in vanilla order, and the
 * redstone components as BlockBehaviour methods (onPlace, onRemove, neighborChanged, updateShape,
 * tick, use).
 *
 * The engine is pure: it reads and writes the world through a {@link RedstoneHost}, which must call
 * {@link Redstone.onBlockChanged} from its setBlock (after the raw write) the way Level.setBlock
 * calls onRemove/onPlace, updateNeighborsAt (flag 1) and updateNeighbourShapes (unless flag 16),
 * and {@link Redstone.tick} for scheduled ticks of the blocks this module owns.
 *
 * Implemented: redstone dust (RedStoneWireBlock incl. its HashSet update order), redstone torches
 * (2-tick delay, burnout), levers, buttons, pressure plates (all four), redstone block, repeaters
 * (delay, locking), comparators (compare/subtract, analog inputs), observers, daylight detectors,
 * target blocks, trapped chests, redstone lamps, TNT, iron/wooden doors, trapdoors, fence gates,
 * note blocks, dispensers/droppers (triggering; what they dispense is the host's job).
 */
import { BLOCKS_BY_NAME, BLOCK_STATE_COUNT, BLOCKS } from '../data';
import { blockIdOf, blockNameOf, getProp, withProp } from '../world/blockstate';
import { FULL_COLLISION } from '../world/blockinfo';

// --------------------------------------------------------------------------- directions
/** Direction.values(): DOWN, UP, NORTH, SOUTH, WEST, EAST (3D data value order). */
export const D = { DOWN: 0, UP: 1, NORTH: 2, SOUTH: 3, WEST: 4, EAST: 5 } as const;
export const DIR_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];
/** Direction.Plane.HORIZONTAL: NORTH, EAST, SOUTH, WEST */
const HORIZONTAL = [2, 5, 3, 4];
/** Level.updateNeighborsAt order: WEST, EAST, DOWN, UP, NORTH, SOUTH */
const NEIGHBOR_ORDER = [4, 5, 0, 1, 2, 3];
/** BlockBehaviour.UPDATE_SHAPE_ORDER: WEST, EAST, NORTH, SOUTH, DOWN, UP */
const SHAPE_ORDER = [4, 5, 2, 3, 0, 1];
const CLOCKWISE = [0, 1, 5, 4, 2, 3]; // N→E, S→W, W→N, E→S
const COUNTER_CLOCKWISE = [0, 1, 4, 5, 3, 2];
const dirIndex = (name: string) => DIR_NAMES.indexOf(name as (typeof DIR_NAMES)[number]);

/** Level.setBlock flags */
export const UPDATE_NEIGHBORS = 1;
export const UPDATE_CLIENTS = 2;
export const UPDATE_KNOWN_SHAPE = 16;
export const UPDATE_ALL = 3;

/** TickPriority */
const PRIO = { EXTREMELY_HIGH: -3, VERY_HIGH: -2, HIGH: -1, NORMAL: 0 };

export interface RedstoneHost {
  getState(x: number, y: number, z: number): number;
  /** Level.setBlock(pos, state, flags); must call Redstone.onBlockChanged after the raw write. */
  setBlock(x: number, y: number, z: number, state: number, flags: number): void;
  scheduleTick(x: number, y: number, z: number, state: number, delay: number, priority: number): void;
  hasScheduledTick(x: number, y: number, z: number, state: number): boolean;
  willTickThisTick(x: number, y: number, z: number, state: number): boolean;
  gameTime(): number;
  /** Block-entity analog output (containers, jukebox, lectern…) or null when the block has none there. */
  analogOutput?(x: number, y: number, z: number, state: number): number | null;
  /** Item frame analog output on the block (getItemFrame), or null. */
  itemFrameOutput?(x: number, y: number, z: number, facing: number): number | null;
  /** number of open viewers of a trapped chest */
  chestViewers?(x: number, y: number, z: number): number;
  playSound?(event: string, x: number, y: number, z: number, volume: number, pitch: number): void;
  levelEvent?(event: number, x: number, y: number, z: number, data: number): void;
  /** Block.dropResources + removeBlock */
  dropAndRemove?(x: number, y: number, z: number): void;
  /** TntBlock.explode (spawn primed TNT) */
  primeTnt?(x: number, y: number, z: number): void;
  /** DispenserBlock.dispenseFrom */
  dispense?(x: number, y: number, z: number, state: number): void;
  /** entities touching the box (pressure plates / wooden buttons): mobs only, all, or arrows */
  countEntities?(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, kind: 'living' | 'all' | 'arrow'): number;
  /** sky light at pos (0–15), sky darkening and the sun angle (daylight detector) */
  daylight?(x: number, y: number, z: number): { sky: number; darken: number; sunAngle: number } | null;
}

// --------------------------------------------------------------------------- block tables
const enum K {
  NONE = 0,
  WIRE,
  TORCH,
  WALL_TORCH,
  LEVER,
  BUTTON,
  PLATE,
  WEIGHTED_PLATE,
  REDSTONE_BLOCK,
  REPEATER,
  COMPARATOR,
  OBSERVER,
  DAYLIGHT,
  TARGET,
  TRAPPED_CHEST,
  LAMP,
  TNT,
  DOOR,
  TRAPDOOR,
  FENCE_GATE,
  NOTE_BLOCK,
  DISPENSER,
}

const BLOCK_COUNT = BLOCKS.length;
const KIND = new Uint8Array(BLOCK_COUNT + 1);
/** per block id: wooden (arrow-sensitive, 30 tick) button / wooden plate (all entities) */
const SENSITIVE = new Uint8Array(BLOCK_COUNT + 1);
/** weighted plate max weight */
const MAX_WEIGHT = new Uint16Array(BLOCK_COUNT + 1);
/** isRedstoneConductor per state */
const CONDUCTOR = new Uint8Array(BLOCK_STATE_COUNT);
/** isFaceSturdy(UP) per state (RedStoneWireBlock.canSurviveOn also allows hoppers) */
const STURDY_TOP = new Uint8Array(BLOCK_STATE_COUNT);
/** analog-output blocks whose output comes from the state */
const STATE_ANALOG = new Uint8Array(BLOCK_COUNT + 1);
/** analog-output blocks with block entities */
const BE_ANALOG = new Uint8Array(BLOCK_COUNT + 1);

const id = (n: string) => BLOCKS_BY_NAME.get(n)?.id ?? -1;
const WIRE_ID = id('redstone_wire');
const REPEATER_ID = id('repeater');
const COMPARATOR_ID = id('comparator');
const OBSERVER_ID = id('observer');
const HOPPER_ID = id('hopper');
const REDSTONE_BLOCK_ID = id('redstone_block');

for (const b of BLOCKS) {
  const n = b.name;
  let k = K.NONE;
  if (n === 'redstone_wire') k = K.WIRE;
  else if (n === 'redstone_torch') k = K.TORCH;
  else if (n === 'redstone_wall_torch') k = K.WALL_TORCH;
  else if (n === 'lever') k = K.LEVER;
  else if (n.endsWith('_button')) {
    k = K.BUTTON;
    SENSITIVE[b.id] = n === 'stone_button' || n === 'polished_blackstone_button' ? 0 : 1;
  } else if (n === 'light_weighted_pressure_plate' || n === 'heavy_weighted_pressure_plate') {
    k = K.WEIGHTED_PLATE;
    MAX_WEIGHT[b.id] = n.startsWith('light') ? 15 : 150;
  } else if (n.endsWith('_pressure_plate')) {
    k = K.PLATE;
    // Sensitivity.EVERYTHING for wooden plates, MOBS for stone / polished blackstone
    SENSITIVE[b.id] = n === 'stone_pressure_plate' || n === 'polished_blackstone_pressure_plate' ? 0 : 1;
  } else if (n === 'redstone_block') k = K.REDSTONE_BLOCK;
  else if (n === 'repeater') k = K.REPEATER;
  else if (n === 'comparator') k = K.COMPARATOR;
  else if (n === 'observer') k = K.OBSERVER;
  else if (n === 'daylight_detector') k = K.DAYLIGHT;
  else if (n === 'target') k = K.TARGET;
  else if (n === 'trapped_chest') k = K.TRAPPED_CHEST;
  else if (n === 'redstone_lamp') k = K.LAMP;
  else if (n === 'tnt') k = K.TNT;
  else if (n.endsWith('_door')) k = K.DOOR;
  else if (n.endsWith('_trapdoor')) k = K.TRAPDOOR;
  else if (n.endsWith('_fence_gate')) k = K.FENCE_GATE;
  else if (n === 'note_block') k = K.NOTE_BLOCK;
  else if (n === 'dispenser' || n === 'dropper') k = K.DISPENSER;
  KIND[b.id] = k;
  if (n === 'cake' || n.endsWith('candle_cake') || n === 'composter' || n === 'water_cauldron' || n === 'lava_cauldron' || n === 'powder_snow_cauldron' || n === 'cauldron' ||
    n === 'end_portal_frame' || n === 'respawn_anchor' || n === 'beehive' || n === 'bee_nest') STATE_ANALOG[b.id] = 1;
  if (n === 'chest' || n === 'trapped_chest' || n === 'barrel' || n === 'furnace' || n === 'blast_furnace' || n === 'smoker' || n === 'hopper' || n === 'dispenser' ||
    n === 'dropper' || n === 'brewing_stand' || n.endsWith('shulker_box') || n === 'jukebox' || n === 'lectern' || n === 'chiseled_bookshelf') BE_ANALOG[b.id] = 1;
}

/** Blocks with isRedstoneConductor(never) or a non-solid-blocking material despite a full cube. */
function neverConducts(n: string): boolean {
  return n === 'glass' || n === 'tinted_glass' || n.endsWith('_stained_glass') || n.endsWith('_leaves') || n === 'ice' || n === 'frosted_ice' || n === 'glowstone' ||
    n === 'sea_lantern' || n === 'beacon' || n === 'redstone_block' || n === 'observer' || n === 'piston' || n === 'sticky_piston' || n === 'tnt' || n === 'barrier' ||
    n === 'spawner' || n.endsWith('shulker_box') || n === 'scaffolding' || n === 'powder_snow';
}
for (let s = 0; s < BLOCK_STATE_COUNT; s++) {
  const n = blockNameOf(s);
  CONDUCTOR[s] = (FULL_COLLISION[s] === 1 && !neverConducts(n)) || n === 'soul_sand' ? 1 : 0;
  let top = FULL_COLLISION[s] === 1;
  if (n.endsWith('_slab')) top = getProp(s, 'type') !== 'bottom';
  else if (n.endsWith('_stairs')) top = getProp(s, 'half') === 'top';
  else if (n === 'soul_sand' || n === 'farmland' || n === 'dirt_path' || n === 'honey_block') top = true;
  STURDY_TOP[s] = top ? 1 : 0;
}

/** isFaceSturdy for a horizontal face: full blocks only (stairs/slab sides are approximated as not). */
const sturdySide = (s: number) => FULL_COLLISION[s] === 1;

export function isRedstoneConductor(state: number): boolean {
  return CONDUCTOR[state] === 1;
}

const kindOf = (state: number) => KIND[blockIdOf(state)]!;

/** BlockState.isSignalSource */
export function isSignalSource(state: number): boolean {
  const k = kindOf(state);
  return k === K.WIRE || k === K.TORCH || k === K.WALL_TORCH || k === K.LEVER || k === K.BUTTON || k === K.PLATE || k === K.WEIGHTED_PLATE || k === K.REDSTONE_BLOCK ||
    k === K.REPEATER || k === K.COMPARATOR || k === K.OBSERVER || k === K.DAYLIGHT || k === K.TARGET || k === K.TRAPPED_CHEST;
}

/** Whether a block id takes part in redstone at all (cheap filter for hosts). */
export function isRedstoneComponent(state: number): boolean {
  return kindOf(state) !== K.NONE;
}

const isDiode = (s: number) => {
  const b = blockIdOf(s);
  return b === REPEATER_ID || b === COMPARATOR_ID;
};
const num = (s: number, p: string) => getProp(s, p) as number;
const bool = (s: number, p: string) => getProp(s, p) === true;
const facing = (s: number) => dirIndex(getProp(s, 'facing') as string);

/** Vec3i.hashCode → HashMap bucket in a 16-bucket table (HashMap.hash spreads the high bits). */
function bucketOf(x: number, y: number, z: number): number {
  const h = (Math.imul(y + Math.imul(z, 31), 31) + x) | 0;
  return (h ^ (h >>> 16)) & 15;
}

interface Toggle {
  x: number;
  y: number;
  z: number;
  when: number;
}

export class Redstone {
  /** RedStoneWireBlock.shouldSignal (false while the wire measures its own input) */
  private shouldSignal = true;
  /** RedstoneTorchBlock.RECENT_TOGGLES (per level) */
  readonly recentToggles: Toggle[] = [];
  /** ComparatorBlockEntity.output by position key */
  readonly comparatorOutput = new Map<string, number>();

  constructor(readonly h: RedstoneHost) {}

  private st(x: number, y: number, z: number): number {
    return this.h.getState(x, y, z);
  }

  // ======================================================================= signal model
  /** BlockState.getSignal(level, pos, dir): weak power the block at pos emits toward -dir. */
  blockSignal(s: number, x: number, y: number, z: number, dir: number): number {
    switch (kindOf(s)) {
      case K.WIRE:
        return this.wireSignal(s, x, y, z, dir);
      case K.TORCH:
        return bool(s, 'lit') && dir !== D.UP ? 15 : 0;
      case K.WALL_TORCH:
        return bool(s, 'lit') && facing(s) !== dir ? 15 : 0;
      case K.LEVER:
      case K.BUTTON:
        return bool(s, 'powered') ? 15 : 0;
      case K.PLATE:
        return bool(s, 'powered') ? 15 : 0;
      case K.WEIGHTED_PLATE:
      case K.DAYLIGHT:
      case K.TARGET:
        return num(s, 'power');
      case K.REDSTONE_BLOCK:
        return 15;
      case K.REPEATER:
      case K.COMPARATOR:
        if (!bool(s, 'powered')) return 0;
        return facing(s) === dir ? this.diodeOutput(s, x, y, z) : 0;
      case K.OBSERVER:
        return bool(s, 'powered') && facing(s) === dir ? 15 : 0;
      case K.TRAPPED_CHEST:
        return Math.max(0, Math.min(15, this.h.chestViewers?.(x, y, z) ?? 0));
      default:
        return 0;
    }
  }

  /** BlockState.getDirectSignal: strong power. */
  blockDirectSignal(s: number, x: number, y: number, z: number, dir: number): number {
    switch (kindOf(s)) {
      case K.WIRE:
        return this.shouldSignal ? this.blockSignal(s, x, y, z, dir) : 0;
      case K.TORCH:
        return dir === D.DOWN ? this.blockSignal(s, x, y, z, dir) : 0;
      case K.WALL_TORCH:
        return dir === D.DOWN ? this.blockSignal(s, x, y, z, dir) : 0;
      case K.LEVER:
      case K.BUTTON:
        return bool(s, 'powered') && connectedDirection(s) === dir ? 15 : 0;
      case K.PLATE:
      case K.WEIGHTED_PLATE:
        return dir === D.UP ? this.blockSignal(s, x, y, z, dir) : 0;
      case K.REPEATER:
      case K.COMPARATOR:
      case K.OBSERVER:
        return this.blockSignal(s, x, y, z, dir);
      case K.TRAPPED_CHEST:
        return dir === D.UP ? this.blockSignal(s, x, y, z, dir) : 0;
      default:
        return 0;
    }
  }

  /** Level.getSignal(pos, dir) */
  getSignal(x: number, y: number, z: number, dir: number): number {
    const s = this.st(x, y, z);
    const i = this.blockSignal(s, x, y, z, dir);
    return CONDUCTOR[s] ? Math.max(i, this.getDirectSignalTo(x, y, z)) : i;
  }

  hasSignal(x: number, y: number, z: number, dir: number): boolean {
    return this.getSignal(x, y, z, dir) > 0;
  }

  /** Level.getDirectSignal(pos, dir) */
  getDirectSignal(x: number, y: number, z: number, dir: number): number {
    return this.blockDirectSignal(this.st(x, y, z), x, y, z, dir);
  }

  /** Level.getDirectSignalTo: strongest strong power into pos (D, U, N, S, W, E). */
  getDirectSignalTo(x: number, y: number, z: number): number {
    let i = 0;
    for (let d = 0; d < 6; d++) {
      i = Math.max(i, this.getDirectSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d));
      if (i >= 15) return i;
    }
    return i;
  }

  /** Level.hasNeighborSignal */
  hasNeighborSignal(x: number, y: number, z: number): boolean {
    for (let d = 0; d < 6; d++) if (this.getSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d) > 0) return true;
    return false;
  }

  /** Level.getBestNeighborSignal */
  getBestNeighborSignal(x: number, y: number, z: number): number {
    let i = 0;
    for (let d = 0; d < 6; d++) {
      const j = this.getSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d);
      if (j >= 15) return 15;
      if (j > i) i = j;
    }
    return i;
  }

  // ======================================================================= update plumbing
  /** Level.updateNeighborsAt(pos, block): neighborChanged on the six neighbours (W, E, D, U, N, S). */
  updateNeighborsAt(x: number, y: number, z: number, fromBlock: number): void {
    for (const d of NEIGHBOR_ORDER) this.neighborChanged(x + DX[d]!, y + DY[d]!, z + DZ[d]!, fromBlock, x, y, z);
  }

  /** Level.updateNeighborsAtExceptFromFacing */
  updateNeighborsAtExceptFromFacing(x: number, y: number, z: number, fromBlock: number, skip: number): void {
    for (const d of NEIGHBOR_ORDER) if (d !== skip) this.neighborChanged(x + DX[d]!, y + DY[d]!, z + DZ[d]!, fromBlock, x, y, z);
  }

  /**
   * Hook for the host's setBlock, after the raw write: onRemove(old) / onPlace(new), then
   * neighbour updates (flag 1, plus comparators for analog blocks) and shape updates (no flag 16).
   */
  onBlockChanged(x: number, y: number, z: number, old: number, state: number, flags: number): void {
    if (old === state) return;
    const oldBlock = blockIdOf(old), newBlock = blockIdOf(state);
    if (KIND[oldBlock]) this.onRemove(x, y, z, old, state);
    if (KIND[newBlock] && this.st(x, y, z) === state) this.onPlace(x, y, z, state, old);
    if (flags & UPDATE_NEIGHBORS) {
      this.updateNeighborsAt(x, y, z, oldBlock);
      if (this.hasAnalogOutput(state)) this.updateNeighbourForOutputSignal(x, y, z, newBlock);
    }
    if (!(flags & UPDATE_KNOWN_SHAPE)) {
      if (oldBlock === WIRE_ID) this.wireIndirectShapes(x, y, z, old);
      this.neighbourShapes(x, y, z);
      if (newBlock === WIRE_ID && this.st(x, y, z) === state) this.wireIndirectShapes(x, y, z, state);
    }
  }

  /** BlockState.updateNeighbourShapes: each neighbour's updateShape(dir toward pos). */
  private neighbourShapes(x: number, y: number, z: number): void {
    for (const d of SHAPE_ORDER) {
      const nx = x + DX[d]!, ny = y + DY[d]!, nz = z + DZ[d]!;
      const ns = this.st(nx, ny, nz);
      const k = kindOf(ns);
      if (k === K.WIRE || k === K.REPEATER || k === K.OBSERVER) this.updateShape(nx, ny, nz, ns, OPP[d]!);
    }
  }

  /** updateShape for redstone blocks, `dir` pointing from the block to the changed neighbour. */
  updateShape(x: number, y: number, z: number, s: number, dir: number): void {
    const k = kindOf(s);
    let ns = s;
    if (k === K.WIRE) ns = this.wireUpdateShape(x, y, z, s, dir);
    else if (k === K.REPEATER) {
      // RepeaterBlock.updateShape: side changes refresh LOCKED
      const f = facing(s);
      if (dir !== D.DOWN && dir !== D.UP && dir !== f && dir !== OPP[f]) ns = withProp(s, 'locked', this.isLocked(x, y, z, s));
    } else if (k === K.OBSERVER) {
      // ObserverBlock.updateShape: the watched face changed
      if (facing(s) === dir && !bool(s, 'powered')) this.observerStartSignal(x, y, z, s);
    }
    if (ns !== s) this.h.setBlock(x, y, z, ns, UPDATE_CLIENTS);
  }

  /** Level.updateNeighbourForOutputSignal: comparators beside pos, or behind a conductor beside it. */
  updateNeighbourForOutputSignal(x: number, y: number, z: number, fromBlock: number): void {
    for (const d of HORIZONTAL) {
      let px = x + DX[d]!, pz = z + DZ[d]!;
      let s = this.st(px, y, pz);
      if (blockIdOf(s) === COMPARATOR_ID) this.neighborChanged(px, y, pz, fromBlock, x, y, z);
      else if (CONDUCTOR[s]) {
        px += DX[d]!;
        pz += DZ[d]!;
        s = this.st(px, y, pz);
        if (blockIdOf(s) === COMPARATOR_ID) this.neighborChanged(px, y, pz, fromBlock, x, y, z);
      }
    }
  }

  hasAnalogOutput(s: number): boolean {
    const b = blockIdOf(s);
    return STATE_ANALOG[b] === 1 || BE_ANALOG[b] === 1;
  }

  /** BlockState.getAnalogOutputSignal */
  analogOutput(x: number, y: number, z: number, s: number): number {
    const n = blockNameOf(s);
    if (BE_ANALOG[blockIdOf(s)]) return this.h.analogOutput?.(x, y, z, s) ?? 0;
    if (n === 'cake') return (7 - num(s, 'bites')) * 2;
    if (n.endsWith('candle_cake')) return 14;
    if (n === 'composter') return num(s, 'level');
    if (n === 'water_cauldron' || n === 'powder_snow_cauldron') return num(s, 'level');
    if (n === 'lava_cauldron') return 3;
    if (n === 'end_portal_frame') return bool(s, 'eye') ? 15 : 0;
    if (n === 'respawn_anchor') return Math.floor((num(s, 'charges') / 4) * 15);
    if (n === 'beehive' || n === 'bee_nest') return num(s, 'honey_level');
    return 0;
  }

  // ======================================================================= dispatch
  private onPlace(x: number, y: number, z: number, s: number, old: number): void {
    const sameBlock = blockIdOf(old) === blockIdOf(s);
    switch (kindOf(s)) {
      case K.WIRE:
        if (sameBlock) return;
        this.updatePowerStrength(x, y, z, s);
        for (const d of [D.DOWN, D.UP]) this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, WIRE_ID);
        this.updateNeighborsOfNeighboringWires(x, y, z);
        return;
      case K.TORCH:
      case K.WALL_TORCH:
        // RedstoneTorchBlock.onPlace: every neighbour of every neighbour
        for (let d = 0; d < 6; d++) this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, blockIdOf(s));
        return;
      case K.REPEATER:
      case K.COMPARATOR:
        this.updateNeighborsInFront(x, y, z, s);
        return;
      case K.OBSERVER:
        if (!sameBlock && bool(s, 'powered') && !this.h.hasScheduledTick(x, y, z, s)) {
          const ns = withProp(s, 'powered', false);
          this.h.setBlock(x, y, z, ns, 18);
          this.updateNeighborsInFront(x, y, z, ns);
        }
        return;
      case K.TARGET:
        if (!sameBlock && num(s, 'power') > 0 && !this.h.hasScheduledTick(x, y, z, s)) this.h.setBlock(x, y, z, withProp(s, 'power', 0), 18);
        return;
      case K.TNT:
        if (!sameBlock && this.hasNeighborSignal(x, y, z)) this.explodeTnt(x, y, z);
        return;
      case K.REDSTONE_BLOCK:
        // PoweredBlock has no onPlace; Level.setBlock's own neighbour update powers the surroundings
        return;
      default:
        return;
    }
  }

  private onRemove(x: number, y: number, z: number, s: number, ns: number): void {
    const sameBlock = blockIdOf(ns) === blockIdOf(s);
    if (sameBlock) return;
    const b = blockIdOf(s);
    switch (kindOf(s)) {
      case K.WIRE:
        for (let d = 0; d < 6; d++) this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, b);
        this.updatePowerStrength(x, y, z, s);
        this.updateNeighborsOfNeighboringWires(x, y, z);
        return;
      case K.TORCH:
      case K.WALL_TORCH:
        for (let d = 0; d < 6; d++) this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, b);
        return;
      case K.LEVER:
      case K.BUTTON:
        if (bool(s, 'powered')) this.attachedUpdate(x, y, z, s);
        return;
      case K.PLATE:
        if (bool(s, 'powered')) this.plateNeighbours(x, y, z, b);
        return;
      case K.WEIGHTED_PLATE:
        if (num(s, 'power') > 0) this.plateNeighbours(x, y, z, b);
        return;
      case K.REPEATER:
      case K.COMPARATOR:
        this.updateNeighborsInFront(x, y, z, s);
        if (b === COMPARATOR_ID) this.comparatorOutput.delete(`${x},${y},${z}`);
        return;
      case K.OBSERVER:
        if (bool(s, 'powered') && this.h.hasScheduledTick(x, y, z, s)) this.updateNeighborsInFront(x, y, z, withProp(s, 'powered', false));
        return;
      default:
        return;
    }
  }

  /** BlockState.neighborChanged on the block at (x, y, z), notified by `fromBlock` at (fx, fy, fz). */
  neighborChanged(x: number, y: number, z: number, fromBlock: number, _fx: number, _fy: number, _fz: number): void {
    if (y < 0 || y > 255) return;
    const s = this.st(x, y, z);
    const k = kindOf(s);
    if (k === K.NONE) return;
    switch (k) {
      case K.WIRE:
        if (this.canSurviveOnBelow(x, y, z)) this.updatePowerStrength(x, y, z, s);
        else this.h.dropAndRemove?.(x, y, z);
        return;
      case K.TORCH:
      case K.WALL_TORCH:
        if (bool(s, 'lit') === this.torchHasNeighborSignal(x, y, z, s) && !this.h.willTickThisTick(x, y, z, s)) this.h.scheduleTick(x, y, z, s, 2, PRIO.NORMAL);
        return;
      case K.REPEATER:
      case K.COMPARATOR:
        if (!this.canSurviveOnBelow(x, y, z)) {
          this.h.dropAndRemove?.(x, y, z);
          for (let d = 0; d < 6; d++) this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, blockIdOf(s));
          return;
        }
        if (k === K.REPEATER) this.repeaterCheckTick(x, y, z, s);
        else this.comparatorCheckTick(x, y, z, s);
        return;
      case K.LAMP: {
        const lit = bool(s, 'lit');
        if (lit !== this.hasNeighborSignal(x, y, z)) {
          if (lit) this.h.scheduleTick(x, y, z, s, 4, PRIO.NORMAL);
          else this.h.setBlock(x, y, z, withProp(s, 'lit', true), UPDATE_CLIENTS);
        }
        return;
      }
      case K.TNT:
        if (this.hasNeighborSignal(x, y, z)) this.explodeTnt(x, y, z);
        return;
      case K.DOOR: {
        if (fromBlock === blockIdOf(s)) return;
        const lower = getProp(s, 'half') === 'lower';
        const flag = this.hasNeighborSignal(x, y, z) || this.hasNeighborSignal(x, y + (lower ? 1 : -1), z);
        if (flag !== bool(s, 'powered')) {
          if (flag !== bool(s, 'open')) this.openSound(s, x, y, z, flag);
          const ns = withProp(withProp(s, 'powered', flag), 'open', flag);
          this.h.setBlock(x, y, z, ns, UPDATE_CLIENTS);
          // DoorBlock.updateShape copies OPEN/POWERED into the other half
          const oy = lower ? y + 1 : y - 1;
          const other = this.st(x, oy, z);
          if (blockIdOf(other) === blockIdOf(s) && getProp(other, 'half') !== getProp(s, 'half')) {
            this.h.setBlock(x, oy, z, withProp(withProp(other, 'powered', flag), 'open', flag), UPDATE_CLIENTS);
          }
        }
        return;
      }
      case K.TRAPDOOR: {
        const flag = this.hasNeighborSignal(x, y, z);
        if (flag !== bool(s, 'powered')) {
          let ns = s;
          if (bool(s, 'open') !== flag) {
            ns = withProp(ns, 'open', flag);
            this.openSound(s, x, y, z, flag);
          }
          this.h.setBlock(x, y, z, withProp(ns, 'powered', flag), UPDATE_CLIENTS);
        }
        return;
      }
      case K.FENCE_GATE: {
        const flag = this.hasNeighborSignal(x, y, z);
        if (bool(s, 'powered') !== flag) {
          this.h.setBlock(x, y, z, withProp(withProp(s, 'powered', flag), 'open', flag), UPDATE_CLIENTS);
          if (bool(s, 'open') !== flag) this.openSound(s, x, y, z, flag);
        }
        return;
      }
      case K.NOTE_BLOCK: {
        const flag = this.hasNeighborSignal(x, y, z);
        if (flag !== bool(s, 'powered')) {
          if (flag) this.playNote(x, y, z, s);
          this.h.setBlock(x, y, z, withProp(s, 'powered', flag), UPDATE_ALL);
        }
        return;
      }
      case K.DISPENSER: {
        const flag = this.hasNeighborSignal(x, y, z) || this.hasNeighborSignal(x, y + 1, z);
        const triggered = bool(s, 'triggered');
        if (flag && !triggered) {
          this.h.scheduleTick(x, y, z, s, 4, PRIO.NORMAL);
          this.h.setBlock(x, y, z, withProp(s, 'triggered', true), 4);
        } else if (!flag && triggered) this.h.setBlock(x, y, z, withProp(s, 'triggered', false), 4);
        return;
      }
      default:
        return;
    }
  }

  /** Scheduled tick of a block this module owns; returns true when handled. */
  tick(x: number, y: number, z: number, s: number): boolean {
    switch (kindOf(s)) {
      case K.TORCH:
      case K.WALL_TORCH:
        this.torchTick(x, y, z, s);
        return true;
      case K.BUTTON:
        if (bool(s, 'powered')) {
          if (SENSITIVE[blockIdOf(s)]) this.buttonCheckPressed(x, y, z, s);
          else {
            const ns = withProp(s, 'powered', false);
            this.h.setBlock(x, y, z, ns, UPDATE_ALL);
            this.attachedUpdate(x, y, z, ns);
            this.buttonSound(x, y, z, ns, false);
          }
        }
        return true;
      case K.PLATE:
      case K.WEIGHTED_PLATE: {
        const sig = this.plateSignalForState(s);
        if (sig > 0) this.plateCheckPressed(x, y, z, s, sig);
        return true;
      }
      case K.REPEATER:
        this.repeaterTick(x, y, z, s);
        return true;
      case K.COMPARATOR:
        this.comparatorRefresh(x, y, z, s);
        return true;
      case K.OBSERVER:
        if (bool(s, 'powered')) this.h.setBlock(x, y, z, withProp(s, 'powered', false), UPDATE_CLIENTS);
        else {
          this.h.setBlock(x, y, z, withProp(s, 'powered', true), UPDATE_CLIENTS);
          this.h.scheduleTick(x, y, z, s, 2, PRIO.NORMAL);
        }
        this.updateNeighborsInFront(x, y, z, s);
        return true;
      case K.LAMP:
        if (bool(s, 'lit') && !this.hasNeighborSignal(x, y, z)) this.h.setBlock(x, y, z, withProp(s, 'lit', false), UPDATE_CLIENTS);
        return true;
      case K.TARGET:
        if (num(s, 'power') !== 0) this.h.setBlock(x, y, z, withProp(s, 'power', 0), UPDATE_ALL);
        return true;
      case K.DISPENSER:
        this.h.dispense?.(x, y, z, s);
        return true;
      default:
        return false;
    }
  }

  /** BlockState.use for redstone blocks; returns true when consumed. */
  use(x: number, y: number, z: number, mayBuild: boolean): boolean {
    const s = this.st(x, y, z);
    switch (kindOf(s)) {
      case K.LEVER: {
        const ns = withProp(s, 'powered', !bool(s, 'powered'));
        this.h.setBlock(x, y, z, ns, UPDATE_ALL);
        this.attachedUpdate(x, y, z, ns);
        this.h.playSound?.('block.lever.click', x + 0.5, y + 0.5, z + 0.5, 0.3, bool(ns, 'powered') ? 0.6 : 0.5);
        return true;
      }
      case K.BUTTON:
        if (!bool(s, 'powered')) this.press(x, y, z, s);
        return true;
      case K.REPEATER:
        if (!mayBuild) return false;
        this.h.setBlock(x, y, z, withProp(s, 'delay', (num(s, 'delay') % 4) + 1), UPDATE_ALL);
        return true;
      case K.COMPARATOR: {
        if (!mayBuild) return false;
        const ns = withProp(s, 'mode', getProp(s, 'mode') === 'compare' ? 'subtract' : 'compare');
        this.h.playSound?.('block.comparator.click', x + 0.5, y + 0.5, z + 0.5, 0.3, getProp(ns, 'mode') === 'subtract' ? 0.55 : 0.5);
        this.h.setBlock(x, y, z, ns, UPDATE_CLIENTS);
        this.comparatorRefresh(x, y, z, ns);
        return true;
      }
      case K.DAYLIGHT: {
        if (!mayBuild) return false;
        const ns = withProp(s, 'inverted', !bool(s, 'inverted'));
        this.h.setBlock(x, y, z, ns, 4);
        this.daylightUpdate(x, y, z, ns);
        return true;
      }
      default:
        return false;
    }
  }

  // ======================================================================= redstone dust
  private wireSignal(s: number, x: number, y: number, z: number, dir: number): number {
    if (!this.shouldSignal || dir === D.DOWN) return 0;
    const i = num(s, 'power');
    if (i === 0) return 0;
    if (dir === D.UP) return i;
    const cs = this.wireConnectionState(x, y, z, s);
    return getProp(cs, DIR_NAMES[OPP[dir]!]!) !== 'none' ? i : 0;
  }

  private static wirePower(s: number): number {
    return blockIdOf(s) === WIRE_ID ? num(s, 'power') : 0;
  }

  /** RedStoneWireBlock.updatePowerStrength */
  private updatePowerStrength(x: number, y: number, z: number, s: number): void {
    const i = this.calculateTargetStrength(x, y, z);
    if (num(s, 'power') === i) return;
    if (this.st(x, y, z) === s) this.h.setBlock(x, y, z, withProp(s, 'power', i), UPDATE_CLIENTS);
    // Sets.newHashSet() of pos + its six neighbours, iterated in HashMap bucket order
    const set: [number, number, number][] = [[x, y, z]];
    for (let d = 0; d < 6; d++) set.push([x + DX[d]!, y + DY[d]!, z + DZ[d]!]);
    const order = set.map((p, idx) => ({ p, idx, b: bucketOf(p[0], p[1], p[2]) }));
    order.sort((a, b) => a.b - b.b || a.idx - b.idx);
    for (const o of order) this.updateNeighborsAt(o.p[0], o.p[1], o.p[2], WIRE_ID);
  }

  /** RedStoneWireBlock.calculateTargetStrength */
  private calculateTargetStrength(x: number, y: number, z: number): number {
    this.shouldSignal = false;
    const i = this.getBestNeighborSignal(x, y, z);
    this.shouldSignal = true;
    let j = 0;
    if (i < 15) {
      const aboveConductor = CONDUCTOR[this.st(x, y + 1, z)] === 1;
      for (const d of HORIZONTAL) {
        const px = x + DX[d]!, pz = z + DZ[d]!;
        const s = this.st(px, y, pz);
        j = Math.max(j, Redstone.wirePower(s));
        if (CONDUCTOR[s] && !aboveConductor) j = Math.max(j, Redstone.wirePower(this.st(px, y + 1, pz)));
        else if (!CONDUCTOR[s]) j = Math.max(j, Redstone.wirePower(this.st(px, y - 1, pz)));
      }
    }
    return Math.max(i, j - 1);
  }

  private updateNeighborsOfNeighboringWires(x: number, y: number, z: number): void {
    for (const d of HORIZONTAL) this.checkCornerChangeAt(x + DX[d]!, y, z + DZ[d]!);
    for (const d of HORIZONTAL) {
      const px = x + DX[d]!, pz = z + DZ[d]!;
      if (CONDUCTOR[this.st(px, y, pz)]) this.checkCornerChangeAt(px, y + 1, pz);
      else this.checkCornerChangeAt(px, y - 1, pz);
    }
  }

  private checkCornerChangeAt(x: number, y: number, z: number): void {
    if (blockIdOf(this.st(x, y, z)) !== WIRE_ID) return;
    this.updateNeighborsAt(x, y, z, WIRE_ID);
    for (let d = 0; d < 6; d++) this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, WIRE_ID);
  }

  private canSurviveOnBelow(x: number, y: number, z: number): boolean {
    const b = this.st(x, y - 1, z);
    return STURDY_TOP[b] === 1 || blockIdOf(b) === HOPPER_ID;
  }

  /** RedStoneWireBlock.shouldConnectTo(state, dir) (dir −1 = null) */
  private static shouldConnectTo(s: number, dir: number): boolean {
    const b = blockIdOf(s);
    if (b === WIRE_ID) return true;
    if (b === REPEATER_ID) {
      if (dir < 0) return false;
      const f = facing(s);
      return f === dir || OPP[f] === dir;
    }
    if (b === OBSERVER_ID) return dir === facing(s);
    return isSignalSource(s) && dir >= 0;
  }

  /** RedStoneWireBlock.getConnectingSide */
  private getConnectingSide(x: number, y: number, z: number, dir: number, canClimbUp: boolean): 'up' | 'side' | 'none' {
    const px = x + DX[dir]!, pz = z + DZ[dir]!;
    const s = this.st(px, y, pz);
    if (canClimbUp) {
      const survive = STURDY_TOP[s] === 1 || blockIdOf(s) === HOPPER_ID;
      if (survive && Redstone.shouldConnectTo(this.st(px, y + 1, pz), -1)) return sturdySide(s) ? 'up' : 'side';
    }
    return !Redstone.shouldConnectTo(s, dir) && (CONDUCTOR[s] || !Redstone.shouldConnectTo(this.st(px, y - 1, pz), -1)) ? 'none' : 'side';
  }

  private getMissingConnections(x: number, y: number, z: number, s: number): number {
    const climb = !CONDUCTOR[this.st(x, y + 1, z)];
    for (const d of HORIZONTAL) {
      const p = DIR_NAMES[d]!;
      if (getProp(s, p) === 'none') s = withProp(s, p, this.getConnectingSide(x, y, z, d, climb));
    }
    return s;
  }

  /** RedStoneWireBlock.getConnectionState (dots stay dots, lone lines extend to both sides) */
  wireConnectionState(x: number, y: number, z: number, s: number): number {
    const wasDot = isDot(s);
    s = this.getMissingConnections(x, y, z, withProp(WIRE_DEFAULT, 'power', num(s, 'power')));
    if (wasDot && isDot(s)) return s;
    const n = getProp(s, 'north') !== 'none', so = getProp(s, 'south') !== 'none', e = getProp(s, 'east') !== 'none', w = getProp(s, 'west') !== 'none';
    const ns = !n && !so, ew = !e && !w;
    if (!w && ns) s = withProp(s, 'west', 'side');
    if (!e && ns) s = withProp(s, 'east', 'side');
    if (!n && ew) s = withProp(s, 'north', 'side');
    if (!so && ew) s = withProp(s, 'south', 'side');
    return s;
  }

  /** RedStoneWireBlock.getStateForPlacement */
  wirePlacementState(x: number, y: number, z: number): number {
    return this.wireConnectionState(x, y, z, WIRE_CROSS);
  }

  /** RedStoneWireBlock.updateShape */
  private wireUpdateShape(x: number, y: number, z: number, s: number, dir: number): number {
    if (dir === D.DOWN) return s;
    if (dir === D.UP) return this.wireConnectionState(x, y, z, s);
    const side = this.getConnectingSide(x, y, z, dir, !CONDUCTOR[this.st(x, y + 1, z)]);
    const p = DIR_NAMES[dir]!;
    if ((side !== 'none') === (getProp(s, p) !== 'none') && !isCross(s)) return withProp(s, p, side);
    return this.wireConnectionState(x, y, z, withProp(withProp(WIRE_CROSS, 'power', num(s, 'power')), p, side));
  }

  /** RedStoneWireBlock.updateIndirectNeighbourShapes: wires diagonally above/below a connected side. */
  private wireIndirectShapes(x: number, y: number, z: number, s: number): void {
    for (const d of HORIZONTAL) {
      if (getProp(s, DIR_NAMES[d]!) === 'none') continue;
      const px = x + DX[d]!, pz = z + DZ[d]!;
      if (blockIdOf(this.st(px, y, pz)) === WIRE_ID) continue;
      for (const dy of [-1, 1]) {
        const ds = this.st(px, y + dy, pz);
        if (blockIdOf(ds) === WIRE_ID) this.updateShape(px, y + dy, pz, ds, OPP[d]!);
      }
    }
  }

  /** Right click on dust toggles between a dot and a cross (RedStoneWireBlock.use). */
  wireUse(x: number, y: number, z: number): boolean {
    const s = this.st(x, y, z);
    if (blockIdOf(s) !== WIRE_ID) return false;
    if (!(isCross(s) || isDot(s))) return false;
    let ns = isCross(s) ? withProp(WIRE_DEFAULT, 'power', num(s, 'power')) : withProp(WIRE_CROSS, 'power', num(s, 'power'));
    ns = this.wireConnectionState(x, y, z, ns);
    if (ns === s) return false;
    this.h.setBlock(x, y, z, ns, UPDATE_ALL);
    // updatesOnShapeChange: neighbours of the changed sides
    for (const d of HORIZONTAL) {
      const p = DIR_NAMES[d]!;
      if ((getProp(s, p) !== 'none') !== (getProp(ns, p) !== 'none')) {
        const px = x + DX[d]!, pz = z + DZ[d]!;
        this.updateNeighborsAt(px, y, pz, WIRE_ID);
        this.updateNeighborsAtExceptFromFacing(px, y, pz, WIRE_ID, OPP[d]!);
      }
    }
    return true;
  }

  // ======================================================================= torches
  private torchHasNeighborSignal(x: number, y: number, z: number, s: number): boolean {
    if (kindOf(s) === K.TORCH) return this.hasSignal(x, y - 1, z, D.DOWN);
    const d = OPP[facing(s)]!;
    return this.hasSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d);
  }

  private isToggledTooFrequently(x: number, y: number, z: number, log: boolean): boolean {
    if (log) this.recentToggles.push({ x, y, z, when: this.h.gameTime() });
    let i = 0;
    for (const t of this.recentToggles) {
      if (t.x === x && t.y === y && t.z === z && ++i >= 8) return true;
    }
    return false;
  }

  private torchTick(x: number, y: number, z: number, s: number): void {
    const flag = this.torchHasNeighborSignal(x, y, z, s);
    const list = this.recentToggles;
    while (list.length && this.h.gameTime() - list[0]!.when > 60) list.shift();
    if (bool(s, 'lit')) {
      if (flag) {
        this.h.setBlock(x, y, z, withProp(s, 'lit', false), UPDATE_ALL);
        if (this.isToggledTooFrequently(x, y, z, true)) {
          this.h.levelEvent?.(1502, x, y, z, 0);
          this.h.scheduleTick(x, y, z, this.st(x, y, z), 160, PRIO.NORMAL);
        }
      }
    } else if (!flag && !this.isToggledTooFrequently(x, y, z, false)) {
      this.h.setBlock(x, y, z, withProp(s, 'lit', true), UPDATE_ALL);
    }
  }

  // ======================================================================= levers & buttons
  /** FaceAttachedHorizontalDirectionalBlock: lever/button updates itself and the block it hangs on. */
  private attachedUpdate(x: number, y: number, z: number, s: number): void {
    const b = blockIdOf(s);
    this.updateNeighborsAt(x, y, z, b);
    const d = OPP[connectedDirection(s)]!;
    this.updateNeighborsAt(x + DX[d]!, y + DY[d]!, z + DZ[d]!, b);
  }

  private press(x: number, y: number, z: number, s: number): void {
    const ns = withProp(s, 'powered', true);
    this.h.setBlock(x, y, z, ns, UPDATE_ALL);
    this.attachedUpdate(x, y, z, ns);
    this.h.scheduleTick(x, y, z, ns, SENSITIVE[blockIdOf(s)] ? 30 : 20, PRIO.NORMAL);
    this.buttonSound(x, y, z, ns, true);
  }

  private buttonSound(x: number, y: number, z: number, s: number, on: boolean): void {
    const wood = SENSITIVE[blockIdOf(s)] === 1;
    const ev = wood ? (on ? 'block.wooden_button.click_on' : 'block.wooden_button.click_off') : on ? 'block.stone_button.click_on' : 'block.stone_button.click_off';
    this.h.playSound?.(ev, x + 0.5, y + 0.5, z + 0.5, 0.3, on ? 0.6 : 0.5);
  }

  /** ButtonBlock.checkPressed (wooden buttons): arrows inside keep it pressed */
  private buttonCheckPressed(x: number, y: number, z: number, s: number): void {
    const box = buttonBox(s);
    const n = this.h.countEntities?.(x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5], 'arrow') ?? 0;
    const flag = n > 0, was = bool(s, 'powered');
    let cur = s;
    if (flag !== was) {
      cur = withProp(s, 'powered', flag);
      this.h.setBlock(x, y, z, cur, UPDATE_ALL);
      this.attachedUpdate(x, y, z, cur);
      this.buttonSound(x, y, z, cur, flag);
    }
    if (flag) this.h.scheduleTick(x, y, z, cur, 30, PRIO.NORMAL);
  }

  /** Entity.checkInsideBlocks → entityInside for plates, wooden buttons; `arrow` says what touched it. */
  entityInside(x: number, y: number, z: number): void {
    const s = this.st(x, y, z);
    const k = kindOf(s);
    if (k === K.PLATE || k === K.WEIGHTED_PLATE) {
      if (this.plateSignalForState(s) === 0) this.plateCheckPressed(x, y, z, s, 0);
    } else if (k === K.BUTTON && SENSITIVE[blockIdOf(s)] && !bool(s, 'powered')) this.buttonCheckPressed(x, y, z, s);
  }

  // ======================================================================= pressure plates
  private plateSignalForState(s: number): number {
    return kindOf(s) === K.PLATE ? (bool(s, 'powered') ? 15 : 0) : num(s, 'power');
  }

  private plateSignalStrength(x: number, y: number, z: number, s: number): number {
    // BasePressurePlateBlock.TOUCH_AABB
    const box: [number, number, number, number, number, number] = [x + 0.125, y, z + 0.125, x + 0.875, y + 0.25, z + 0.875];
    const b = blockIdOf(s);
    if (kindOf(s) === K.PLATE) return (this.h.countEntities?.(...box, SENSITIVE[b] ? 'all' : 'living') ?? 0) > 0 ? 15 : 0;
    const max = MAX_WEIGHT[b]!;
    const i = Math.min(this.h.countEntities?.(...box, 'all') ?? 0, max);
    return i > 0 ? Math.ceil(Math.fround(Math.fround(Math.min(max, i) / max) * 15)) : 0;
  }

  private plateNeighbours(x: number, y: number, z: number, b: number): void {
    this.updateNeighborsAt(x, y, z, b);
    this.updateNeighborsAt(x, y - 1, z, b);
  }

  private plateCheckPressed(x: number, y: number, z: number, s: number, signal: number): void {
    const i = this.plateSignalStrength(x, y, z, s);
    const was = signal > 0, now = i > 0;
    const b = blockIdOf(s);
    if (signal !== i) {
      const ns = kindOf(s) === K.PLATE ? withProp(s, 'powered', now) : withProp(s, 'power', i);
      this.h.setBlock(x, y, z, ns, UPDATE_CLIENTS);
      this.plateNeighbours(x, y, z, b);
    }
    const n = blockNameOf(s);
    const metal = n.includes('weighted');
    const wood = !metal && SENSITIVE[b] === 1;
    const kind = metal ? 'metal_pressure_plate' : wood ? 'wooden_pressure_plate' : 'stone_pressure_plate';
    if (!now && was) this.h.playSound?.(`block.${kind}.click_off`, x + 0.5, y + 0.1, z + 0.5, 0.3, metal ? 0.75 : 0.5);
    else if (now && !was) this.h.playSound?.(`block.${kind}.click_on`, x + 0.5, y + 0.1, z + 0.5, 0.3, metal ? 0.90000004 : 0.6);
    if (now) this.h.scheduleTick(x, y, z, this.st(x, y, z), metal ? 10 : 20, PRIO.NORMAL);
  }

  // ======================================================================= diodes
  private diodeOutput(s: number, x: number, y: number, z: number): number {
    return blockIdOf(s) === COMPARATOR_ID ? (this.comparatorOutput.get(`${x},${y},${z}`) ?? 0) : 15;
  }

  /** DiodeBlock.getInputSignal (+ ComparatorBlock analog inputs) */
  private diodeInput(x: number, y: number, z: number, s: number): number {
    const d = facing(s);
    let px = x + DX[d]!, pz = z + DZ[d]!;
    let i = this.getSignal(px, y, pz, d);
    let ps = this.st(px, y, pz);
    if (i < 15) i = Math.max(i, blockIdOf(ps) === WIRE_ID ? num(ps, 'power') : 0);
    if (blockIdOf(s) !== COMPARATOR_ID) return i;
    if (this.hasAnalogOutput(ps)) return this.analogOutput(px, y, pz, ps);
    if (i < 15 && CONDUCTOR[ps]) {
      px += DX[d]!;
      pz += DZ[d]!;
      ps = this.st(px, y, pz);
      const frame = this.h.itemFrameOutput?.(px, y, pz, d) ?? null;
      const a = this.hasAnalogOutput(ps) ? this.analogOutput(px, y, pz, ps) : null;
      if (frame !== null || a !== null) i = Math.max(frame ?? -Infinity, a ?? -Infinity);
    }
    return i;
  }

  /** DiodeBlock.getAlternateSignal: the stronger side input. */
  private alternateSignal(x: number, y: number, z: number, s: number): number {
    const f = facing(s);
    const repeater = blockIdOf(s) === REPEATER_ID;
    let best = 0;
    for (const d of [CLOCKWISE[f]!, COUNTER_CLOCKWISE[f]!]) {
      const px = x + DX[d]!, pz = z + DZ[d]!;
      const ps = this.st(px, y, pz);
      const alt = repeater ? isDiode(ps) : isSignalSource(ps);
      if (!alt) continue;
      let v: number;
      if (blockIdOf(ps) === REDSTONE_BLOCK_ID) v = 15;
      else if (blockIdOf(ps) === WIRE_ID) v = num(ps, 'power');
      else v = this.getDirectSignal(px, y, pz, d);
      best = Math.max(best, v);
    }
    return best;
  }

  isLocked(x: number, y: number, z: number, s: number): boolean {
    return blockIdOf(s) === REPEATER_ID && this.alternateSignal(x, y, z, s) > 0;
  }

  private shouldPrioritize(x: number, y: number, z: number, s: number): boolean {
    const d = OPP[facing(s)]!;
    const ns = this.st(x + DX[d]!, y, z + DZ[d]!);
    return isDiode(ns) && facing(ns) !== d;
  }

  private updateNeighborsInFront(x: number, y: number, z: number, s: number): void {
    const d = facing(s);
    const px = x - DX[d]!, py = y - DY[d]!, pz = z - DZ[d]!;
    this.neighborChanged(px, py, pz, blockIdOf(s), x, y, z);
    this.updateNeighborsAtExceptFromFacing(px, py, pz, blockIdOf(s), d);
  }

  private repeaterCheckTick(x: number, y: number, z: number, s: number): void {
    if (this.isLocked(x, y, z, s)) return;
    const on = bool(s, 'powered'), should = this.diodeInput(x, y, z, s) > 0;
    if (on !== should && !this.h.willTickThisTick(x, y, z, s)) {
      let p = PRIO.HIGH;
      if (this.shouldPrioritize(x, y, z, s)) p = PRIO.EXTREMELY_HIGH;
      else if (on) p = PRIO.VERY_HIGH;
      this.h.scheduleTick(x, y, z, s, num(s, 'delay') * 2, p);
    }
  }

  private repeaterTick(x: number, y: number, z: number, s: number): void {
    if (this.isLocked(x, y, z, s)) return;
    const on = bool(s, 'powered'), should = this.diodeInput(x, y, z, s) > 0;
    if (on && !should) this.h.setBlock(x, y, z, withProp(s, 'powered', false), UPDATE_CLIENTS);
    else if (!on) {
      this.h.setBlock(x, y, z, withProp(s, 'powered', true), UPDATE_CLIENTS);
      if (!should) this.h.scheduleTick(x, y, z, s, num(s, 'delay') * 2, PRIO.VERY_HIGH);
    }
  }

  /**
   * getStateForPlacement adjustments for a block a player places at (x, y, z): dust connections,
   * repeater LOCKED, lamp LIT.
   */
  placementState(x: number, y: number, z: number, s: number): number {
    const k = kindOf(s);
    if (k === K.WIRE) return this.wirePlacementState(x, y, z);
    if (k === K.REPEATER) return withProp(s, 'locked', this.isLocked(x, y, z, s));
    if (k === K.LAMP) return withProp(s, 'lit', this.hasNeighborSignal(x, y, z));
    return s;
  }

  /** DiodeBlock.setPlacedBy (repeaters/comparators placed by a player) */
  diodePlaced(x: number, y: number, z: number): void {
    const s = this.st(x, y, z);
    if (!isDiode(s)) return;
    if (blockIdOf(s) === REPEATER_ID) {
      const locked = this.isLocked(x, y, z, s);
      if (locked !== bool(s, 'locked')) this.h.setBlock(x, y, z, withProp(s, 'locked', locked), UPDATE_CLIENTS);
    }
    const cur = this.st(x, y, z);
    if (this.comparatorShouldTurnOn(x, y, z, cur)) this.h.scheduleTick(x, y, z, cur, 1, PRIO.NORMAL);
  }

  private comparatorShouldTurnOn(x: number, y: number, z: number, s: number): boolean {
    const i = this.diodeInput(x, y, z, s);
    if (blockIdOf(s) === REPEATER_ID) return i > 0;
    if (i === 0) return false;
    const j = this.alternateSignal(x, y, z, s);
    return i > j || (i === j && getProp(s, 'mode') === 'compare');
  }

  private comparatorCalculateOutput(x: number, y: number, z: number, s: number): number {
    const i = this.diodeInput(x, y, z, s);
    if (i === 0) return 0;
    const j = this.alternateSignal(x, y, z, s);
    if (j > i) return 0;
    return getProp(s, 'mode') === 'subtract' ? i - j : i;
  }

  private comparatorCheckTick(x: number, y: number, z: number, s: number): void {
    if (this.h.willTickThisTick(x, y, z, s)) return;
    const i = this.comparatorCalculateOutput(x, y, z, s);
    const j = this.comparatorOutput.get(`${x},${y},${z}`) ?? 0;
    if (i !== j || bool(s, 'powered') !== this.comparatorShouldTurnOn(x, y, z, s)) {
      this.h.scheduleTick(x, y, z, s, 2, this.shouldPrioritize(x, y, z, s) ? PRIO.HIGH : PRIO.NORMAL);
    }
  }

  private comparatorRefresh(x: number, y: number, z: number, s: number): void {
    const i = this.comparatorCalculateOutput(x, y, z, s);
    const key = `${x},${y},${z}`;
    const j = this.comparatorOutput.get(key) ?? 0;
    this.comparatorOutput.set(key, i);
    if (j !== i || getProp(s, 'mode') === 'compare') {
      const should = this.comparatorShouldTurnOn(x, y, z, s), on = bool(s, 'powered');
      if (on && !should) this.h.setBlock(x, y, z, withProp(s, 'powered', false), UPDATE_CLIENTS);
      else if (!on && should) this.h.setBlock(x, y, z, withProp(s, 'powered', true), UPDATE_CLIENTS);
      this.updateNeighborsInFront(x, y, z, s);
    }
  }

  // ======================================================================= observers
  private observerStartSignal(x: number, y: number, z: number, s: number): void {
    if (!this.h.hasScheduledTick(x, y, z, s)) this.h.scheduleTick(x, y, z, s, 2, PRIO.NORMAL);
  }

  // ======================================================================= daylight detector
  /** DaylightDetectorBlock.updateSignalStrength (block entity tick every 20 game ticks) */
  daylightUpdate(x: number, y: number, z: number, s: number): void {
    const l = this.h.daylight?.(x, y, z);
    if (!l) return;
    let i = l.sky - l.darken;
    let f = l.sunAngle;
    if (bool(s, 'inverted')) i = 15 - i;
    else if (i > 0) {
      const f1 = f < Math.PI ? 0 : Math.PI * 2;
      f = Math.fround(f + Math.fround((f1 - f) * 0.2));
      i = Math.round(Math.fround(i * Math.fround(Math.cos(f))));
    }
    i = Math.max(0, Math.min(15, i));
    if (num(s, 'power') !== i) this.h.setBlock(x, y, z, withProp(s, 'power', i), UPDATE_ALL);
  }

  // ======================================================================= target block
  /** TargetBlock.onProjectileHit: `hx/hy/hz` is the hit location, `face` the hit face index. */
  targetHit(x: number, y: number, z: number, hx: number, hy: number, hz: number, face: number, arrow: boolean): number {
    const s = this.st(x, y, z);
    if (kindOf(s) !== K.TARGET) return 0;
    const fx = Math.abs(hx - Math.floor(hx) - 0.5), fy = Math.abs(hy - Math.floor(hy) - 0.5), fz = Math.abs(hz - Math.floor(hz) - 0.5);
    const d = face <= 1 ? Math.max(fx, fz) : face <= 3 ? Math.max(fx, fy) : Math.max(fy, fz);
    const power = Math.max(1, Math.ceil(15 * Math.max(0, Math.min(1, (0.5 - d) / 0.5))));
    const wait = arrow ? 20 : 8;
    if (!this.h.hasScheduledTick(x, y, z, s)) {
      this.h.setBlock(x, y, z, withProp(s, 'power', power), UPDATE_ALL);
      this.h.scheduleTick(x, y, z, s, wait, PRIO.NORMAL);
    }
    return power;
  }

  // ======================================================================= misc
  /** Trapped chest viewer count changed (TrappedChestBlockEntity.signalOpenCount). */
  chestViewersChanged(x: number, y: number, z: number): void {
    const b = blockIdOf(this.st(x, y, z));
    this.updateNeighborsAt(x, y, z, b);
    this.updateNeighborsAt(x, y - 1, z, b);
  }

  private explodeTnt(x: number, y: number, z: number): void {
    this.h.primeTnt?.(x, y, z);
    this.h.setBlock(x, y, z, 0, UPDATE_ALL);
  }

  private openSound(s: number, x: number, y: number, z: number, open: boolean): void {
    const n = blockNameOf(s);
    let ev: string;
    if (n.endsWith('_fence_gate')) ev = open ? 'block.fence_gate.open' : 'block.fence_gate.close';
    else if (n.endsWith('_trapdoor')) ev = n === 'iron_trapdoor' ? (open ? 'block.iron_trapdoor.open' : 'block.iron_trapdoor.close') : open ? 'block.wooden_trapdoor.open' : 'block.wooden_trapdoor.close';
    else ev = n === 'iron_door' ? (open ? 'block.iron_door.open' : 'block.iron_door.close') : open ? 'block.wooden_door.open' : 'block.wooden_door.close';
    this.h.playSound?.(ev, x + 0.5, y + 0.5, z + 0.5, 1, 1);
  }

  /** NoteBlock.playNote: only with air above; pitch 2^((note − 12) / 12). */
  private playNote(x: number, y: number, z: number, s: number): void {
    const above = this.st(x, y + 1, z);
    if (blockNameOf(above) !== 'air' && blockNameOf(above) !== 'cave_air') return;
    const note = num(s, 'note');
    const pitch = Math.pow(2, (note - 12) / 12);
    this.h.playSound?.(`block.note_block.${getProp(s, 'instrument') as string}`, x + 0.5, y + 0.5, z + 0.5, 3, pitch);
  }
}

const WIRE_DEFAULT = (() => {
  let s = BLOCKS_BY_NAME.get('redstone_wire')!.defaultState;
  for (const p of ['north', 'east', 'south', 'west']) s = withProp(s, p, 'none');
  return withProp(s, 'power', 0);
})();
const WIRE_CROSS = (() => {
  let s = WIRE_DEFAULT;
  for (const p of ['north', 'east', 'south', 'west']) s = withProp(s, p, 'side');
  return s;
})();

function isDot(s: number): boolean {
  return getProp(s, 'north') === 'none' && getProp(s, 'south') === 'none' && getProp(s, 'east') === 'none' && getProp(s, 'west') === 'none';
}
function isCross(s: number): boolean {
  return getProp(s, 'north') !== 'none' && getProp(s, 'south') !== 'none' && getProp(s, 'east') !== 'none' && getProp(s, 'west') !== 'none';
}

/** FaceAttachedHorizontalDirectionalBlock.getConnectedDirection: CEILING → DOWN, FLOOR → UP, WALL → facing. */
function connectedDirection(s: number): number {
  const f = getProp(s, 'face');
  if (f === 'ceiling') return D.DOWN;
  if (f === 'floor') return D.UP;
  return facing(s);
}

/** ButtonBlock shapes (pressed ones are 1 pixel thinner), as block-relative boxes. */
function buttonBox(s: number): [number, number, number, number, number, number] {
  const p = bool(s, 'powered') ? 1 / 16 : 2 / 16;
  const face = getProp(s, 'face');
  const f = facing(s);
  const ns = f === D.NORTH || f === D.SOUTH;
  if (face === 'floor') return ns ? [5 / 16, 0, 6 / 16, 11 / 16, p, 10 / 16] : [6 / 16, 0, 5 / 16, 10 / 16, p, 11 / 16];
  if (face === 'ceiling') return ns ? [5 / 16, 1 - p, 6 / 16, 11 / 16, 1, 10 / 16] : [6 / 16, 1 - p, 5 / 16, 10 / 16, 1, 11 / 16];
  switch (f) {
    case D.NORTH:
      return [5 / 16, 6 / 16, 1 - p, 11 / 16, 10 / 16, 1];
    case D.SOUTH:
      return [5 / 16, 6 / 16, 0, 11 / 16, 10 / 16, p];
    case D.WEST:
      return [1 - p, 6 / 16, 5 / 16, 1, 10 / 16, 11 / 16];
    default:
      return [0, 6 / 16, 5 / 16, p, 10 / 16, 11 / 16];
  }
}

/** AbstractContainerMenu.getRedstoneSignalFromContainer */
export function containerSignal(items: readonly ({ id: number; count: number } | null | undefined)[], maxStack: (id: number) => number, containerMax = 64): number {
  let i = 0;
  let f = 0;
  for (const st of items) {
    if (!st || st.count <= 0) continue;
    f = Math.fround(f + Math.fround(st.count / Math.min(containerMax, maxStack(st.id))));
    i++;
  }
  f = Math.fround(f / items.length);
  return Math.floor(Math.fround(f * 14)) + (i > 0 ? 1 : 0);
}
