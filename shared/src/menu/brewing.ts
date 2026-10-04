/**
 * BrewingStandMenu (vanilla 1.17.1): bottles 0–2, ingredient 3, blaze powder 4, player
 * inventory 5–40; ContainerData 0 brew time, 1 fuel.
 */
import { Menu, Slot, CLIENT_MENU_FACTORIES, type MenuPlayer } from './menu';
import { SimpleContainer, copyStack, splitStack, type Container } from './container';
import { isEmpty, type ItemStack } from '../item/stack';
import { isBrewingBottle, isBrewingFuel, isIngredient, type BrewingData } from '../game/potions';

/** The brewing stand block entity as a Container. */
export class BrewingContainer implements Container {
  constructor(readonly data: BrewingData, private readonly changed: () => void = () => {}, readonly valid: () => boolean = () => true) {}
  size(): number {
    return 5;
  }
  getItem(i: number): ItemStack | null {
    const s = this.data.items[i];
    if (isEmpty(s)) {
      if (s) this.data.items[i] = null;
      return null;
    }
    return s;
  }
  setItem(i: number, s: ItemStack | null): void {
    this.data.items[i] = isEmpty(s) ? null : s;
    this.changed();
  }
  removeItem(i: number, n: number): ItemStack | null {
    const s = this.getItem(i);
    if (!s || n <= 0) return null;
    const out = splitStack(s, n);
    if (s.count <= 0) this.data.items[i] = null;
    this.changed();
    return out;
  }
  maxStackSize(): number {
    return 64;
  }
  setChanged(): void {
    this.changed();
  }
  stillValid(): boolean {
    return this.valid();
  }
}

class PotionSlot extends Slot {
  override mayPlace(s: ItemStack): boolean {
    return isBrewingBottle(s);
  }
  override getMaxStackSize(): number {
    return 1;
  }
}
class IngredientSlot extends Slot {
  override mayPlace(s: ItemStack): boolean {
    return isIngredient(s);
  }
}
class FuelSlot extends Slot {
  override mayPlace(s: ItemStack): boolean {
    return isBrewingFuel(s);
  }
}

export class BrewingStandMenu extends Menu {
  constructor(id: number, inv: Container, readonly container: Container = new SimpleContainer(5)) {
    super('brewing_stand', id);
    this.addSlot(new PotionSlot(container, 0, 56, 51));
    this.addSlot(new PotionSlot(container, 1, 79, 58));
    this.addSlot(new PotionSlot(container, 2, 102, 51));
    this.addSlot(new IngredientSlot(container, 3, 79, 17));
    this.addSlot(new FuelSlot(container, 4, 17, 17));
    this.addPlayerInventory(inv, 84);
    this.data = [0, 0];
  }

  override stillValid(): boolean {
    return this.container.stillValid?.() ?? true;
  }

  /** BrewingStandMenu.quickMoveStack */
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if ((index < 0 || index > 2) && index !== 3 && index !== 4) {
      if (isBrewingFuel(st)) {
        if (this.moveItemStackTo(st, 4, 5, false) || (isIngredient(st) && !this.moveItemStackTo(st, 3, 4, false))) return null;
      } else if (isIngredient(st)) {
        if (!this.moveItemStackTo(st, 3, 4, false)) return null;
      } else if (isBrewingBottle(st) && orig.count === 1) {
        if (!this.moveItemStackTo(st, 0, 3, false)) return null;
      } else if (index >= 5 && index < 32) {
        if (!this.moveItemStackTo(st, 32, 41, false)) return null;
      } else if (index >= 32 && index < 41) {
        if (!this.moveItemStackTo(st, 5, 32, false)) return null;
      } else if (!this.moveItemStackTo(st, 5, 41, false)) return null;
    } else {
      if (!this.moveItemStackTo(st, 5, 41, true)) return null;
      slot.onQuickCraft(st, orig);
    }
    return this.finishQuickMove(slot, st, orig, p);
  }

  get brewTime(): number {
    return this.data[0] ?? 0;
  }
  get fuel(): number {
    return this.data[1] ?? 0;
  }
}

CLIENT_MENU_FACTORIES.set('brewing_stand', (id, inv) => new BrewingStandMenu(id, inv));
