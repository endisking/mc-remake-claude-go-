/**
 * AnvilMenu (vanilla 1.17.1): repair with material, combine two items or an enchanted book,
 * rename, the level cost with the prior-work penalty (RepairCost), "Too Expensive!" at 40,
 * and anvil damage on use. Slots 0 left, 1 right, 2 result, 3–38 player inventory; data 0 = cost.
 */
import { Menu, Slot, placeBack, CLIENT_MENU_FACTORIES, type MenuPlayer } from './menu';
import { SimpleContainer, ResultContainer, copyStack, type Container } from './container';
import { ITEMS_BY_ID, ITEMS_BY_NAME } from '../data';
import { isEmpty, type ItemStack, type EnchEntry } from '../item/stack';
import { ENCH_BY_NAME, canEnchantItem, isCompatible, increasedRepairCost, enchantmentsOf } from '../game/enchantments';

const ENCHANTED_BOOK = ITEMS_BY_NAME.get('enchanted_book')?.id ?? -1;

const baseRepairCost = (s: ItemStack | null) => (s?.tag?.RepairCost as number | undefined) ?? 0;
const maxDamage = (id: number) => ITEMS_BY_ID[id]?.maxDurability ?? 0;
const nameOf = (id: number) => ITEMS_BY_ID[id]?.name ?? '';
const strip = (id: string) => id.replace(/^minecraft:/, '');

/** Item.isValidRepairItem (minecraft-data repairWith: material items, e.g. diamond for diamond tools). */
export function isValidRepairItem(item: ItemStack, material: ItemStack): boolean {
  return (ITEMS_BY_ID[item.id]?.repairWith ?? []).includes(nameOf(material.id));
}

/** Rarity → anvil cost multiplier (COMMON 1, UNCOMMON 2, RARE 4, VERY_RARE 8) from the weight. */
const rarityCost = (weight: number) => (weight >= 10 ? 1 : weight >= 5 ? 2 : weight >= 2 ? 4 : 8);

export interface AnvilResult {
  result: ItemStack | null;
  cost: number;
  /** material items used by a repair (repairItemCountCost) */
  repairItemCount: number;
}

/** AnvilMenu.createResult. `name` is the rename box text (null/blank = keep/clear the custom name). */
export function anvilResult(left: ItemStack | null, right: ItemStack | null, name: string | null, creative: boolean): AnvilResult {
  const none: AnvilResult = { result: null, cost: 0, repairItemCount: 0 };
  if (isEmpty(left)) return none;
  let i = 0, k = 0;
  const out = copyStack(left)!;
  const map = new Map<string, number>(enchantmentsOf(out).map((e) => [strip(e.id), e.lvl]));
  const j = baseRepairCost(left) + (isEmpty(right) ? 0 : baseRepairCost(right));
  let repairItemCount = 0;
  if (!isEmpty(right)) {
    const book = right.id === ENCHANTED_BOOK && enchantmentsOf(right).length > 0;
    const max = maxDamage(out.id);
    if (max > 0 && isValidRepairItem(left, right)) {
      let l2 = Math.min(out.damage, Math.floor(max / 4));
      if (l2 <= 0) return none;
      let i3 = 0;
      for (; l2 > 0 && i3 < right.count; i3++) {
        out.damage -= l2;
        i++;
        l2 = Math.min(out.damage, Math.floor(max / 4));
      }
      repairItemCount = i3;
    } else {
      if (!book && (out.id !== right.id || max <= 0)) return none;
      if (max > 0 && !book) {
        const l = max - left.damage;
        const i1 = maxDamage(right.id) - right.damage;
        const j1 = i1 + Math.floor((max * 12) / 100);
        let l1 = max - (l + j1);
        if (l1 < 0) l1 = 0;
        if (l1 < out.damage) {
          out.damage = l1;
          i += 2;
        }
      }
      let added = false, rejected = false;
      for (const e of enchantmentsOf(right)) {
        const en = ENCH_BY_NAME.get(strip(e.id));
        if (!en) continue;
        const i2 = map.get(en.name) ?? 0;
        let j2 = e.lvl;
        j2 = i2 === j2 ? j2 + 1 : Math.max(j2, i2);
        let ok = canEnchantItem(en, left.id);
        if (creative || left.id === ENCHANTED_BOOK) ok = true;
        for (const other of map.keys()) {
          const o = ENCH_BY_NAME.get(other);
          if (o && o !== en && !isCompatible(en, o)) {
            ok = false;
            i++;
          }
        }
        if (!ok) rejected = true;
        else {
          added = true;
          if (j2 > en.maxLevel) j2 = en.maxLevel;
          map.set(en.name, j2);
          let k3 = rarityCost(en.weight);
          if (book) k3 = Math.max(1, Math.floor(k3 / 2));
          i += k3 * j2;
          if (left.count > 1) i = 40;
        }
      }
      if (rejected && !added) return none;
    }
  }
  const custom = left.tag?.display?.Name;
  if (name === null || name.trim() === '') {
    if (custom) {
      k = 1;
      i += k;
      if (out.tag?.display) delete out.tag.display.Name;
      if (out.tag?.display && Object.keys(out.tag.display).length === 0) delete out.tag.display;
    }
  } else if (name !== (custom ?? ITEMS_BY_ID[left.id]?.displayName)) {
    k = 1;
    i += k;
    out.tag ??= {};
    out.tag.display = { ...(out.tag.display ?? {}), Name: name };
  }
  let cost = j + i;
  let result: ItemStack | null = out;
  if (i <= 0) result = null;
  if (k === i && k > 0 && cost >= 40) cost = 39;
  if (cost >= 40 && !creative) result = null;
  if (result) {
    let k2 = baseRepairCost(result);
    if (!isEmpty(right) && k2 < baseRepairCost(right)) k2 = baseRepairCost(right);
    if (k !== i || k === 0) k2 = increasedRepairCost(k2);
    result.tag ??= {};
    result.tag.RepairCost = k2;
    // EnchantmentHelper.setEnchantments (stored on books)
    const list: EnchEntry[] = [...map].map(([id, lvl]) => ({ id, lvl }));
    const key = result.id === ENCHANTED_BOOK ? 'StoredEnchantments' : 'Enchantments';
    if (list.length) result.tag[key] = list;
    else delete result.tag[key];
  }
  return { result, cost, repairItemCount };
}

