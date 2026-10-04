/**
 * Server side of redstone: wires the pure engine (@shared/game/redstone) into the GameServer —
 * one engine per dimension, block ticks through BlockBehaviors' tick list, containers' analog
 * output, entities on pressure plates / arrows in wooden buttons, daylight detectors, TNT priming
 * and dispenser/dropper behaviour.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { Redstone, containerSignal, isRedstoneComponent, type RedstoneHost } from '@shared/game/redstone';
import { blockIdOf, blockNameOf, getProp } from '@shared/world/blockstate';
import { skyDarkenLevel, timeOfDay } from '@shared/world/daylight';
import { ITEMS_BY_ID } from '@shared/data';
import { primeTnt } from './explosion';
import { Mob } from './mobs/mob';
import { Arrow } from './arrow';
import { copyStack, sameItem, type ItemStack } from '@shared/item/stack';
import { dispenseSpecial, dispenseSound } from './dispense';
import { disarmTripwire, tripwireChanged, tripwireTick, wireEntityInside, type TripwireHost } from '@shared/game/tripwire';
import { FULL_COLLISION } from '@shared/world/blockinfo';
import { railPlacementState } from '@shared/game/rails';
import { detectorRailCheck, isRailState, railNeighborChanged, railPlaced, type RailHost } from '@shared/game/rails';

const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const CW: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const CCW: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };

/** blocks entities trigger by standing in them (Entity.checkInsideBlocks → entityInside) */
function triggersOnEntity(n: string): boolean {
  return n.endsWith('_pressure_plate') || (n.endsWith('_button') && n !== 'stone_button' && n !== 'polished_blackstone_button');
}

export class ServerRedstone {
  private readonly engines = new Map<string, Redstone>();
  /** daylight detectors known per dimension (placed while the server runs, or seen in a block update) */
  private readonly detectors = new Map<string, Set<string>>();

