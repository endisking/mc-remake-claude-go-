/**
 * Container screens (vanilla AbstractContainerScreen and subclasses): slot rendering, hover
 * highlight, tooltips, the carried stack, click-drag splitting, double-click collecting and
 * the hotbar/offhand/drop/pick keys. Clicks are predicted on the local copy of the menu and
 * sent to the server, which answers with the authoritative contents.
 */
import { Screen } from './screen';
import type { ScreenHost } from './screens';
import type { C2S } from '@shared/protocol/packets';
import type { KeyBindings } from '../keybinds';
import { ITEMS_BY_ID } from '@shared/data';
import { isEmpty, itemName, maxStackSize, type Inventory, type ItemStack } from '@shared/item/stack';
import { copyStack, maxDamage } from '@shared/menu/container';
import { attackDamageOf, attackSpeedOf } from '@shared/game/combat';
import {
  ClickType, SLOT_OUTSIDE, canItemQuickReplace, quickCraftSlotCount, ChestMenu, CraftingMenu, FurnaceMenu, InventoryMenu,
  type Menu, type MenuPlayer, type Slot,
} from '@shared/menu/menu';
import { arrow, flame, inset, panel, resultSlot, silhouette, slot as slotWell, tooltip } from './containerart';

export interface ContainerHost extends ScreenHost {
  send(p: C2S): void;
  /** Draw an item icon at GUI (x, y) with vanilla stack-count text when count ≠ 1 (Game.renderGuiItem). */
  renderGuiItem(id: number, count: number, x: number, y: number): void;
  binds: KeyBindings;
  gameMode: number;
  isKeyDown(code: string): boolean;
  readonly playerInventory: Inventory;
  /** Render the local player model in the GUI, feet at (x, y), looking toward (lookX, lookY) offsets. */
  renderPlayerPreview?(x: number, y: number, scale: number, lookX: number, lookY: number, box?: [number, number, number, number]): void;
}

/**
 * The one place an item stack is drawn in a GUI slot: icon, count (or `countText`), and the
 * durability bar. Swap the icon renderer here when the item icon API lands.
 */
export function drawStack(host: ContainerHost, st: ItemStack, x: number, y: number, countText?: string | null): void {
  const g = host.gui;
  host.renderGuiItem(st.id, 1, x, y);
  // ItemRenderer.renderGuiItemDecorations: durability bar, then the count
  const max = maxDamage(st.id);
  if (max > 0 && st.damage > 0) {
    const w = Math.round(13 - (st.damage * 13) / max);
    const f = Math.max(0, (max - st.damage) / max);
    const [r, gg, b] = hsvToRgb(f / 3, 1, 1);
    g.fill(x + 2, y + 13, 13, 2, 0xff000000);
    g.fill(x + 2, y + 13, w, 1, 0xff000000 | (r << 16) | (gg << 8) | b);
  }
  const s = countText !== undefined ? countText : st.count !== 1 ? String(st.count) : null;
  if (s) g.text(s, x + 19 - 2 - g.font.width(s), y + 6 + 3, 0xffffff, true);
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]!;
  return [Math.round(r! * 255), Math.round(g! * 255), Math.round(b! * 255)];
}

// ArmorMaterials defense per slot (feet, legs, chest, head), toughness, knockback resistance
const ARMOR: Record<string, [number[], number, number]> = {
  leather: [[1, 2, 3, 1], 0, 0], chainmail: [[1, 4, 5, 2], 0, 0], iron: [[2, 5, 6, 2], 0, 0], golden: [[1, 3, 5, 2], 0, 0],
  diamond: [[3, 6, 8, 3], 2, 0], netherite: [[3, 6, 8, 3], 3, 0.1], turtle: [[2, 5, 6, 2], 0, 0],
};
const ARMOR_PARTS = ['boots', 'leggings', 'chestplate', 'helmet'];
const ARMOR_SLOT_TEXT = ['When on Feet:', 'When on Legs:', 'When on Body:', 'When on Head:'];

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** ItemStack.getTooltipLines: name (rarity colour) and attribute modifier lines. */
export function itemTooltip(st: ItemStack): string[] {
  const lines = [rarityColor(st.id) + displayName(st.id)];
  const n = itemName(st.id);
  const dmg = attackDamageOf(st.id), spd = attackSpeedOf(st.id);
  if (dmg !== 1 || spd !== 4) {
    lines.push('', '§7When in Main Hand:', `§2 ${fmt(dmg)} Attack Damage`, `§2 ${fmt(spd)} Attack Speed`);
  }
  const m = n.match(/^(leather|chainmail|iron|golden|diamond|netherite|turtle)_(boots|leggings|chestplate|helmet)$/);
  if (m) {
    const [def, tough, kb] = ARMOR[m[1]!]!;
    const i = ARMOR_PARTS.indexOf(m[2]!);
    lines.push('', `§7${ARMOR_SLOT_TEXT[i]}`, `§9+${def[i]} Armor`);
    if (tough) lines.push(`§9+${tough} Armor Toughness`);
    if (kb) lines.push(`§9+${fmt(kb * 10)} Knockback Resistance`);
  }
  return lines;
}