export interface AnvilEnv {
  level(): number;
  /** levels spent and the anvil-use side effects (damage roll, sounds) */
  onTake(cost: number): void;
  valid(): boolean;
}

export class AnvilMenu extends Menu {
  readonly inputs = new SimpleContainer(2);
  readonly result = new ResultContainer();
  itemName: string | null = null;
  private repairItemCount = 0;

  constructor(id: number, inv: Container, private readonly env: AnvilEnv | null = null, private readonly creative = false) {
    super('anvil', id);
    this.inputs.onChange = () => this.createResult();
    this.addSlot(new Slot(this.inputs, 0, 27, 47));
    this.addSlot(new Slot(this.inputs, 1, 76, 47));
    const menu = this;
    this.addSlot(new (class extends Slot {
      override mayPlace(): boolean {
        return false;
      }
      override mayPickup(p: MenuPlayer): boolean {
        const cost = menu.data[0] ?? 0;
        return (p.creative || (menu.env?.level() ?? 0) >= cost) && cost > 0 && !!menu.result.items[0];
      }
      override onTake(p: MenuPlayer, st: ItemStack): void {
        const cost = menu.data[0] ?? 0;
        menu.inputs.items[0] = null;
        const r = menu.inputs.items[1];
        if (menu.repairItemCount > 0 && r && r.count > menu.repairItemCount) r.count -= menu.repairItemCount;
        else menu.inputs.items[1] = null;
        menu.data[0] = 0;
        menu.env?.onTake(p.creative ? 0 : cost);
        menu.createResult();
        super.onTake(p, st);
      }
    })(this.result, 0, 134, 47));
    this.addPlayerInventory(inv, 84);
    this.data = [0];
  }

  override stillValid(): boolean {
    return this.env ? this.env.valid() : true;
  }

  /** ServerboundRenameItemPacket → AnvilMenu.setItemName */
  setItemName(name: string): void {
    this.itemName = name.slice(0, 50);
    const out = this.result.items[0];
    if (out) this.createResult();
  }

  createResult(): void {
    if (!this.env) return;
    const r = anvilResult(this.inputs.getItem(0), this.inputs.getItem(1), this.itemName, this.creative);
    this.result.items[0] = r.result;
    this.data[0] = r.cost;
    this.repairItemCount = r.repairItemCount;
  }

  /** ItemCombinerMenu.quickMoveStack */
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index === 2) {
      if (!slot.mayPickup(p)) return null;
      if (!this.moveItemStackTo(st, 3, 39, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index !== 0 && index !== 1) {
      if (index >= 3 && index < 39 && !this.moveItemStackTo(st, 0, 2, false)) return null;
    } else if (!this.moveItemStackTo(st, 3, 39, false)) return null;
    return this.finishQuickMove(slot, st, orig, p);
  }

  override removed(p: MenuPlayer): void {
    super.removed(p);
    if (!this.env) return;
    for (let i = 0; i < 2; i++) {
      const it = this.inputs.items[i];
      this.inputs.items[i] = null;
      if (!isEmpty(it)) placeBack(p, it);
    }
  }
}

CLIENT_MENU_FACTORIES.set('anvil', (id, inv) => new AnvilMenu(id, inv));