  private readonly host: RedstoneHost;
  private readonly railHost: RailHost;
  private readonly wireHost: TripwireHost;
  /**
   * Minecart presence test for detector rails (DetectorRailBlock.checkPressed box x+0.2..0.8,
   * y..y+0.8): set by the minecart module; until then no rail is ever pressed.
   */
  minecartAt: ((minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boolean) | null = null;

  constructor(private readonly s: GameServer) {
    this.host = this.makeHost();
    this.railHost = {
      getState: (x, y, z) => (y < 0 || y > 255 ? 0 : s.world.getState(x, y, z)),
      setBlock: (x, y, z, st, flags) => s.setBlock(x, y, z, st, flags),
      hasNeighborSignal: (x, y, z) => this.rs.hasNeighborSignal(x, y, z),
      updateNeighborsAt: (x, y, z, from) => this.rs.updateNeighborsAt(x, y, z, from),
      sturdyTop: (x, y, z) => {
        if (y < 0 || y > 255) return false;
        const b = s.world.getState(x, y, z), bn = blockNameOf(b);
        if (bn === 'hopper') return true; // the hopper's rim is a rigid top face
        if (bn.endsWith('_slab')) return getProp(b, 'type') !== 'bottom';
        if (bn.endsWith('_stairs')) return getProp(b, 'half') === 'top';
        return FULL_COLLISION[b] === 1;
      },
      dropAndRemove: (x, y, z) => s.blocks.breakNaturally(x, y, z, false),
    };
    this.wireHost = {
      getState: (x, y, z) => (y < 0 || y > 255 ? 0 : s.world.getState(x, y, z)),
      setBlock: (x, y, z, st, flags) => s.setBlock(x, y, z, st, flags),
      scheduleTick: (x, y, z, st, delay) => s.blocks.scheduleTick(x, y, z, st, delay, 0),
      updateNeighborsAt: (x, y, z, from) => this.rs.updateNeighborsAt(x, y, z, from),
      entitiesIn: (x0, y0, z0, x1, y1, z1) => this.countEntities(x0, y0, z0, x1, y1, z1, 'all') > 0,
      playSound: (event, x, y, z, volume, pitch) => {
        try {
          s.playSound(null, event, 'block', x, y, z, volume, pitch);
        } catch {
          /* missing sound */
        }
      },
    };
  }

  /** TripWireBlock.playerWillDestroy with shears */
  disarmTripwire(x: number, y: number, z: number): void {
    disarmTripwire(this.wireHost, x, y, z);
  }

  /** DetectorRailBlock.checkPressed: re-checks every 20 ticks while a minecart is on it. */
  private checkDetectorRail(x: number, y: number, z: number): void {
    const on = this.minecartAt?.(x + 0.2, y, z + 0.2, x + 0.8, y + 0.8, z + 0.8) ?? false;
    const st = this.s.world.getState(x, y, z);
    if (detectorRailCheck(this.railHost, x, y, z, on)) this.s.blocks.scheduleTick(x, y, z, st, 20, 0);
    this.rs.updateNeighbourForOutputSignal(x, y, z, blockIdOf(st));
  }

  /** DetectorRailBlock.entityInside: a minecart entered the rail (call from the minecart tick). */
  minecartOnRail(x: number, y: number, z: number): void {
    const st = this.s.world.getState(x, y, z);
    if (blockNameOf(st) === 'detector_rail' && getProp(st, 'powered') !== true) this.checkDetectorRail(x, y, z);
  }

  /** The engine of the dimension being ticked / handled. */
  get rs(): Redstone {
    const id = this.s.level?.id ?? 'overworld';
    let e = this.engines.get(id);
    if (!e) this.engines.set(id, (e = new Redstone(this.host)));
    return e;
  }

  private get detectorSet(): Set<string> {
    const id = this.s.level?.id ?? 'overworld';
    let d = this.detectors.get(id);
    if (!d) this.detectors.set(id, (d = new Set()));
    return d;
  }

  private makeHost(): RedstoneHost {
    const s = this.s;
    const self = this;
    return {
      getState: (x, y, z) => (y < 0 || y > 255 ? 0 : s.world.getState(x, y, z)),
      setBlock: (x, y, z, st, flags) => s.setBlock(x, y, z, st, flags),
      scheduleTick: (x, y, z, st, delay, prio) => s.blocks.scheduleTick(x, y, z, st, delay, prio),
      hasScheduledTick: (x, y, z, st) => s.blocks.blockTicks.has(x, y, z, blockIdOf(st)),
      willTickThisTick: (x, y, z, st) => s.blocks.blockTicks.willTickThisTick(s.gameTime, x, y, z, blockIdOf(st)),
      gameTime: () => s.gameTime,
      analogOutput: (x, y, z, st) => self.containerOutput(x, y, z, st),
      chestViewers: (x, y, z) => self.chestViewers(x, y, z),
      playSound: (event, x, y, z, volume, pitch) => {
        try {
          s.playSound(null, event, 'block', x, y, z, volume, pitch);
        } catch {
          // sound event missing from the registry: stay silent
        }
      },
      levelEvent: (event, x, y, z) => {
        if (event === 1502) {
          // LevelRenderer: REDSTONE_TORCH_BURNOUT fizz
          const r = s.rand;
          try {
            s.playSound(null, 'block.redstone_torch.burnout', 'block', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + (r.nextFloat() - r.nextFloat()) * 0.8);
          } catch {
            /* missing sound */
          }
        }
      },
      dropAndRemove: (x, y, z) => s.blocks.breakNaturally(x, y, z, false),
      primeTnt: (x, y, z) => void primeTnt(s, x, y, z),
      dispense: (x, y, z, st) => self.dispense(x, y, z, st),
      hasBlockEntity: (x, y, z) => !!s.containers.blockEntity(x, y, z),
      countEntities: (x0, y0, z0, x1, y1, z1, kind) => self.countEntities(x0, y0, z0, x1, y1, z1, kind),
      neighborChangedOther: (x, y, z, st, from) => self.neighborChangedOther(x, y, z, st, from),
      daylight: (x, y, z) => {
        if (!s.level?.type.hasSkyLight) return null;
        return { sky: s.world.getLight(x, y, z) >> 4, darken: skyDarkenLevel(s.dayTime, s.rainLevel, s.thunderLevel * s.rainLevel), sunAngle: Math.fround(timeOfDay(s.dayTime) * Math.PI * 2) };
      },
    } satisfies RedstoneHost;
  }

  // ------------------------------------------------------------------ hooks from GameServer / BlockBehaviors
  /** GameServer.setBlock, after the raw write. */
  onBlockChanged(x: number, y: number, z: number, old: number, st: number, flags: number): void {
    const n = blockNameOf(st);
    if (n === 'daylight_detector') this.detectorSet.add(`${x},${y},${z}`);
    this.rs.onBlockChanged(x, y, z, old, st, flags);
    // HopperBlock.onPlace: block entity + checkPoweredState
    if (n === 'tripwire' || n === 'tripwire_hook' || blockNameOf(old) === 'tripwire' || blockNameOf(old) === 'tripwire_hook') tripwireChanged(this.wireHost, x, y, z, old, st);
    // BaseRailBlock.onPlace: connect to neighbouring rails, then the power check
    if (isRailState(st) && blockIdOf(old) !== blockIdOf(st)) railPlaced(this.railHost, x, y, z);
    if (n === 'hopper' && blockNameOf(old) !== 'hopper') {
      this.s.containers.ensureItems(x, y, z, 'hopper', 5);
      this.s.hoppers.checkPowered(x, y, z);
    }
  }

  /** neighborChanged of host-owned blocks (hoppers). */
  private neighborChangedOther(x: number, y: number, z: number, st: number, fromBlock: number): void {
    if (blockNameOf(st) === 'hopper') this.s.hoppers.checkPowered(x, y, z);
    else if (isRailState(st)) railNeighborChanged(this.railHost, x, y, z, st, fromBlock);
  }

  /** Scheduled block tick; true when it was a redstone block. */
  tick(x: number, y: number, z: number, st: number): boolean {
    const tn = blockNameOf(st);
    if (tn === 'tripwire' || tn === 'tripwire_hook') return tripwireTick(this.wireHost, x, y, z, st);
    if (!isRedstoneComponent(st)) return false;
    if (blockNameOf(st) === 'detector_rail') {
      if (getProp(st, 'powered') === true) this.checkDetectorRail(x, y, z);
      return true;
    }
    return this.rs.tick(x, y, z, st);
  }

  /** Right click (BlockState.use). */
  use(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const mayBuild = p.gameMode === 0 || p.gameMode === 1;
    if (this.rs.use(x, y, z, mayBuild)) return true;
    if (mayBuild && blockNameOf(this.s.world.getState(x, y, z)) === 'redstone_wire') return this.rs.wireUse(x, y, z);
    return false;
  }

  /** getStateForPlacement adjustments, then setPlacedBy after the block is in the world. */
  placementState(x: number, y: number, z: number, st: number, yaw = 0): number {
    if (isRailState(st)) return railPlacementState(st, yaw);
    return isRedstoneComponent(st) ? this.rs.placementState(x, y, z, st) : st;
  }
  placed(x: number, y: number, z: number): void {
    const n = blockNameOf(this.s.world.getState(x, y, z));
    if (n === 'repeater' || n === 'comparator') this.rs.diodePlaced(x, y, z);
  }

  /** A container's contents changed (BlockEntity.setChanged → updateNeighbourForOutputSignal). */
  containerChanged(x: number, y: number, z: number): void {
    const st = this.s.world.getState(x, y, z);
    this.rs.updateNeighbourForOutputSignal(x, y, z, blockIdOf(st));
  }

  /** Trapped chest viewer count changed: both halves signal (TrappedChestBlockEntity.signalOpenCount). */
  chestViewersChanged(x: number, y: number, z: number): void {
    const st = this.s.world.getState(x, y, z);
    if (blockNameOf(st) !== 'trapped_chest') return;
    this.rs.chestViewersChanged(x, y, z);
    const o = this.otherChestHalf(x, y, z, st);
    if (o) this.rs.chestViewersChanged(o[0], y, o[1]);
  }

  /** Per-level tick: entities on plates / arrows in wooden buttons, daylight detectors every 20 ticks. */
  tickLevel(): void {
    const s = this.s;
    const touch = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => {
      const e = 1e-7;
      for (let x = Math.floor(minX + e); x <= Math.floor(maxX - e); x++)
        for (let y = Math.floor(minY + e); y <= Math.floor(maxY - e); y++)
          for (let z = Math.floor(minZ + e); z <= Math.floor(maxZ - e); z++) {
            if (y < 0 || y > 255) continue;
            const st = s.world.getState(x, y, z);
            if (st !== 0 && triggersOnEntity(blockNameOf(st))) this.rs.entityInside(x, y, z);
            else if (st !== 0 && blockNameOf(st) === 'tripwire') wireEntityInside(this.wireHost, x, y, z);
          }
    };
    for (const p of s.players) {
      if (p.gameMode === 3 || p.living.dead) continue;
      const h = p.pose === 'crouching' ? 1.5 : p.pose === 'swimming' ? 0.6 : 1.8;
      touch(p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + h, p.z + 0.3);
    }
    for (const e of s.entities.values()) {
      const b = e.bb();
      touch(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    }
    if (s.gameTime % 20 === 0) {
      const set = this.detectorSet;
      for (const k of set) {
        const [x, y, z] = k.split(',').map(Number) as [number, number, number];
        if (!s.world.isLoaded(x, z)) continue;
        const st = s.world.getState(x, y, z);
        if (blockNameOf(st) !== 'daylight_detector') {
          set.delete(k);
          continue;
        }
        this.rs.daylightUpdate(x, y, z, st);
      }
    }
    // ServerLevel.runBlockEvents: piston pushes and pulls
    this.rs.runBlockEvents();
  }

  // ------------------------------------------------------------------ host helpers
  private countEntities(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: 'living' | 'all' | 'arrow'): number {
    const s = this.s;
    let n = 0;
    const hit = (a0: number, b0: number, c0: number, a1: number, b1: number, c1: number) => a1 > x0 && a0 < x1 && b1 > y0 && b0 < y1 && c1 > z0 && c0 < z1;
    if (kind !== 'arrow') {
      for (const p of s.players) {
        if (p.gameMode === 3 || p.living.dead) continue;
        const h = p.pose === 'crouching' ? 1.5 : p.pose === 'swimming' ? 0.6 : 1.8;
        if (hit(p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + h, p.z + 0.3)) n++;
      }
    }
    for (const e of s.entities.values()) {
      if (kind === 'living' && !(e instanceof Mob)) continue;
      if (kind === 'arrow' && !(e instanceof Arrow)) continue;
      const b = e.bb();
      if (hit(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ)) n++;
    }
    return n;
  }

  private otherChestHalf(x: number, y: number, z: number, st: number): [number, number] | null {
    const type = getProp(st, 'type');
    if (type !== 'left' && type !== 'right') return null;
    const f = getProp(st, 'facing') as string;
    // ChestBlock.getConnectedDirection: LEFT → clockwise, RIGHT → counter-clockwise
    const d = DIRS.indexOf(type === 'left' ? CW[f]! : CCW[f]!);
    const ox = x + DX[d]!, oz = z + DZ[d]!;
    const o = this.s.world.getState(ox, y, oz);
    return blockNameOf(o) === blockNameOf(st) ? [ox, oz] : null;
  }

  private chestViewers(x: number, y: number, z: number): number {
    return this.s.containers.viewerCount(x, y, z);
  }

  /** AbstractContainerMenu.getRedstoneSignalFromBlockEntity for item containers (double chests combined). */
  private containerOutput(x: number, y: number, z: number, st: number): number | null {
    const n = blockNameOf(st);
    const itemsAt = (px: number, pz: number) => (this.s.containers.blockEntity(px, y, pz)?.items as (ItemStack | null)[] | undefined) ?? null;
    let items = itemsAt(x, z);
    if (n === 'chest' || n === 'trapped_chest') {
      const o = this.otherChestHalf(x, y, z, st);
      items = [...(items ?? new Array(27).fill(null)), ...(o ? (itemsAt(o[0], o[1]) ?? new Array(27).fill(null)) : [])];
    }
    if (!items || items.length === 0) return 0;
    return containerSignal(items, (id) => ITEMS_BY_ID[id]?.stackSize ?? 64);
  }

  /** DispenserBlock / DropperBlock.dispenseFrom: a random non-empty slot, default behaviour drops one item. */
  private dispense(x: number, y: number, z: number, st: number): void {
    const s = this.s;
    const be = s.containers.blockEntity(x, y, z);
    const items = be?.items as (ItemStack | null)[] | undefined;
    // DispenserBlockEntity.getRandomSlot
    let slot = -1;
    let j = 1;
    if (items) for (let k = 0; k < items.length; k++) if (items[k] && items[k]!.count > 0 && s.rand.nextInt(j++) === 0) slot = k;
    if (slot < 0 || !items) {
      // levelEvent 1001: dispenser fail click
      try {
        s.playSound(null, 'block.dispenser.fail', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1.2);
      } catch {
        /* missing sound */
      }
      return;
    }
    const stack = items[slot]!;
    const d = DIRS.indexOf(getProp(st, 'facing') as string);
    if (blockNameOf(st) === 'dropper') {
      // DropperBlock: into a container in front, else drop it
      const fx = x + DX[d]!, fy = y + DY[d]!, fz = z + DZ[d]!;
      const target = s.containers.blockEntity(fx, fy, fz)?.items as (ItemStack | null)[] | undefined;
      if (target) {
        for (let i = 0; i < target.length; i++) {
          const t = target[i];
          const max = Math.min(64, ITEMS_BY_ID[stack.id]?.stackSize ?? 64);
          if (!t || t.count <= 0) {
            target[i] = { ...copyStack(stack), count: 1 };
          } else if (t.count < max && sameItem(t, stack)) {
            t.count++;
          } else continue;
          stack.count--;
          if (stack.count <= 0) items[slot] = null;
          this.containerChanged(fx, fy, fz);
          this.containerChanged(x, y, z);
          return;
        }
        return;
      }
    }
    if (blockNameOf(st) === 'dispenser') {
      // DispenserBlock.getDispenseMethod: item-specific behaviours (dispense.ts)
      const r = dispenseSpecial(s, x, y, z, d, stack);
      if (r) {
        if (r.ok) {
          if (r.replace === undefined) {
            stack.count--;
            if (stack.count <= 0) items[slot] = null;
          } else if (stack.count <= 1) items[slot] = r.replace;
          else {
            stack.count--;
            const rep = r.replace;
            if (rep) {
              const free = items.findIndex((it) => !it || it.count <= 0);
              if (free >= 0) items[free] = rep;
              else s.spawnItem(x + 0.5 + 0.7 * DX[d]!, y + 0.5 + 0.7 * DY[d]!, z + 0.5 + 0.7 * DZ[d]!, rep, DX[d]! * 0.2, DY[d]! * 0.2, DZ[d]! * 0.2);
            }
          }
          this.containerChanged(x, y, z);
        }
        dispenseSound(s, x, y, z, r);
        return;
      }
    }
    // DefaultDispenseItemBehavior: one item flies out of the face
    const one: ItemStack = { ...copyStack(stack), count: 1 };
    stack.count--;
    if (stack.count <= 0) items[slot] = null;
    const px = x + 0.5 + 0.7 * DX[d]!, pz = z + 0.5 + 0.7 * DZ[d]!;
    const py = y + 0.5 + 0.7 * DY[d]! - (d <= 1 ? 0.125 : 0.15625);
    const r = s.rand;
    const sp = r.nextDouble() * 0.1 + 0.2;
    s.spawnItem(px, py, pz, one, r.nextGaussian() * 0.0075 * 6 + DX[d]! * sp, r.nextGaussian() * 0.0075 * 6 + DY[d]! * sp, r.nextGaussian() * 0.0075 * 6 + DZ[d]! * sp);
    try {
      // levelEvent 1000 (dispense click) and 2000 (smoke)
      s.playSound(null, 'block.dispenser.dispense', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    } catch {
      /* missing sound */
    }
    this.containerChanged(x, y, z);
  }
}