function glfwButton(dom: number): number {
  return dom === 2 ? 1 : dom === 1 ? 2 : dom;
}

export function displayName(id: number): string {
  return ITEMS_BY_ID[id]?.displayName ?? itemName(id);
}

const EPIC = new Set(['enchanted_golden_apple', 'dragon_egg', 'command_block', 'chain_command_block', 'repeating_command_block', 'command_block_minecart', 'structure_block', 'jigsaw', 'debug_stick', 'knowledge_book', 'barrier', 'light', 'mojang_banner_pattern']);
const RARE = new Set(['golden_apple', 'beacon', 'conduit', 'end_crystal', 'trident']);
const UNCOMMON = new Set(['experience_bottle', 'dragon_breath', 'enchanted_book', 'creeper_head', 'zombie_head', 'player_head', 'skeleton_skull', 'wither_skeleton_skull', 'dragon_head', 'elytra', 'totem_of_undying', 'nether_star', 'heart_of_the_sea', 'creeper_banner_pattern', 'skull_banner_pattern']);

/** Item name colour by rarity (Rarity: uncommon yellow, rare aqua, epic light purple). */
function rarityColor(id: number): string {
  const n = itemName(id);
  if (EPIC.has(n)) return '§d';
  if (RARE.has(n) || n.startsWith('music_disc_')) return '§b';
  if (UNCOMMON.has(n)) return '§e';
  return '';
}

export abstract class AbstractContainerScreen<M extends Menu = Menu> extends Screen {
  leftPos = 0;
  topPos = 0;
  protected titleLabelX = 8;
  protected titleLabelY = 6;
  protected inventoryLabelX = 8;
  protected inventoryLabelY = 0;
  protected showInventoryLabel = true;
  protected hoveredSlot: Slot | null = null;
  // drag splitting (isQuickCrafting) and double-click state
  private quickCrafting = false;
  private quickCraftingButton = 0;
  private quickCraftingType = 0;
  private readonly quickCraftSlots = new Set<Slot>();
  private quickCraftingRemaining = 0;
  private skipNextRelease = false;
  private doubleclick = false;
  private lastClickSlot: Slot | null = null;
  private lastClickTime = 0;
  private lastClickButton = -1;
  private lastQuickMoved: ItemStack | null = null;
  private mouseX = 0;
  private mouseY = 0;
  /** set when the server closed the window (no close packet back) */
  closedByServer = false;

  constructor(
    protected host: ContainerHost,
    readonly menu: M,
    title: string,
  ) {
    super(host.gui, title);
    this.pausesGame = false;
  }

  get imageWidth(): number {
    return this.menu.imageWidth;
  }
  get imageHeight(): number {
    return this.menu.imageHeight;
  }

  init(): void {
    this.leftPos = Math.floor((this.gui.width - this.imageWidth) / 2);
    this.topPos = Math.floor((this.gui.height - this.imageHeight) / 2);
    this.inventoryLabelY = this.imageHeight - 94;
    this.widgets = [];
  }

  protected get player(): MenuPlayer {
    return { inventory: this.host.playerInventory, creative: this.host.gameMode === 1, drop: () => {} };
  }

  // ---------------------------------------------------------------- rendering
  protected abstract renderBg(mx: number, my: number): void;

  protected renderLabels(): void {
    const g = this.gui;
    g.text(this.title, this.leftPos + this.titleLabelX, this.topPos + this.titleLabelY, 0x404040, false);
    if (this.showInventoryLabel) g.text('Inventory', this.leftPos + this.inventoryLabelX, this.topPos + this.inventoryLabelY, 0x404040, false);
  }

