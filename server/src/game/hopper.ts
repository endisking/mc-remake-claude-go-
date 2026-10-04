/**
 * Hopper transfers (vanilla HopperBlockEntity.pushItemsTick / tryMoveItems / ejectItems /
 * suckInItems): an 8-game-tick cooldown, one item pushed into the container the hopper faces and
 * one pulled from the container above (or whole item entities from the suck area), nothing while
 * powered (ENABLED=false), double chests as one compound container and furnace face rules
 * (WorldlyContainer: top → input, sides → fuel, bottom ← result/empty bucket).
 */
import type { GameServer } from './server';
import { ItemEntity } from './entity';
import { blockNameOf, getProp, withProp } from '@shared/world/blockstate';
import { ITEMS_BY_ID, ITEMS_BY_NAME } from '@shared/data';
import { copyStack, isEmpty, sameItem, type ItemStack } from '@shared/item/stack';
import { chestPartner, isChest, isFirstHalf } from '@shared/game/chest';
import { isFuel } from '@shared/menu/smelting';
import type { BlockEntityData } from '@shared/world/chunk';

const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);
const STORAGE = new Set(['barrel', 'dispenser', 'dropper', 'hopper']);
const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];

export interface HopperData extends BlockEntityData {
  items: (ItemStack | null)[];
  /** HopperBlockEntity.cooldownTime / tickedGameTime */
  transferCooldown?: number;
  tickedGameTime?: number;
}

/** A container as hoppers see it: flat slot list over one or more block entities. */
interface HContainer {
  slot: (i: number) => ItemStack | null;
  set: (i: number, s: ItemStack | null) => void;
  size: number;
  kind: 'furnace' | 'storage';
  /** the hopper's own block entity when the container is a hopper */
  hopper: HopperData | null;
  changed: () => void;
}

const maxStack = (s: ItemStack) => Math.min(64, ITEMS_BY_ID[s.id]?.stackSize ?? 64);
const BUCKET = ITEMS_BY_NAME.get('bucket')?.id ?? -1;
const WATER_BUCKET = ITEMS_BY_NAME.get('water_bucket')?.id ?? -1;

export class Hoppers {
  constructor(private readonly s: GameServer) {}

  /** HopperBlock.checkPoweredState: ENABLED = !hasNeighborSignal (flag 4: no neighbour updates). */
  checkPowered(x: number, y: number, z: number): void {
    const st = this.s.world.getState(x, y, z);
    if (blockNameOf(st) !== 'hopper') return;
    const enabled = !this.s.redstone.rs.hasNeighborSignal(x, y, z);
    if (getProp(st, 'enabled') !== enabled) this.s.setBlock(x, y, z, withProp(st, 'enabled', enabled), 4);
  }

  /** HopperBlockEntity.pushItemsTick */
  tick(x: number, y: number, z: number, be: HopperData): void {
    be.transferCooldown = (be.transferCooldown ?? 0) - 1;
    be.tickedGameTime = this.s.gameTime;
    if (be.transferCooldown > 0) return;
    be.transferCooldown = 0;
    this.tryMoveItems(x, y, z, be);
  }

  private tryMoveItems(x: number, y: number, z: number, be: HopperData): boolean {
    const st = this.s.world.getState(x, y, z);
    if ((be.transferCooldown ?? 0) > 0 || getProp(st, 'enabled') === false) return false;
    const self = this.selfContainer(x, y, z, be);
    let moved = false;
    if (be.items.some((i) => !isEmpty(i))) moved = this.eject(x, y, z, st, self);
    if (!be.items.every((i) => !isEmpty(i) && i.count >= maxStack(i))) moved = this.suckIn(x, y, z, self) || moved;
    if (moved) {
      be.transferCooldown = 8;
      self.changed();
      return true;
    }
    return false;
  }

  private selfContainer(x: number, y: number, z: number, be: HopperData): HContainer {
    return {
      slot: (i) => be.items[i] ?? null,
      set: (i, v) => void (be.items[i] = v),
      size: 5,
      kind: 'storage',
      hopper: be,
      changed: () => this.changed(x, y, z),
    };
  }

