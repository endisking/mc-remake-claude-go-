/**
 * Server side of container menus: opening block menus (crafting table, chests, barrels, ender
 * chests, furnaces), applying window clicks authoritatively, syncing slots/data to the viewer,
 * block entity storage in chunks, furnace ticking and dropping contents when blocks go.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import type { C2S } from '@shared/protocol/packets';
import { encodeStacks } from '@shared/protocol/packets';
import { blockEntityKey, type BlockEntityData } from '@shared/world/chunk';
import { blockNameOf, getProp, withProp, stateOf } from '@shared/world/blockstate';
import { BLOCKS_BY_NAME } from '@shared/data';
import { FULL_COLLISION } from '@shared/world/blockinfo';
import { isEmpty, encodeTag, type ItemStack } from '@shared/item/stack';
import { EnchantmentMenu } from '@shared/menu/enchanting';
import { BrewingStandMenu, BrewingContainer } from '@shared/menu/brewing';
import { AnvilMenu } from '@shared/menu/anvil';
import { newBrewingStand, tickBrewingStand, bottleBits, type BrewingData } from '@shared/game/potions';
import { countBookshelves, grindstoneExperience } from '@shared/game/enchantments';
import { ChestMenu, CraftingMenu, DispenserMenu, ShulkerBoxMenu, StonecutterMenu, SmithingMenu, GrindstoneMenu, FurnaceMenu, HopperMenu, InventoryMenu, type Menu, type MenuPlayer, type ClickType } from '@shared/menu/menu';
import { CompoundContainer, InventoryContainer, SimpleContainer, type Container } from '@shared/menu/container';
import { FurnaceContainer, newFurnace, takeFurnaceExperience, tickFurnace, newCampfire, placeCampfireFood, tickCampfire, type CampfireData, type FurnaceData, type FurnaceKind } from '@shared/menu/furnace';
import { cookingRecipe } from '@shared/menu/smelting';
import { chestPartner, isChest, isFirstHalf } from '@shared/game/chest';
import { fillWithLoot } from '@shared/menu/chestloot';
import type { GenBlockEntity } from '@shared/worldgen/features/underground';

const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);
const TITLES: Record<string, string> = { furnace: 'Furnace', blast_furnace: 'Blast Furnace', smoker: 'Smoker' };

interface PlayerMenus {
  inventoryMenu: InventoryMenu;
  containerMenu: Menu;
  counter: number;
  /** last synced slot keys and data of containerMenu */
  lastSlots: string[];
  lastData: number[];
  /** block the open menu belongs to */
  pos: [number, number, number] | null;
}

const stackKey = (s: ItemStack | null) => (isEmpty(s) ? '' : `${s.id}:${s.count}:${s.damage}:${encodeTag(s.tag)}`);

export class Containers {
  private readonly menus = new WeakMap<ServerPlayer, PlayerMenus>();
  /** players viewing each container position (open/close sounds) */
  private readonly viewers = new Map<string, number>();

  constructor(private readonly server: GameServer) {}

  // ---------------------------------------------------------------- players
  state(p: ServerPlayer): PlayerMenus {
    let s = this.menus.get(p);
    if (!s) {
      const inv = new InventoryMenu(new InventoryContainer(p.inventory));
      s = { inventoryMenu: inv, containerMenu: inv, counter: 0, lastSlots: [], lastData: [], pos: null };
      this.menus.set(p, s);
    }
    return s;
  }

  menuPlayer(p: ServerPlayer): MenuPlayer {
    return { inventory: p.inventory, creative: p.gameMode === 1, drop: (st) => this.server.tossItem(p, st) };
  }

  private open(p: ServerPlayer, make: (id: number) => Menu, title: string, pos: [number, number, number] | null): void {
    const s = this.state(p);
    if (s.containerMenu !== s.inventoryMenu) this.closeContainer(p, true);
    s.counter = (s.counter % 100) + 1;
    const menu = make(s.counter);
    s.containerMenu = menu;
    s.pos = pos;
    this.server.send(p, { t: 'openWindow', windowId: s.counter, type: menu.type, title });
    this.sendAll(p, menu);
    s.lastSlots = menu.slots.map((sl) => stackKey(sl.getItem()));
    s.lastData = menu.data.map(() => -1);
    this.broadcastChanges(p);
  }

