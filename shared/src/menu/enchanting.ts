/**
 * EnchantmentMenu (vanilla 1.17.1): item slot, lapis slot, the three offers in ContainerData
 * (costs 0–2, enchantment seed 3, clue enchantment ids 4–6, clue levels 7–9) and the enchant
 * button. Offers are computed only where an environment (the server) is attached; the client
 * mirror just shows the synced data.
 */
import { Menu, Slot, placeBack, CLIENT_MENU_FACTORIES, type MenuPlayer } from './menu';
import { SimpleContainer, copyStack, type Container } from './container';
import { ITEMS_BY_NAME } from '../data';
import { isEmpty, type ItemStack } from '../item/stack';
import { enchantOffers, clickEnchant, type EnchantOffers } from '../game/enchantments';

const LAPIS = ITEMS_BY_NAME.get('lapis_lazuli')?.id ?? -1;

export interface EnchantEnv {
  /** bookshelves around the table (EnchantmentMenu bookshelf loop) */
  bookshelves(): number;
  /** Player.getEnchantmentSeed */
  seed(): number;
  /** Player.experienceLevel */
  level(): number;
  /** Player.onEnchantmentPerformed: spend levels and roll a new seed */
  onEnchantmentPerformed(levels: number): void;
  /** ENCHANTMENT_TABLE_USE at the table */
  sound(): void;
  valid(): boolean;
}

export class EnchantmentMenu extends Menu {
  readonly enchantSlots = new SimpleContainer(2);
  offers: EnchantOffers = { costs: [0, 0, 0], clues: [-1, -1, -1], levels: [-1, -1, -1] };

  constructor(id: number, inv: Container, private readonly env: EnchantEnv | null = null) {
    super('enchantment', id);
    this.enchantSlots.onChange = () => this.slotsChanged();
    this.addSlot(new (class extends Slot {
      override mayPlace(): boolean {
        return true;
      }
      override getMaxStackSize(): number {
        return 1;
      }
    })(this.enchantSlots, 0, 15, 47));
    this.addSlot(new (class extends Slot {
      override mayPlace(s: ItemStack): boolean {
        return s.id === LAPIS;
      }
    })(this.enchantSlots, 1, 35, 47));
    this.addPlayerInventory(inv, 84);
    this.data = [0, 0, 0, 0, -1, -1, -1, -1, -1, -1];
    if (env) this.data[3] = env.seed() & -16;
  }

  override stillValid(): boolean {
    return this.env ? this.env.valid() : true;
  }

  get costs(): number[] {
    return this.data.slice(0, 3);
  }

  /** EnchantmentMenu.slotsChanged */
  slotsChanged(): void {
    if (!this.env) return;
    const item = this.enchantSlots.getItem(0);
    this.offers = enchantOffers(item, this.env.bookshelves(), this.env.seed());
    for (let i = 0; i < 3; i++) {
      this.data[i] = this.offers.costs[i]!;
      this.data[4 + i] = this.offers.clues[i]!;
      this.data[7 + i] = this.offers.levels[i]!;
    }
    this.data[3] = this.env.seed() & -16;
  }

  /** EnchantmentMenu.clickMenuButton */
  override clickMenuButton(p: MenuPlayer, id: number): boolean {
    if (!this.env || id < 0 || id > 2) return false;
    const item = this.enchantSlots.getItem(0), lapis = this.enchantSlots.getItem(1);
    const res = clickEnchant(item, lapis?.count ?? 0, this.env.level(), p.creative, this.offers, this.env.seed(), id);
    if (!res.ok) return false;
    if (!res.result) return true;
    this.env.onEnchantmentPerformed(res.levelsSpent!);
    this.enchantSlots.items[0] = res.result;
    if (res.lapisSpent && lapis) {
      lapis.count -= res.lapisSpent;
      if (lapis.count <= 0) this.enchantSlots.items[1] = null;
    }
    this.env.sound();
    this.slotsChanged();
    return true;
  }

  /** EnchantmentMenu.quickMoveStack */
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index === 0) {
      if (!this.moveItemStackTo(st, 2, 38, true)) return null;
    } else if (index === 1) {
      if (!this.moveItemStackTo(st, 2, 38, true)) return null;
    } else if (st.id === LAPIS) {
      if (!this.moveItemStackTo(st, 1, 2, true)) return null;
    } else {
      if (this.slots[0]!.hasItem() || !this.slots[0]!.mayPlace(st)) return null;
      const one = copyStack(st)!;
      one.count = 1;
      st.count--;
      this.slots[0]!.set(one);
    }
    return this.finishQuickMove(slot, st, orig, p);
  }

  /** EnchantmentMenu.removed: both slots go back to the player. */
  override removed(p: MenuPlayer): void {
    super.removed(p);
    if (!this.env) return;
    for (let i = 0; i < 2; i++) {
      const it = this.enchantSlots.items[i];
      this.enchantSlots.items[i] = null;
      if (!isEmpty(it)) placeBack(p, it);
    }
  }
}

CLIENT_MENU_FACTORIES.set('enchantment', (id, inv) => new EnchantmentMenu(id, inv));
