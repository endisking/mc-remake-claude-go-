/**
 * Creative inventory (vanilla CreativeModeInventoryScreen): item tabs with scrolling, the
 * search tab, the survival inventory tab with the destroy-item slot. The cursor is client-side
 * like vanilla; every inventory change goes to the server as a creative slot set.
 */
import { AbstractContainerScreen, type ContainerHost } from './containerscreen';
import { inset, panel, slot as slotWell, tooltip } from './containerart';
import { BLOCKS, ITEMS_BY_ID, ITEMS_BY_NAME } from '@shared/data';
import { creativeTabItems, TAB_TITLES, type CreativeTab } from '@shared/item/creativetabs';
import { isEmpty, maxStackSize, type ItemStack } from '@shared/item/stack';
import { InventoryContainer, SimpleContainer, copyStack, equipmentSlotFor, sameItemSameTags } from '@shared/menu/container';
import { ClickType, Menu, SLOT_OUTSIDE, Slot, type MenuPlayer } from '@shared/menu/menu';
import { displayName } from './containerscreen';
import { isEmptyHotbar, savedHotbars } from './hotbars';
import { keyName } from '../keybinds';


type TabId = CreativeTab | 'hotbar' | 'search' | 'inventory';

/** CreativeModeTab ids/positions: column = id % 6, top row = id < 6; some aligned right. */
const TABS: { id: TabId; index: number; icon: string; right?: boolean }[] = [
  { id: 'building_blocks', index: 0, icon: 'bricks' },
  { id: 'decorations', index: 1, icon: 'peony' },
  { id: 'redstone', index: 2, icon: 'redstone' },
  { id: 'transportation', index: 3, icon: 'powered_rail' },
  { id: 'hotbar', index: 4, icon: 'bookshelf', right: true },
  { id: 'search', index: 5, icon: 'compass', right: true },
  { id: 'misc', index: 6, icon: 'lava_bucket' },
  { id: 'food', index: 7, icon: 'apple' },
  { id: 'tools', index: 8, icon: 'iron_axe' },
  { id: 'combat', index: 9, icon: 'golden_sword' },
  { id: 'brewing', index: 10, icon: 'potion' },
  { id: 'inventory', index: 11, icon: 'chest', right: true },
];

let lastTab: TabId = 'building_blocks';

class PickerSlot extends Slot {
  override mayPickup(): boolean {
    return true;
  }
}

class DestroySlot extends Slot {
  override mayPlace(): boolean {
    return true;
  }
}