  private changed(x: number, y: number, z: number): void {
    const c = this.s.world.getChunk(x >> 4, z >> 4);
    if (c) c.version++;
    this.s.markChunkDirty(x >> 4, z >> 4);
    this.s.redstone.containerChanged(x, y, z);
  }

  /** HopperBlockEntity.getContainerAt (block containers; double chests combined). */
  containerAt(x: number, y: number, z: number): HContainer | null {
    if (y < 0 || y > 255) return null;
    const st = this.s.world.getState(x, y, z);
    const n = blockNameOf(st);
    const be = this.s.containers.blockEntity(x, y, z);
    const itemsOf = (b: BlockEntityData | undefined, size: number): (ItemStack | null)[] | null => {
      if (!b) return null;
      if (!Array.isArray(b.items)) b.items = new Array(size).fill(null);
      return b.items as (ItemStack | null)[];
    };
    if (FURNACES.has(n)) {
      const items = itemsOf(be, 3);
      if (!items) return null;
      return { slot: (i) => items[i] ?? null, set: (i, v) => void (items[i] = v), size: 3, kind: 'furnace', hopper: null, changed: () => this.changed(x, y, z) };
    }
    if (isChest(n) && n !== 'ender_chest') {
      const own = this.s.containers.ensureItems(x, y, z, 'chest', 27);
      const p = chestPartner(this.s.world, x, y, z);
      if (!p) return { slot: (i) => own[i] ?? null, set: (i, v) => void (own[i] = v), size: 27, kind: 'storage', hopper: null, changed: () => this.changed(x, y, z) };
      const other = this.s.containers.ensureItems(p[0], p[1], p[2], 'chest', 27);
      const [a, b] = isFirstHalf(st) ? [own, other] : [other, own];
      return {
        slot: (i) => (i < 27 ? a[i] : b[i - 27]) ?? null,
        set: (i, v) => void (i < 27 ? (a[i] = v) : (b[i - 27] = v)),
        size: 54,
        kind: 'storage',
        hopper: null,
        changed: () => {
          this.changed(x, y, z);
          this.changed(p[0], p[1], p[2]);
        },
      };
    }
    if (STORAGE.has(n) || n === 'shulker_box' || n.endsWith('_shulker_box')) {
      const size = n === 'hopper' ? 5 : n === 'dispenser' || n === 'dropper' ? 9 : 27;
      const id = n.endsWith('shulker_box') ? 'shulker_box' : n;
      const items = this.s.containers.ensureItems(x, y, z, id, size);
      return { slot: (i) => items[i] ?? null, set: (i, v) => void (items[i] = v), size, kind: 'storage', hopper: n === 'hopper' ? (this.s.containers.blockEntity(x, y, z) as HopperData) : null, changed: () => this.changed(x, y, z) };
    }
    return null;
  }

  /** WorldlyContainer.getSlotsForFace (AbstractFurnaceBlockEntity) or every slot. */
  private slotsFor(c: HContainer, face: number): number[] {
    if (c.kind === 'furnace') return face === 0 ? [2, 1] : face === 1 ? [0] : [1];
    return Array.from({ length: c.size }, (_, i) => i);
  }

  /** canPlaceItem(Through)Face */
  private canPlace(c: HContainer, stack: ItemStack, slot: number): boolean {
    if (c.kind !== 'furnace') return true;
    if (slot === 2) return false;
    if (slot !== 1) return true;
    const fuel = c.slot(1);
    return isFuel(stack.id) || (stack.id === BUCKET && (isEmpty(fuel) || fuel.id !== BUCKET));
  }

  /** canTakeItemThroughFace: the fuel slot only gives up (water) buckets downwards. */
  private canTake(c: HContainer, stack: ItemStack, slot: number, face: number): boolean {
    if (c.kind !== 'furnace' || face !== 0 || slot !== 1) return true;
    return stack.id === WATER_BUCKET || stack.id === BUCKET;
  }

  /** HopperBlockEntity.addItem(source, destination, stack, direction): what is left over. */
  addItem(source: HContainer | null, dest: HContainer, stack: ItemStack, face: number | null): ItemStack | null {
    const slots = face === null ? Array.from({ length: dest.size }, (_, i) => i) : this.slotsFor(dest, face);
    let left: ItemStack | null = stack;
    for (const i of slots) {
      if (isEmpty(left)) break;
      left = this.tryMoveInItem(source, dest, left, i);
    }
    return isEmpty(left) ? null : left;
  }