  /** Slot wells for every slot (subclasses draw extra decorations). */
  protected renderSlotWells(): void {
    for (const s of this.menu.slots) slotWell(this.gui, this.leftPos + s.x, this.topPos + s.y);
  }

  override render(mx: number, my: number): void {
    this.mouseX = mx;
    this.mouseY = my;
    this.renderBackground();
    this.renderBg(mx, my);
    this.renderLabels();
    const g = this.gui;
    this.hoveredSlot = null;
    for (const s of this.menu.slots) {
      this.renderSlot(s);
      if (this.isHovering(s, mx, my)) {
        this.hoveredSlot = s;
        // AbstractContainerScreen.renderSlotHighlight: white at 50% over the slot
        g.fill(this.leftPos + s.x, this.topPos + s.y, 16, 16, 0x80ffffff);
      }
    }
    this.renderExtra(mx, my);
    // carried stack follows the mouse
    const carried = this.menu.carried;
    if (!isEmpty(carried)) {
      let text: string | null | undefined;
      if (this.quickCrafting && this.quickCraftSlots.size > 1) {
        text = this.quickCraftingRemaining === 0 ? '§e0' : String(this.quickCraftingRemaining);
        if (this.quickCraftingRemaining === 1) text = null;
      }
      drawStack(this.host, carried, Math.floor(mx) - 8, Math.floor(my) - 8, text);
    } else if (this.hoveredSlot?.hasItem()) {
      const st = this.hoveredSlot.getItem()!;
      tooltip(g, this.tooltipLines(st), mx, my);
    }
  }

  protected tooltipLines(st: ItemStack): string[] {
    return itemTooltip(st);
  }

  protected renderExtra(_mx: number, _my: number): void {}

  private renderSlot(s: Slot): void {
    const x = this.leftPos + s.x, y = this.topPos + s.y;
    let st = s.getItem();
    let text: string | null | undefined;
    const carried = this.menu.carried;
    let dragged = false;
    if (this.quickCrafting && this.quickCraftSlots.has(s) && !isEmpty(carried)) {
      if (this.quickCraftSlots.size === 1) return this.renderSlotItem(s, st, x, y, text);
      if (canItemQuickReplace(s, carried, true) && this.menu.canDragTo(s)) {
        const pred = copyStack(carried)!;
        dragged = true;
        quickCraftSlotCount(this.quickCraftSlots.size, this.quickCraftingType, pred, st?.count ?? 0);
        const k = Math.min(maxStackSize(pred.id), s.getMaxStackSizeFor(pred));
        if (pred.count > k) {
          text = `§e${k}`;
          pred.count = k;
        }
        st = pred;
      } else {
        this.quickCraftSlots.delete(s);
        this.recalculateQuickCraftRemaining();
      }
    }
    if (dragged) this.gui.fill(x, y, 16, 16, 0x80ffffff);
    this.renderSlotItem(s, st, x, y, text);
  }

  protected renderSlotItem(s: Slot, st: ItemStack | null, x: number, y: number, text?: string | null): void {
    if (isEmpty(st)) {
      const icon = this.emptySlotIcon(s);
      if (icon) silhouette(this.gui, x, y, icon);
      return;
    }
    drawStack(this.host, st, x, y, text);
  }

  protected emptySlotIcon(_s: Slot): 'head' | 'chest' | 'legs' | 'feet' | 'offhand' | null {
    return null;
  }

  private recalculateQuickCraftRemaining(): void {
    const c = this.menu.carried;
    if (isEmpty(c) || !this.quickCrafting) return;
    if (this.quickCraftingType === 2) {
      this.quickCraftingRemaining = maxStackSize(c.id);
      return;
    }
    this.quickCraftingRemaining = c.count;
    for (const s of this.quickCraftSlots) {
      const pred = copyStack(c)!;
      const cur = s.getItem()?.count ?? 0;
      quickCraftSlotCount(this.quickCraftSlots.size, this.quickCraftingType, pred, cur);
      const k = Math.min(maxStackSize(pred.id), s.getMaxStackSizeFor(pred));
      if (pred.count > k) pred.count = k;
      this.quickCraftingRemaining -= pred.count - cur;
    }
  }

  // ---------------------------------------------------------------- input
  private isHovering(s: Slot, mx: number, my: number): boolean {
    const x = mx - this.leftPos, y = my - this.topPos;
    return x >= s.x - 1 && x < s.x + 16 + 1 && y >= s.y - 1 && y < s.y + 16 + 1;
  }