  /** Close the open container menu (doCloseContainer); `notify` sends the close to the client. */
  closeContainer(p: ServerPlayer, notify: boolean): void {
    const s = this.state(p);
    const m = s.containerMenu;
    if (m === s.inventoryMenu) return;
    const snap = p.inventory.slots.map(stackKey);
    m.removed(this.menuPlayer(p));
    s.inventoryMenu.carried = null;
    s.containerMenu = s.inventoryMenu;
    if (s.pos) this.stopViewing(s.pos, p);
    s.pos = null;
    if (notify) this.server.send(p, { t: 'closeWindow', windowId: m.containerId });
    this.syncInventoryDiff(p, snap);
  }

  private sendAll(p: ServerPlayer, m: Menu): void {
    const list = m.slots.map((sl) => sl.getItem());
    list.push(m.carried);
    this.server.send(p, { t: 'windowItems', windowId: m.containerId, items: encodeStacks(list) });
  }

  private syncInventoryDiff(p: ServerPlayer, before: string[]): void {
    for (let i = 0; i < 41; i++) if (stackKey(p.inventory.slots[i] ?? null) !== before[i]) this.server.syncSlot(p, i);
  }

  handleClick(p: ServerPlayer, m: Extract<C2S, { t: 'clickWindow' }>): void {
    const s = this.state(p);
    const menu = m.windowId === 0 ? s.inventoryMenu : s.containerMenu;
    if (menu.containerId !== m.windowId || p.gameMode === 3) return;
    const snap = p.inventory.slots.map(stackKey);
    if (menu.stillValid(this.menuPlayer(p))) menu.clicked(m.slot, m.button, m.clickType as ClickType, this.menuPlayer(p));
    // the client predicted the click: always answer with the authoritative contents
    this.sendAll(p, menu);
    this.syncInventoryDiff(p, snap);
    if (menu === s.containerMenu && menu !== s.inventoryMenu) s.lastSlots = menu.slots.map((sl) => stackKey(sl.getItem()));
  }

  /** ServerGamePacketListenerImpl.handleRenameItem (anvil). */
  renameItem(p: ServerPlayer, name: string): void {
    const m = this.state(p).containerMenu;
    if (!(m instanceof AnvilMenu) || !m.stillValid()) return;
    // SharedConstants.filterText: no control characters, at most 50 characters
    m.setItemName(name.replace(/[\u0000-\u001f\u007f\u00a7]/g, '').slice(0, 50));
    this.broadcastChanges(p);
  }

  /** ServerGamePacketListenerImpl.handleContainerButtonClick */
  handleButton(p: ServerPlayer, windowId: number, button: number): void {
    const s = this.state(p);
    const menu = s.containerMenu;
    if (menu === s.inventoryMenu || menu.containerId !== windowId || p.gameMode === 3) return;
    if (!menu.stillValid(this.menuPlayer(p))) return;
    if (menu.clickMenuButton(this.menuPlayer(p), button)) this.broadcastChanges(p);
  }

  handleClose(p: ServerPlayer, windowId: number): void {
    const s = this.state(p);
    if (windowId === 0) {
      // the inventory screen closed: its 2×2 grid and carried stack go back (InventoryMenu.removed)
      const snap = p.inventory.slots.map(stackKey);
      s.inventoryMenu.removed(this.menuPlayer(p));
      this.syncInventoryDiff(p, snap);
      return;
    }
    if (s.containerMenu.containerId === windowId) this.closeContainer(p, false);
  }

  /** Death / disconnect / game mode change: close everything. */
  closeAll(p: ServerPlayer): void {
    this.closeContainer(p, true);
    this.handleClose(p, 0);
  }

  /** broadcastChanges: changed slots and data of the open container go to its viewer. */
  private broadcastChanges(p: ServerPlayer): void {
    const s = this.state(p);
    const m = s.containerMenu;
    if (m === s.inventoryMenu) return;
    for (let i = 0; i < m.slots.length; i++) {
      const st = m.slots[i]!.getItem();
      const k = stackKey(st);
      if (k !== s.lastSlots[i]) {
        s.lastSlots[i] = k;
        this.server.send(p, { t: 'windowSlot', windowId: m.containerId, slot: i, item: st?.id ?? 0, count: st?.count ?? 0, damage: st?.damage ?? 0 });
        if (st?.tag) this.server.send(p, { t: 'windowSlotTag', windowId: m.containerId, slot: i, tag: encodeTag(st.tag) });
      }
    }
    for (let i = 0; i < m.data.length; i++) {
      if (m.data[i] !== s.lastData[i]) {
        s.lastData[i] = m.data[i]!;
        this.server.send(p, { t: 'windowData', windowId: m.containerId, property: i, value: m.data[i]! });
      }
    }
  }