/** The menu shown by the creative screen; slots are rebuilt when switching tab kinds. */
class CreativeMenu extends Menu {
  readonly picker = new SimpleContainer(45);
  readonly destroy = new SimpleContainer(1);
  mode: 'items' | 'inventory' = 'items';
  constructor(readonly inv: InventoryContainer) {
    super('inventory', 255);
    this.imageWidth = 195;
    this.imageHeight = 136;
    this.setMode('items');
  }
  setMode(mode: 'items' | 'inventory'): void {
    this.mode = mode;
    this.slots.length = 0;
    if (mode === 'items') {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) this.addSlot(new PickerSlot(this.picker, r * 9 + c, 9 + c * 18, 18 + r * 18));
      for (let i = 0; i < 9; i++) this.addSlot(new Slot(this.inv, i, 9 + i * 18, 112));
    } else {
      // armour head, chest, legs, feet at (54|108, 6|33); off hand (35, 20); main rows; hotbar; destroy
      const pos = [[54, 6], [54, 33], [108, 6], [108, 33]] as const;
      for (let k = 0; k < 4; k++) this.addSlot(new ArmorLike(this.inv, 39 - k, pos[k]![0], pos[k]![1], (['head', 'chest', 'legs', 'feet'] as const)[k]!));
      for (let i = 0; i < 27; i++) this.addSlot(new Slot(this.inv, 9 + i, 9 + (i % 9) * 18, 54 + Math.floor(i / 9) * 18));
      for (let i = 0; i < 9; i++) this.addSlot(new Slot(this.inv, i, 9 + i * 18, 112));
      this.addSlot(new Slot(this.inv, 40, 35, 20));
      this.addSlot(new DestroySlot(this.destroy, 0, 173, 112));
    }
  }
  override canDragTo(slot: Slot): boolean {
    return slot.container !== this.picker && slot.container !== this.destroy;
  }
  override canTakeItemForPickAll(_s: ItemStack, slot: Slot): boolean {
    return slot.container !== this.picker && slot.container !== this.destroy;
  }
  quickMoveStack(_p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    if (!slot) return null;
    if (this.mode === 'items') {
      // ItemPickerMenu: shift-clicking a hotbar slot clears it
      if (slot.container === this.inv) slot.set(null);
      return null;
    }
    // inventory tab (InventoryMenu.quickMoveStack over inventory slot numbers)
    const st = slot.getItem();
    if (!st || slot.container !== this.inv) return null;
    const orig = copyStack(st)!;
    const invSlot = slot.slot;
    const idx = (n: number) => this.slots.findIndex((s) => s.container === this.inv && s.slot === n);
    const range = (a: number, b: number) => [idx(a), idx(b - 1) + 1] as const;
    const eq = equipmentSlotFor(st.id);
    const armor = eq === 'head' ? 39 : eq === 'chest' ? 38 : eq === 'legs' ? 37 : eq === 'feet' ? 36 : -1;
    const main = range(9, 36), hot = range(0, 9);
    const moveTo = (r: readonly [number, number]) => this.moveItemStackTo(st, r[0], r[1], false);
    let ok: boolean;
    if (invSlot >= 36) ok = moveTo(main) || moveTo(hot);
    else if (armor >= 0 && !this.slots[idx(armor)]!.hasItem()) ok = this.moveItemStackTo(st, idx(armor), idx(armor) + 1, false);
    else if (invSlot >= 9) ok = moveTo(hot);
    else ok = moveTo(main);
    if (!ok) return null;
    return this.finishQuickMove(slot, st, orig, _p);
  }
}

class ArmorLike extends Slot {
  constructor(c: InventoryContainer, i: number, x: number, y: number, readonly part: 'head' | 'chest' | 'legs' | 'feet') {
    super(c, i, x, y);
  }
  override getMaxStackSize(): number {
    return 1;
  }
  override mayPlace(s: ItemStack): boolean {
    return equipmentSlotFor(s.id) === this.part;
  }
}

export class CreativeScreen extends AbstractContainerScreen<CreativeMenu> {
  private tab: TabId = lastTab;
  private scrollOffs = 0;
  private scrolling = false;
  private search = '';
  private items: number[] = [];
  /** Saved Hotbars tab: 9 rows of saved stacks; hint papers mark empty rows */
  private hotbarStacks: (ItemStack | null)[] | null = null;
  private readonly hints = new Set<number>();
  private readonly tabs = creativeTabItems(BLOCKS.map((b) => b.name));

  constructor(host: ContainerHost) {
    super(host, new CreativeMenu(new InventoryContainer(host.playerInventory)), 'Creative');
  }

  override init(): void {
    super.init();
    this.selectTab(this.tab);
  }

  protected override get player(): MenuPlayer {
    return {
      inventory: this.host.playerInventory,
      creative: true,
      drop: (st) => this.host.send({ t: 'creativeSlot', slot: -1, item: st.id, count: st.count, damage: st.damage }),
    };
  }

  private selectTab(t: TabId): void {
    lastTab = t;
    this.tab = t;
    this.title = TAB_TITLES[t];
    this.menu.setMode(t === 'inventory' ? 'inventory' : 'items');
    this.scrollOffs = 0;
    this.refreshItems();
  }