  protected findSlot(mx: number, my: number): Slot | null {
    for (const s of this.menu.slots) if (this.isHovering(s, mx, my)) return s;
    return null;
  }

  protected hasClickedOutside(mx: number, my: number): boolean {
    return mx < this.leftPos || my < this.topPos || mx >= this.leftPos + this.imageWidth || my >= this.topPos + this.imageHeight;
  }

  private shiftDown(): boolean {
    return this.host.isKeyDown('ShiftLeft') || this.host.isKeyDown('ShiftRight');
  }

  private isPickButton(button: number): boolean {
    return this.host.binds.key('pickItem') === `Mouse${button}`;
  }

  /** gameMode.handleInventoryMouseClick: predict locally, tell the server. */
  protected slotClicked(slot: Slot | null, slotId: number, button: number, type: ClickType): void {
    if (slot) slotId = slot.index;
    this.menu.clicked(slotId, button, type, this.player);
    this.host.send({ t: 'clickWindow', windowId: this.menu.containerId, slot: slotId, button, clickType: type });
  }

  /** Extra widgets (creative tabs, scrollbar) get first go; return true to consume. */
  protected mouseClickedExtra(_mx: number, _my: number, _button: number): boolean {
    return false;
  }

  override mouseButton(mx: number, my: number, domButton: number): boolean {
    // DOM buttons (0 left, 1 middle, 2 right) → vanilla/GLFW numbering (0 left, 1 right, 2 middle)
    const button = glfwButton(domButton);
    if (this.mouseClickedExtra(mx, my, button)) return true;
    const pick = this.isPickButton(domButton);
    const slot = this.findSlot(mx, my);
    const now = performance.now();
    this.doubleclick = this.lastClickSlot === slot && now - this.lastClickTime < 250 && this.lastClickButton === button;
    this.skipNextRelease = false;
    if (button !== 0 && button !== 1 && !pick) {
      this.checkHotbarMouse(domButton);
    } else {
      const outside = this.hasClickedOutside(mx, my);
      let slotId = slot ? slot.index : -1;
      if (outside) slotId = SLOT_OUTSIDE;
      if (!this.quickCrafting) {
        if (isEmpty(this.menu.carried)) {
          if (pick) this.slotClicked(slot, slotId, button, ClickType.CLONE);
          else {
            const shift = slotId !== SLOT_OUTSIDE && this.shiftDown();
            let type = ClickType.PICKUP;
            if (shift) {
              this.lastQuickMoved = slot?.hasItem() ? copyStack(slot.getItem()) : null;
              type = ClickType.QUICK_MOVE;
            } else if (slotId === SLOT_OUTSIDE) type = ClickType.THROW;
            this.slotClicked(slot, slotId, button, type);
          }
          this.skipNextRelease = true;
        } else {
          this.quickCrafting = true;
          this.quickCraftingButton = button;
          this.quickCraftSlots.clear();
          this.quickCraftingType = button === 0 ? 0 : button === 1 ? 1 : 2;
        }
      }
    }
    this.lastClickSlot = slot;
    this.lastClickTime = now;
    this.lastClickButton = button;
    return true;
  }

  private checkHotbarMouse(button: number): void {
    if (!this.hoveredSlot || !isEmpty(this.menu.carried)) return;
    const code = `Mouse${button}`;
    if (this.host.binds.key('swapOffhand') === code) return this.slotClicked(this.hoveredSlot, this.hoveredSlot.index, 40, ClickType.SWAP);
    for (let i = 0; i < 9; i++) if (this.host.binds.key(`hotbar.${i + 1}`) === code) this.slotClicked(this.hoveredSlot, this.hoveredSlot.index, i, ClickType.SWAP);
  }

  override mouseMove(mx: number, my: number): void {
    this.mouseX = mx;
    this.mouseY = my;
    const slot = this.findSlot(mx, my);
    const c = this.menu.carried;
    if (this.quickCrafting && slot && !isEmpty(c) && (c.count > this.quickCraftSlots.size || this.quickCraftingType === 2) && canItemQuickReplace(slot, c, true) && slot.mayPlace(c) && this.menu.canDragTo(slot)) {
      this.quickCraftSlots.add(slot);
      this.recalculateQuickCraftRemaining();
    }
  }