  private tryMoveInItem(source: HContainer | null, dest: HContainer, stack: ItemStack, slot: number): ItemStack | null {
    const cur = dest.slot(slot);
    if (!this.canPlace(dest, stack, slot)) return stack;
    let moved = false;
    const wasEmpty = this.allEmpty(dest);
    if (isEmpty(cur)) {
      dest.set(slot, stack);
      stack = { ...stack, count: 0 };
      moved = true;
    } else if (sameItem(cur, stack) && cur.count < maxStack(cur)) {
      const k = Math.min(stack.count, maxStack(cur) - cur.count);
      stack.count -= k;
      cur.count += k;
      moved = k > 0;
    }
    if (moved) {
      if (wasEmpty && dest.hopper) {
        const h = dest.hopper;
        if ((h.transferCooldown ?? 0) <= 0) {
          let k = 0;
          if (source?.hopper && (h.tickedGameTime ?? 0) >= (source.hopper.tickedGameTime ?? 0)) k = 1;
          h.transferCooldown = 8 - k;
        }
      }
      dest.changed();
    }
    return stack.count <= 0 ? null : stack;
  }

  private allEmpty(c: HContainer): boolean {
    for (let i = 0; i < c.size; i++) if (!isEmpty(c.slot(i))) return false;
    return true;
  }

  /** ejectItems: one item into the attached container. */
  private eject(x: number, y: number, z: number, st: number, self: HContainer): boolean {
    const f = DIRS.indexOf(getProp(st, 'facing') as string);
    const dest = this.containerAt(x + DX[f]!, y + DY[f]!, z + DZ[f]!);
    if (!dest) return false;
    const face = OPP[f]!;
    // isFullContainer
    if (this.slotsFor(dest, face).every((i) => {
      const s = dest.slot(i);
      return !isEmpty(s) && s.count >= maxStack(s);
    })) return false;
    for (let i = 0; i < self.size; i++) {
      const s = self.slot(i);
      if (isEmpty(s)) continue;
      const backup = copyStack(s);
      const one: ItemStack = { ...copyStack(s), count: 1 };
      s.count--;
      if (s.count <= 0) self.set(i, null);
      const rest = this.addItem(self, dest, one, face);
      if (isEmpty(rest)) {
        dest.changed();
        return true;
      }
      self.set(i, backup);
    }
    return false;
  }

  /** suckInItems: one item from the container above, else whole item entities in the suck area. */
  private suckIn(x: number, y: number, z: number, self: HContainer): boolean {
    const src = this.containerAt(x, y + 1, z);
    if (src) {
      const slots = this.slotsFor(src, 0);
      if (slots.every((i) => isEmpty(src.slot(i)))) return false;
      for (const i of slots) {
        const s = src.slot(i);
        if (isEmpty(s) || !this.canTake(src, s, i, 0)) continue;
        const backup = copyStack(s);
        const one: ItemStack = { ...copyStack(s), count: 1 };
        s.count--;
        if (s.count <= 0) src.set(i, null);
        const rest = this.addItem(src, self, one, null);
        if (isEmpty(rest)) {
          src.changed();
          return true;
        }
        src.set(i, backup);
      }
      return false;
    }
    // Hopper.SUCK: the bowl (2..14, 11..16, 2..14 px) and the block above
    for (const e of this.s.entities.values()) {
      if (!(e instanceof ItemEntity) || e.removed || isEmpty(e.stack)) continue;
      const b = e.bb();
      const inBowl = b.maxX > x + 0.125 && b.minX < x + 0.875 && b.maxZ > z + 0.125 && b.minZ < z + 0.875 && b.maxY > y + 0.6875 && b.minY < y + 1;
      const above = b.maxX > x && b.minX < x + 1 && b.maxZ > z && b.minZ < z + 1 && b.maxY > y + 1 && b.minY < y + 2;
      if (!inBowl && !above) continue;
      const rest = this.addItem(null, self, copyStack(e.stack), null);
      if (isEmpty(rest)) {
        e.removed = true;
        return true;
      }
      if (rest.count !== e.stack.count) e.stack = rest;
    }
    return false;
  }
}