  // ---------------------------------------------------------------- block entities
  blockEntity(x: number, y: number, z: number): BlockEntityData | undefined {
    return this.server.world.getChunk(x >> 4, z >> 4)?.blockEntities.get(blockEntityKey(x & 15, y, z & 15));
  }

  private getOrCreate<T extends BlockEntityData>(x: number, y: number, z: number, id: string, make: () => T): T {
    const c = this.server.world.getChunk(x >> 4, z >> 4)!;
    const k = blockEntityKey(x & 15, y, z & 15);
    const cur = c.blockEntities.get(k);
    if (cur && cur.id === id) return cur as T;
    const be = make();
    c.blockEntities.set(k, be);
    this.markDirty(x, z);
    return be;
  }

  private markDirty(x: number, z: number): void {
    const c = this.server.world.getChunk(x >> 4, z >> 4);
    if (c) c.version++;
    this.server.markChunkDirty(x >> 4, z >> 4);
  }

  /** Worldgen chests (dungeons…) and their loot table, rolled when first opened or broken. */
  attachGenerated(list: GenBlockEntity[]): void {
    for (const g of list) {
      if (g.kind !== 'chest') continue;
      const c = this.server.world.getChunk(g.x >> 4, g.z >> 4);
      if (!c) continue;
      // structures also give loot to barrels and (jungle temple) dispensers
      const block = blockNameOf(this.server.world.getState(g.x, g.y, g.z));
      const small = block === 'dispenser' || block === 'dropper';
      const id = small || block === 'barrel' ? block : 'chest';
      c.blockEntities.set(blockEntityKey(g.x & 15, g.y, g.z & 15), { id, items: new Array(small ? 9 : 27).fill(null), lootTable: g.lootTable, lootSeed: g.lootSeed.toString() });
      c.version++;
    }
  }

  /** RandomizableContainerBlockEntity.unpackLootTable */
  private unpackLoot(be: BlockEntityData, x: number, z: number): void {
    if (typeof be.lootTable !== 'string') return;
    fillWithLoot(be.items as (ItemStack | null)[], be.lootTable, BigInt(String(be.lootSeed ?? '0')));
    delete be.lootTable;
    delete be.lootSeed;
    this.markDirty(x, z);
  }

  private itemsContainer(x: number, y: number, z: number, id: string, size: number, pred: () => boolean): Container {
    const be = this.getOrCreate(x, y, z, id, () => ({ id, items: new Array(size).fill(null) }));
    this.unpackLoot(be, x, z);
    const items = be.items as (ItemStack | null)[];
    const c = new SimpleContainer(items);
    c.onChange = () => this.markDirty(x, z);
    (c as Container).stillValid = pred;
    return c;
  }

  private validFor(p: ServerPlayer, x: number, y: number, z: number, block: (n: string) => boolean): () => boolean {
    return () => {
      if (!block(blockNameOf(this.server.world.getState(x, y, z)))) return false;
      const dx = p.x - (x + 0.5), dy = p.y - (y + 0.5), dz = p.z - (z + 0.5);
      return dx * dx + dy * dy + dz * dz <= 64;
    };
  }