  override mouseUp(domButton = 0): void {
    const button = glfwButton(domButton);
    const mx = this.mouseX, my = this.mouseY;
    const slot = this.findSlot(mx, my);
    const outside = this.hasClickedOutside(mx, my);
    let slotId = slot ? slot.index : -1;
    if (outside) slotId = SLOT_OUTSIDE;
    const pick = this.isPickButton(domButton);
    if (this.doubleclick && slot && button === 0 && this.menu.canTakeItemForPickAll({ id: 0, count: 0, damage: 0 }, slot)) {
      if (this.shiftDown()) {
        const lq = this.lastQuickMoved;
        if (lq) {
          for (const s2 of this.menu.slots) {
            if (s2.mayPickup(this.player) && s2.hasItem() && s2.container === slot.container && canItemQuickReplace(s2, lq, true)) this.slotClicked(s2, s2.index, button, ClickType.QUICK_MOVE);
          }
        }
      } else this.slotClicked(slot, slotId, button, ClickType.PICKUP_ALL);
      this.doubleclick = false;
      this.lastClickTime = 0;
    } else {
      if (this.quickCrafting && this.quickCraftingButton !== button) {
        this.quickCrafting = false;
        this.quickCraftSlots.clear();
        this.skipNextRelease = true;
        return;
      }
      if (this.skipNextRelease) {
        this.skipNextRelease = false;
        return;
      }
      if (this.quickCrafting && this.quickCraftSlots.size > 0) {
        const t = this.quickCraftingType;
        this.slotClicked(null, SLOT_OUTSIDE, 0 | (t << 2), ClickType.QUICK_CRAFT);
        for (const s of [...this.quickCraftSlots]) this.slotClicked(s, s.index, 1 | (t << 2), ClickType.QUICK_CRAFT);
        this.slotClicked(null, SLOT_OUTSIDE, 2 | (t << 2), ClickType.QUICK_CRAFT);
      } else if (!isEmpty(this.menu.carried)) {
        if (pick) this.slotClicked(slot, slotId, button, ClickType.CLONE);
        else {
          const shift = slotId !== SLOT_OUTSIDE && this.shiftDown();
          if (shift) this.lastQuickMoved = slot?.hasItem() ? copyStack(slot.getItem()) : null;
          this.slotClicked(slot, slotId, button, shift ? ClickType.QUICK_MOVE : ClickType.PICKUP);
        }
      }
    }
    if (isEmpty(this.menu.carried)) this.lastClickTime = 0;
    this.quickCrafting = false;
    this.quickCraftSlots.clear();
  }

  override keyDown(code: string): boolean {
    const b = this.host.binds;
    if (code === 'Escape' || code === b.key('inventory')) {
      this.host.setScreen(null);
      return true;
    }
    // checkHotbarKeyPressed
    if (isEmpty(this.menu.carried) && this.hoveredSlot) {
      if (code === b.key('swapOffhand')) {
        this.slotClicked(this.hoveredSlot, this.hoveredSlot.index, 40, ClickType.SWAP);
        return true;
      }
      for (let i = 0; i < 9; i++)
        if (code === b.key(`hotbar.${i + 1}`)) {
          this.slotClicked(this.hoveredSlot, this.hoveredSlot.index, i, ClickType.SWAP);
          return true;
        }
    }
    if (this.hoveredSlot?.hasItem()) {
      if (code === b.key('pickItem')) this.slotClicked(this.hoveredSlot, this.hoveredSlot.index, 0, ClickType.CLONE);
      else if (code === b.key('drop')) {
        const ctrl = this.host.isKeyDown('ControlLeft') || this.host.isKeyDown('ControlRight') || this.host.isKeyDown('MetaLeft');
        this.slotClicked(this.hoveredSlot, this.hoveredSlot.index, ctrl ? 1 : 0, ClickType.THROW);
      }
    }
    return true;
  }

  override onClose(): void {
    // predict the grid/cursor returning, then tell the server (unless it closed us)
    this.menu.removed(this.player);
    if (!this.closedByServer) this.host.send({ t: 'closeWindow', windowId: this.menu.containerId });
  }
}