  private refreshItems(): void {
    if (this.tab === 'inventory') return;
    this.hotbarStacks = null;
    this.hints.clear();
    if (this.tab === 'hotbar') {
      // each empty saved row shows a paper hint in the column of its own number
      const rows = savedHotbars();
      const paper = ITEMS_BY_NAME.get('paper')!.id;
      const list: (ItemStack | null)[] = [];
      this.hotbarStacks = list;
      rows.forEach((row, i) => {
        const empty = isEmptyHotbar(row);
        for (let j = 0; j < 9; j++) {
          if (empty && j === i) {
            this.hints.add(i * 9 + j);
            list.push({ id: paper, count: 1, damage: 0 });
          } else list.push(empty ? null : row[j] ? { ...row[j]! } : null);
        }
      });
      this.items = new Array(81).fill(0);
      this.scrollTo(this.scrollOffs);
      return;
    }
    if (this.tab === 'search') {
      const q = this.search.toLowerCase();
      const all: number[] = [];
      for (const k of ['building_blocks', 'decorations', 'redstone', 'transportation', 'misc', 'food', 'tools', 'combat', 'brewing'] as const) all.push(...this.tabs[k]);
      this.items = q ? all.filter((id) => displayName(id).toLowerCase().includes(q) || (ITEMS_BY_ID[id]?.name ?? '').includes(q.replace(/ /g, '_'))) : all;
    } else this.items = this.tabs[this.tab as CreativeTab] ?? [];
    this.scrollTo(this.scrollOffs);
  }

  /** list index shown in each picker slot (hotbar tab hints) */
  private readonly pickerIndex: number[] = new Array(45).fill(-1);

  protected override tooltipLines(st: ItemStack): string[] {
    const h = this.hoveredSlot;
    if (this.tab === 'hotbar' && h && h.container === this.menu.picker && this.hints.has(this.pickerIndex[h.slot]!)) {
      const row = Math.floor(this.pickerIndex[h.slot]! / 9) + 1;
      const b = this.host.binds;
      return [`Press ${keyName(b.key('saveToolbarActivator'))}+${keyName(b.key(`hotbar.${row}`))} to save your hotbar`];
    }
    return super.tooltipLines(st);
  }

  private get rows(): number {
    return Math.ceil(this.items.length / 9);
  }

  private canScroll(): boolean {
    return this.tab !== 'inventory' && this.rows > 5;
  }