  /** BlockState.use for blocks with menus; true when the click was consumed. */
  useBlock(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const state = this.server.world.getState(x, y, z);
    const name = blockNameOf(state);
    const inv = new InventoryContainer(p.inventory);
    if (name === 'stonecutter') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'stonecutter');
      this.open(p, (id) => {
        const m = new StonecutterMenu(id, inv, valid);
        let last = -1;
        // UI_STONECUTTER_TAKE_RESULT, at most once per game tick
        m.onTakeSound = () => {
          if (last === this.server.gameTime) return;
          last = this.server.gameTime;
          this.containerSound([x, y, z], 'ui.stonecutter.take_result', 1);
        };
        return m;
      }, 'Stonecutter', [x, y, z]);
      return true;
    }
    // ---- Phase 7: anvil ----
    if (name === 'anvil' || name === 'chipped_anvil' || name === 'damaged_anvil') {
      const valid = this.validFor(p, x, y, z, (n) => n.endsWith('anvil'));
      this.open(p, (id) => new AnvilMenu(id, inv, {
        level: () => p.living.experienceLevel,
        onTake: (cost) => {
          if (cost > 0) {
            this.server.survival.giveExperience(p, -cost, true);
          }
          // AnvilMenu.onTake: 12% chance to damage the anvil (not in creative)
          const st = this.server.world.getState(x, y, z);
          const n = blockNameOf(st);
          if (p.gameMode !== 1 && this.server.rand.nextFloat() < 0.12) {
            const next = n === 'anvil' ? 'chipped_anvil' : n === 'chipped_anvil' ? 'damaged_anvil' : null;
            if (next) {
              this.server.setBlock(x, y, z, withProp(stateOf(next), 'facing', getProp(st, 'facing') as string));
              this.server.playSound(null, 'block.anvil.use', 'block', x + 0.5, y + 0.5, z + 0.5, 1, this.server.rand.nextFloat() * 0.1 + 0.9);
            } else {
              this.server.setBlock(x, y, z, 0);
              this.server.playSound(null, 'block.anvil.destroy', 'block', x + 0.5, y + 0.5, z + 0.5, 1, this.server.rand.nextFloat() * 0.1 + 0.9);
            }
          } else this.server.playSound(null, 'block.anvil.use', 'block', x + 0.5, y + 0.5, z + 0.5, 1, this.server.rand.nextFloat() * 0.1 + 0.9);
        },
        valid,
      }, p.gameMode === 1), 'Repair & Name', [x, y, z]);
      return true;
    }
    // ---- Phase 7: brewing stand ----
    if (name === 'brewing_stand') {
      const be = this.getOrCreate(x, y, z, 'brewing_stand', () => newBrewingStand() as unknown as BlockEntityData) as unknown as BrewingData;
      const valid = this.validFor(p, x, y, z, (n) => n === 'brewing_stand');
      const c = new BrewingContainer(be, () => this.markDirty(x, z), valid);
      this.open(p, (id) => {
        const m = new BrewingStandMenu(id, inv, c);
        m.data[0] = be.brewTime;
        m.data[1] = be.fuel;
        return m;
      }, 'Brewing Stand', [x, y, z]);
      return true;
    }
    // ---- Phase 7: enchanting table ----
    if (name === 'enchanting_table') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'enchanting_table');
      const w = this.server.world;
      this.open(p, (id) => new EnchantmentMenu(id, inv, {
        bookshelves: () => countBookshelves(
          (dx, dy, dz) => w.getState(x + dx, y + dy, z + dz) === 0,
          (dx, dy, dz) => blockNameOf(w.getState(x + dx, y + dy, z + dz)) === 'bookshelf',
        ),
        seed: () => p.enchantmentSeed,
        level: () => p.living.experienceLevel,
        onEnchantmentPerformed: (levels) => {
          // Player.onEnchantmentPerformed
          const l = p.living;
          l.experienceLevel -= levels;
          if (l.experienceLevel < 0) {
            l.experienceLevel = 0;
            l.experienceProgress = 0;
            l.totalExperience = 0;
          }
          p.enchantmentSeed = this.server.rand.nextInt();
          l.lastSentExp = -1;
          this.server.survival.sync(p);
        },
        sound: () => this.server.playSound(null, 'block.enchantment_table.use', 'block', x + 0.5, y + 0.5, z + 0.5, 1, this.server.rand.nextFloat() * 0.1 + 0.9),
        valid,
      }), 'Enchant', [x, y, z]);
      return true;
    }
    if (name === 'grindstone') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'grindstone');
      this.open(p, (id) => {
        const m = new GrindstoneMenu(id, inv, valid);
        m.onUse = () => this.containerSound([x, y, z], 'block.grindstone.use', 1);
        // Phase 7: disenchanting gives back XP at the grindstone
        m.onExperience = (a, b) => {
          const xp = grindstoneExperience(a, b, this.server.rand);
          if (xp > 0) this.server.spawnExperience(x + 0.5, y + 0.5, z + 0.5, xp);
        };
        return m;
      }, 'Repair & Disenchant', [x, y, z]);
      return true;
    }
    if (name === 'smithing_table') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'smithing_table');
      this.open(p, (id) => {
        const m = new SmithingMenu(id, inv, valid);
        m.onUse = () => this.containerSound([x, y, z], 'block.smithing_table.use', 1);
        return m;
      }, 'Upgrade Gear', [x, y, z]);
      return true;
    }
    if (name === 'crafting_table') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'crafting_table');
      this.open(p, (id) => new CraftingMenu(id, inv, valid), 'Crafting', [x, y, z]);
      return true;
    }
    if (isChest(name)) {
      if (this.chestBlocked(x, y, z)) return true;
      const valid = this.validFor(p, x, y, z, isChest);
      const own = this.itemsContainer(x, y, z, 'chest', 27, valid);
      const partner = chestPartner(this.server.world, x, y, z);
      if (partner && !this.chestBlocked(...partner)) {
        const other = this.itemsContainer(partner[0], partner[1], partner[2], 'chest', 27, this.validFor(p, partner[0], y, partner[2], isChest));
        const [first, second] = isFirstHalf(state) ? [own, other] : [other, own];
        this.open(p, (id) => new ChestMenu(id, inv, new CompoundContainer(first, second), 6), 'Large Chest', [x, y, z]);
      } else if (partner) return true;
      else this.open(p, (id) => new ChestMenu(id, inv, own, 3), 'Chest', [x, y, z]);
      this.startViewing([x, y, z], p, name === 'trapped_chest' ? 'block.chest' : 'block.chest');
      return true;
    }
    if (name === 'barrel') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'barrel');
      const c = this.itemsContainer(x, y, z, 'barrel', 27, valid);
      this.open(p, (id) => new ChestMenu(id, inv, c, 3), 'Barrel', [x, y, z]);
      this.startViewing([x, y, z], p, 'block.barrel');
      return true;
    }
    if (name === 'shulker_box' || name.endsWith('_shulker_box')) {
      // ShulkerBoxBlock.canOpen: the lid needs room in the facing direction
      const f = getProp(state, 'facing') as string;
      const d = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }[f] ?? [0, 1, 0];
      if (FULL_COLLISION[this.server.world.getState(x + d[0]!, y + d[1]!, z + d[2]!)] === 1) return true;
      const valid = this.validFor(p, x, y, z, (n) => n === name);
      const c = this.itemsContainer(x, y, z, 'shulker_box', 27, valid);
      this.open(p, (id) => new ShulkerBoxMenu(id, inv, c), 'Shulker Box', [x, y, z]);
      this.startViewing([x, y, z], p, 'block.shulker_box');
      return true;
    }
    if (name === 'dispenser' || name === 'dropper') {
      const valid = this.validFor(p, x, y, z, (n) => n === name);
      const c = this.itemsContainer(x, y, z, name, 9, valid);
      this.open(p, (id) => new DispenserMenu(id, inv, c), name === 'dispenser' ? 'Dispenser' : 'Dropper', [x, y, z]);
      return true;
    }
    if (name === 'hopper') {
      const valid = this.validFor(p, x, y, z, (n) => n === 'hopper');
      const c = this.itemsContainer(x, y, z, 'hopper', 5, valid);
      this.open(p, (id) => new HopperMenu(id, inv, c), 'Item Hopper', [x, y, z]);
      return true;
    }
    if (name === 'ender_chest') {
      if (this.chestBlocked(x, y, z)) return true;
      const valid = this.validFor(p, x, y, z, (n) => n === 'ender_chest');
      const view = new SimpleContainer(p.enderChest);
      (view as Container).stillValid = valid;
      this.open(p, (id) => new ChestMenu(id, inv, view, 3), 'Ender Chest', [x, y, z]);
      this.startViewing([x, y, z], p, 'block.ender_chest');
      return true;
    }
    if (name === 'campfire' || name === 'soul_campfire') {
      // CampfireBlock.use: raw food from the hand goes onto a free spot of the fire
      for (const slot of [p.inventory.selected, 40]) {
        const held = p.inventory.get(slot);
        if (!held || !cookingRecipe('campfire_cooking', held.id)) continue;
        const be = this.getOrCreate(x, y, z, 'campfire', () => newCampfire() as unknown as BlockEntityData) as unknown as CampfireData;
        if (!placeCampfireFood(be, held, p.gameMode !== 1)) continue;
        if (held.count <= 0) p.inventory.set(slot, null);
        this.server.syncSlot(p, slot);
        this.markDirty(x, z);
        return true;
      }
      return false;
    }
    if (FURNACES.has(name)) {
      const kind = name as FurnaceKind;
      const be = this.getOrCreate(x, y, z, kind, () => newFurnace(kind) as unknown as BlockEntityData) as unknown as FurnaceData;
      const valid = this.validFor(p, x, y, z, (n) => n === name);
      const c = new FurnaceContainer(be, () => this.markDirty(x, z), valid);
      const award = (mp: MenuPlayer) => {
        void mp;
        const xp = takeFurnaceExperience(be, () => this.server.rand.nextFloat());
        if (xp > 0) this.server.spawnExperience(p.x, p.y, p.z, xp);
      };
      this.open(p, (id) => {
        const m = new FurnaceMenu(kind, id, inv, c, award);
        this.fillFurnaceData(m, be);
        return m;
      }, TITLES[kind]!, [x, y, z]);
      return true;
    }
    return false;
  }

  /** ChestBlock.isChestBlockedAt: a solid block (redstone conductor) on top. */
  private chestBlocked(x: number, y: number, z: number): boolean {
    const above = this.server.world.getState(x, y + 1, z);
    const b = BLOCKS_BY_NAME.get(blockNameOf(above));
    return FULL_COLLISION[above] === 1 && !!b && !b.transparent && !blockNameOf(above).includes('glass') && !blockNameOf(above).endsWith('_leaves');
  }

  private startViewing(pos: [number, number, number], p: ServerPlayer, sound: string): void {
    const k = pos.join(',');
    const n = (this.viewers.get(k) ?? 0) + 1;
    this.viewers.set(k, n);
    void p;
    if (n === 1) {
      this.containerSound(pos, sound + '.open');
      this.setOpenState(pos, true);
    }
  }

  /** BarrelBlockEntity.updateBlockState: the barrel's OPEN property while anyone looks inside. */
  private setOpenState(pos: [number, number, number], open: boolean): void {
    const st = this.server.world.getState(pos[0], pos[1], pos[2]);
    if (blockNameOf(st) === 'barrel' && getProp(st, 'open') !== open) this.server.setBlock(pos[0], pos[1], pos[2], withProp(st, 'open', open));
  }

  private stopViewing(pos: [number, number, number], _p: ServerPlayer): void {
    const k = pos.join(',');
    const n = this.viewers.get(k);
    if (n === undefined) return;
    const name = blockNameOf(this.server.world.getState(pos[0], pos[1], pos[2]));
    if (n <= 1) {
      this.viewers.delete(k);
      const sound = name === 'barrel' ? 'block.barrel' : name === 'ender_chest' ? 'block.ender_chest' : isChest(name) ? 'block.chest' : name.endsWith('shulker_box') ? 'block.shulker_box' : null;
      if (sound) this.containerSound(pos, sound + '.close');
      this.setOpenState(pos, false);
    } else this.viewers.set(k, n - 1);
  }

  private containerSound(pos: [number, number, number], event: string, pitchFixed?: number): void {
    const r = this.server.rand;
    try {
      this.server.playSound(null, event, 'block', pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, pitchFixed !== undefined ? 1 : 0.5, pitchFixed ?? r.nextFloat() * 0.1 + 0.9);
    } catch {
      // sound event missing from the registry: stay silent
    }
  }

  private fillFurnaceData(m: FurnaceMenu, be: FurnaceData): void {
    m.data[0] = be.litTime;
    m.data[1] = be.litDuration;
    m.data[2] = be.cookingProgress;
    m.data[3] = be.cookingTotalTime;
  }

  // ---------------------------------------------------------------- ticking
  tick(): void {
    const srv = this.server;
    for (const c of srv.world.chunks.values()) {
      if (c.blockEntities.size === 0 || !srv.isTickingChunk(c.x, c.z)) continue;
      for (const [k, be] of c.blockEntities) {
        const x = c.x * 16 + (k & 15), y = k >> 8, z = c.z * 16 + ((k >> 4) & 15);
        if (be.id === 'campfire') {
          const st = srv.world.getState(x, y, z);
          const n = blockNameOf(st);
          if (n !== 'campfire' && n !== 'soul_campfire') {
            c.blockEntities.delete(k);
            continue;
          }
          const cf = be as unknown as CampfireData;
          if (!cf.items.some((i) => i)) continue;
          for (const out of tickCampfire(cf, getProp(st, 'lit') === true)) this.dropItemStack(x, y, z, out);
          this.markDirty(x, z);
          continue;
        }
        if (be.id === 'brewing_stand') {
          const st = srv.world.getState(x, y, z);
          if (blockNameOf(st) !== 'brewing_stand') {
            c.blockEntities.delete(k);
            continue;
          }
          const b = be as unknown as BrewingData;
          const r = tickBrewingStand(b);
          if (r.changed) this.markDirty(x, z);
          if (r.brewed) srv.playSound(null, 'block.brewing_stand.brew', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
          if (r.drop) this.dropItemStack(x, y, z, r.drop);
          const bits = bottleBits(b);
          let ns = st;
          for (let i = 0; i < 3; i++) if (getProp(ns, `has_bottle_${i}`) !== bits[i]) ns = withProp(ns, `has_bottle_${i}`, bits[i]!);
          if (ns !== st) srv.setBlock(x, y, z, ns);
          continue;
        }
        if (!FURNACES.has(be.id)) continue;
        const st = srv.world.getState(x, y, z);
        if (blockNameOf(st) !== be.id) {
          c.blockEntities.delete(k);
          continue;
        }
        const f = be as unknown as FurnaceData;
        const r = tickFurnace(f);
        if (r.changed) this.markDirty(x, z);
        if (r.litChanged) srv.setBlock(x, y, z, withProp(st, 'lit', f.litTime > 0));
      }
    }
    for (const p of srv.players) {
      const s = this.menus.get(p);
      if (!s || s.containerMenu === s.inventoryMenu) continue;
      const m = s.containerMenu;
      if (!m.stillValid(this.menuPlayer(p)) || p.living.dead) {
        this.closeContainer(p, true);
        continue;
      }
      if (m instanceof BrewingStandMenu && s.pos) {
        const be = this.blockEntity(s.pos[0], s.pos[1], s.pos[2]) as unknown as BrewingData | undefined;
        if (be && be.id === 'brewing_stand') {
          m.data[0] = be.brewTime;
          m.data[1] = be.fuel;
        }
      }
      if (m instanceof FurnaceMenu && s.pos) {
        const be = this.blockEntity(s.pos[0], s.pos[1], s.pos[2]);
        if (be && FURNACES.has(be.id)) this.fillFurnaceData(m, be as unknown as FurnaceData);
      }
      this.broadcastChanges(p);
    }
  }

  /** A block changed: a removed container block drops its contents (Containers.dropContents). */
  onBlockChanged(x: number, y: number, z: number, old: number, state: number): void {
    const c = this.server.world.getChunk(x >> 4, z >> 4);
    if (!c || c.blockEntities.size === 0) return;
    const k = blockEntityKey(x & 15, y, z & 15);
    const be = c.blockEntities.get(k);
    if (!be || blockNameOf(old) === blockNameOf(state)) return;
    this.unpackLoot(be, x, z);
    c.blockEntities.delete(k);
    this.markDirty(x, z);
    for (const st of (be.items as (ItemStack | null)[] | undefined) ?? []) if (!isEmpty(st)) this.dropItemStack(x, y, z, st);
    if (FURNACES.has(be.id)) {
      const xp = takeFurnaceExperience(be as unknown as FurnaceData, () => this.server.rand.nextFloat());
      if (xp > 0) this.server.spawnExperience(x + 0.5, y + 0.5, z + 0.5, xp);
    }
  }

  /** Containers.dropItemStack: random spot in the block, split into 10–30 item stacks. */
  private dropItemStack(x: number, y: number, z: number, st: ItemStack): void {
    const r = this.server.rand;
    const w = 0.25, d1 = 1 - w, d2 = w / 2;
    const px = x + r.nextDouble() * d1 + d2, py = y + r.nextDouble() * d1, pz = z + r.nextDouble() * d1 + d2;
    let left = st.count;
    while (left > 0) {
      const n = Math.min(left, r.nextInt(21) + 10);
      left -= n;
      this.server.spawnItem(px, py, pz, { id: st.id, count: n, damage: st.damage }, r.nextGaussian() * 0.05, r.nextGaussian() * 0.05 + 0.2, r.nextGaussian() * 0.05);
    }
  }

  /** Lit state for furnace items placed by players (default unlit). */
  static isFurnace(name: string): boolean {
    return FURNACES.has(name);
  }
}

export function isLitFurnace(state: number): boolean {
  return FURNACES.has(blockNameOf(state)) && getProp(state, 'lit') === true;
}