// ------------------------------------------------------------------ concrete screens
/** InventoryScreen: armour, player preview, 2×2 crafting, off hand. */
export class InventoryScreen extends AbstractContainerScreen<InventoryMenu> {
  constructor(host: ContainerHost, menu: InventoryMenu) {
    super(host, menu, 'Crafting');
    this.titleLabelX = 97;
    this.titleLabelY = 8;
    this.showInventoryLabel = false;
  }
  protected renderBg(mx: number, my: number): void {
    const g = this.gui, l = this.leftPos, t = this.topPos;
    panel(g, l, t, this.imageWidth, this.imageHeight);
    for (const s of this.menu.slots) slotWell(g, l + s.x, t + s.y);
    // the black box the player stands in
    inset(g, l + 25, t + 7, 52, 72, 0xff000000);
    arrow(g, l + 135, t + 29, 16, 13);
    this.host.renderPlayerPreview?.(l + 51, t + 75, 30, l + 51 - mx, t + 75 - 50 - my, [l + 26, t + 8, 50, 70]);
  }
  protected override emptySlotIcon(s: Slot): 'head' | 'chest' | 'legs' | 'feet' | 'offhand' | null {
    return s.index === 5 ? 'head' : s.index === 6 ? 'chest' : s.index === 7 ? 'legs' : s.index === 8 ? 'feet' : s.index === 45 ? 'offhand' : null;
  }
}

/** CraftingScreen (crafting table). */
export class CraftingScreen extends AbstractContainerScreen<CraftingMenu> {
  constructor(host: ContainerHost, menu: CraftingMenu, title: string) {
    super(host, menu, title);
    this.titleLabelX = 29;
  }
  protected renderBg(): void {
    const g = this.gui, l = this.leftPos, t = this.topPos;
    panel(g, l, t, this.imageWidth, this.imageHeight);
    for (const s of this.menu.slots) {
      if (s.index === 0) resultSlot(g, l + s.x, t + s.y);
      else slotWell(g, l + s.x, t + s.y);
    }
    arrow(g, l + 90, t + 35, 22, 15);
  }
}

/** ContainerScreen (chests, barrels, ender chests): 3 or 6 rows. */
export class ChestScreen extends AbstractContainerScreen<ChestMenu> {
  protected renderBg(): void {
    const g = this.gui, l = this.leftPos, t = this.topPos;
    panel(g, l, t, this.imageWidth, this.imageHeight);
    this.renderSlotWells();
  }
}

/** AbstractFurnaceScreen: flame (fuel left) and arrow (cook progress). */
export class FurnaceScreen extends AbstractContainerScreen<FurnaceMenu> {
  constructor(host: ContainerHost, menu: FurnaceMenu, title: string) {
    super(host, menu, title);
  }
  override init(): void {
    super.init();
    this.titleLabelX = Math.floor((this.imageWidth - this.gui.font.width(this.title)) / 2);
  }
  protected renderBg(): void {
    const g = this.gui, l = this.leftPos, t = this.topPos;
    panel(g, l, t, this.imageWidth, this.imageHeight);
    for (const s of this.menu.slots) {
      if (s.index === 2) resultSlot(g, l + s.x, t + s.y);
      else slotWell(g, l + s.x, t + s.y);
    }
    flame(g, l + 56, t + 36, this.menu.isLit() ? this.menu.litProgress() + 1 : 0);
    arrow(g, l + 79, t + 34, 24, 17, this.menu.burnProgress() + 1 > 1 ? this.menu.burnProgress() + 1 : 0);
  }
}

/** DispenserScreen / HopperScreen: a panel with the container's slot wells. */
export class SimpleContainerScreen extends AbstractContainerScreen<Menu> {
  protected renderBg(): void {
    panel(this.gui, this.leftPos, this.topPos, this.imageWidth, this.imageHeight);
    this.renderSlotWells();
  }
  override init(): void {
    super.init();
    if (this.menu.type === 'generic_3x3') this.titleLabelX = Math.floor((this.imageWidth - this.gui.font.width(this.title)) / 2);
  }
}

/** Screen for a server-opened menu. */
export function screenForMenu(host: ContainerHost, menu: Menu, title: string): AbstractContainerScreen {
  if (menu instanceof CraftingMenu) return new CraftingScreen(host, menu, title);
  if (menu instanceof FurnaceMenu) return new FurnaceScreen(host, menu, title);
  if (menu instanceof InventoryMenu) return new InventoryScreen(host, menu);
  if (menu.type === 'generic_3x3' || menu.type === 'hopper') return new SimpleContainerScreen(host, menu, title);
  return new ChestScreen(host, menu as ChestMenu, title);
}