  /** ItemPickerMenu.scrollTo */
  private scrollTo(f: number): void {
    this.scrollOffs = Math.max(0, Math.min(1, f));
    const off = Math.max(0, Math.round(this.scrollOffs * (this.rows - 5)));
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 9; c++) {
        const k = (r + off) * 9 + c;
        if (this.hotbarStacks) {
          const st = this.hotbarStacks[k];
          this.menu.picker.items[r * 9 + c] = st ? { ...st } : null;
          this.pickerIndex[r * 9 + c] = k;
          continue;
        }
        const id = this.items[k];
        this.menu.picker.items[r * 9 + c] = id ? { id, count: 1, damage: 0 } : null;
      }
  }

  // ---------------------------------------------------------------- rendering
  private tabPos(t: (typeof TABS)[number]): [number, number] {
    const col = t.index % 6;
    let x = 28 * col;
    if (t.right) x = this.imageWidth - 28 * (6 - col) + 2;
    else if (col > 0) x += col;
    const y = t.index < 6 ? -28 : this.imageHeight - 4;
    return [this.leftPos + x, this.topPos + y];
  }

  private renderTab(t: (typeof TABS)[number], selected: boolean): void {
    const g = this.gui;
    const [x, y] = this.tabPos(t);
    const top = t.index < 6;
    if (selected) {
      panel(g, x, y, 28, 32);
      // join the tab to the window
      g.fill(x + 2, top ? y + 26 : y, 24, 6, 0xffc6c6c6);
    } else {
      panel(g, x, top ? y + 2 : y, 28, 30);
      g.fill(x + 1, top ? y + 3 : y + 1, 26, 28, 0x30000000);
    }
    const icon = ITEMS_BY_NAME.get(t.icon);
    if (icon) this.host.renderGuiItem(icon.id, 1, x + 6, y + (top ? 9 : 7));
  }

  protected renderBg(mx: number, my: number): void {
    const g = this.gui, l = this.leftPos, t = this.topPos;
    for (const tab of TABS) if (tab.id !== this.tab) this.renderTab(tab, false);
    panel(g, l, t, this.imageWidth, this.imageHeight);
    for (const s of this.menu.slots) {
      if (s instanceof DestroySlot) {
        slotWell(g, l + s.x, t + s.y);
        // red cross (destroy item)
        for (let i = 2; i < 14; i++) {
          g.fill(l + s.x + i, t + s.y + i, 1, 1, 0xffd03030);
          g.fill(l + s.x + 15 - i, t + s.y + i, 1, 1, 0xffd03030);
        }
      } else slotWell(g, l + s.x, t + s.y);
    }
    if (this.tab === 'inventory') {
      inset(g, l + 73, t + 5, 34, 46, 0xff000000);
      this.host.renderPlayerPreview?.(l + 88, t + 45, 20, l + 88 - mx, t + 45 - 30 - my, [l + 74, t + 6, 32, 44]);
    } else {
      // scrollbar track and thumb
      inset(g, l + 174, t + 17, 14, 112, 0xff8b8b8b);
      const y0 = t + 18, y1 = y0 + 112;
      const ty = y0 + Math.floor((y1 - y0 - 17) * this.scrollOffs);
      const enabled = this.canScroll();
      panel(g, l + 175, ty, 12, 15);
      if (!enabled) g.fill(l + 176, ty + 1, 10, 13, 0x60808080);
      if (this.tab === 'search') {
        // search box
        g.fill(l + 80, t + 4, 89, 12, 0xff000000);
        g.fill(l + 81, t + 5, 87, 10, 0xff202020);
        const blink = Math.floor(performance.now() / 300) % 2 === 0 ? '_' : '';
        g.text(this.search + blink, l + 83, t + 6, 0xffffff, true);
      }
    }
    this.renderTab(TABS.find((x) => x.id === this.tab)!, true);
  }

  protected override renderLabels(): void {
    if (this.tab !== 'inventory') this.gui.text(this.title, this.leftPos + 8, this.topPos + 6, 0x404040, false);
  }

  protected override renderExtra(mx: number, my: number): void {
    // tab tooltips
    for (const t of TABS) {
      const [x, y] = this.tabPos(t);
      if (mx >= x && mx < x + 28 && my >= y && my < y + 32 && isEmpty(this.menu.carried)) {
        tooltip(this.gui, [TAB_TITLES[t.id]], mx, my);
      }
    }
  }

  protected override emptySlotIcon(s: Slot): 'head' | 'chest' | 'legs' | 'feet' | 'offhand' | null {
    if (s instanceof ArmorLike) return s.part;
    if (this.tab === 'inventory' && s.container === this.menu.inv && s.slot === 40) return 'offhand';
    return null;
  }

  // ---------------------------------------------------------------- input
  protected override mouseClickedExtra(mx: number, my: number, button: number): boolean {
    if (button !== 0) return false;
    for (const t of TABS) {
      const [x, y] = this.tabPos(t);
      if (mx >= x && mx < x + 28 && my >= y && my < y + 32) {
        this.selectTab(t.id);
        return true;
      }
    }
    if (this.canScroll()) {
      const x = this.leftPos + 175, y0 = this.topPos + 18;
      if (mx >= x && mx < x + 14 && my >= y0 && my < y0 + 112) {
        this.scrolling = true;
        this.dragScroll(my);
        return true;
      }
    }
    return false;
  }

  private dragScroll(my: number): void {
    const y0 = this.topPos + 18, y1 = y0 + 112;
    this.scrollTo((my - y0 - 7.5) / (y1 - y0 - 15));
  }

  override mouseMove(mx: number, my: number): void {
    if (this.scrolling) this.dragScroll(my);
    super.mouseMove(mx, my);
  }

  override mouseUp(domButton = 0): void {
    if (this.scrolling && domButton === 0) {
      this.scrolling = false;
      return;
    }
    super.mouseUp(domButton);
  }

  override mouseScrolled(_mx: number, _my: number, delta: number): void {
    if (!this.canScroll()) return;
    this.scrollTo(this.scrollOffs + delta / (this.rows - 5));
  }

  protected override hasClickedOutside(mx: number, my: number): boolean {
    if (!super.hasClickedOutside(mx, my)) return false;
    for (const t of TABS) {
      const [x, y] = this.tabPos(t);
      if (mx >= x && mx < x + 28 && my >= y && my < y + 32) return false;
    }
    return true;
  }

  /** CreativeModeInventoryScreen.slotClicked */
  protected override slotClicked(slot: Slot | null, slotId: number, button: number, type: ClickType): void {
    const m = this.menu;
    const inv = this.host.playerInventory;
    const before = inv.slots.map((s) => (isEmpty(s) ? '' : `${s.id}:${s.count}:${s.damage}`));
    const shift = this.host.isKeyDown('ShiftLeft') || this.host.isKeyDown('ShiftRight');
    if (slot) slotId = slot.index;
    if (!slot && type !== ClickType.QUICK_CRAFT) {
      // clicked outside the window: throw the cursor stack (all with left, one with right)
      const c = m.carried;
      if (!isEmpty(c) && slotId === SLOT_OUTSIDE) {
        if (button === 0) {
          this.player.drop(c);
          m.carried = null;
        } else if (button === 1) {
          this.player.drop({ ...c, count: 1 });
          c.count--;
          if (c.count <= 0) m.carried = null;
        }
      }
    } else if (slot && slot.container === m.destroy) {
      // the destroy slot eats the cursor; shift-click clears the whole inventory
      if (shift && type === ClickType.QUICK_MOVE) for (let i = 0; i < 41; i++) inv.set(i, null);
      else m.carried = null;
    } else if (slot && slot.container === m.picker && this.tab === 'hotbar' && this.hints.has(this.pickerIndex[slot.slot]!)) {
      // the hint paper can't be taken (CustomCreativeLock)
    } else if (slot && slot.container === m.picker) {
      const c = m.carried;
      const it = slot.getItem();
      if (type === ClickType.SWAP) {
        if (it) inv.set(button, { id: it.id, count: maxStackSize(it.id), damage: 0 });
      } else if (type === ClickType.CLONE) {
        if (isEmpty(c) && it) m.carried = { id: it.id, count: maxStackSize(it.id), damage: 0 };
      } else if (type === ClickType.THROW) {
        if (it) this.player.drop({ id: it.id, count: button === 0 ? 1 : maxStackSize(it.id), damage: 0 });
      } else if (!isEmpty(c) && it && sameItemSameTags(c, it)) {
        if (button === 0) {
          if (shift) c.count = maxStackSize(c.id);
          else if (c.count < maxStackSize(c.id)) c.count++;
        } else {
          c.count--;
          if (c.count <= 0) m.carried = null;
        }
      } else if (it && isEmpty(c)) {
        m.carried = { ...it };
        if (shift) m.carried.count = maxStackSize(it.id);
      } else if (button === 0) m.carried = null;
      else if (!isEmpty(c)) {
        c.count--;
        if (c.count <= 0) m.carried = null;
      }
    } else {
      m.clicked(slotId, button, type, this.player);
    }
    // send every changed inventory slot (SetCreativeModeSlot)
    for (let i = 0; i < 41; i++) {
      const s = inv.slots[i];
      const k = isEmpty(s) ? '' : `${s.id}:${s.count}:${s.damage}`;
      if (k !== before[i]) this.host.send({ t: 'creativeSlot', slot: i, item: isEmpty(s) ? 0 : s.id, count: isEmpty(s) ? 0 : s.count, damage: isEmpty(s) ? 0 : s.damage });
    }
  }

  override keyDown(code: string): boolean {
    if (this.tab === 'search') {
      if (code === 'Escape') {
        this.host.setScreen(null);
        return true;
      }
      if (code === 'Backspace') {
        this.search = this.search.slice(0, -1);
        this.refreshItems();
      }
      return true;
    }
    return super.keyDown(code);
  }

  override charTyped(ch: string): boolean {
    if (this.tab !== 'search' || ch.length !== 1 || ch.charCodeAt(0) < 32) return false;
    if (this.search.length < 50) this.search += ch;
    this.scrollOffs = 0;
    this.refreshItems();
    return true;
  }

  override onClose(): void {
    const c = this.menu.carried;
    this.menu.carried = null;
    if (!isEmpty(c)) {
      const inv = this.host.playerInventory;
      const before = inv.slots.map((s) => (isEmpty(s) ? '' : `${s.id}:${s.count}`));
      inv.add(c);
      for (let i = 0; i < 41; i++) {
        const s = inv.slots[i];
        if ((isEmpty(s) ? '' : `${s.id}:${s.count}`) !== before[i]) this.host.send({ t: 'creativeSlot', slot: i, item: s?.id ?? 0, count: s?.count ?? 0, damage: s?.damage ?? 0 });
      }
    }
  }
}

