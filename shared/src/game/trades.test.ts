import { describe, it, expect } from 'vitest';
import { JavaRandom } from '../util/random';
import { itemName, stack, Inventory } from '../item/stack';
import { MerchantMenu, ClickType } from '../menu/menu';
import { InventoryContainer } from '../menu/container';
import { VILLAGER_TRADES, WANDERING_TRADES, offersForLevel, costA, takeOffer, updateDemand, isOutOfStock, JOB_SITES, maxXp, minXp, PROFESSIONS } from './trades';

describe('villager trades (VillagerTrades 1.17.1)', () => {
  it('every listing of every profession and the wandering trader builds valid stacks', () => {
    const r = new JavaRandom(1n);
    for (const levels of [...Object.values(VILLAGER_TRADES), WANDERING_TRADES])
      for (const lv of levels!) for (const l of lv) {
        const o = l(r);
        expect(o.costA.count).toBeGreaterThan(0);
        expect(itemName(o.result.id)).not.toBe('air');
      }
    for (const p of PROFESSIONS) if (p !== 'none' && p !== 'nitwit') expect(VILLAGER_TRADES[p]?.length).toBe(5);
  });
  it('picks 2 distinct offers per level; farmer novice buys crops for emeralds', () => {
    const o = offersForLevel('farmer', 1, new JavaRandom(5n));
    expect(o.length).toBe(2);
    expect(o[0]!.costA).not.toEqual(o[1]!.costA);
    const all = VILLAGER_TRADES.farmer![0]!.map((l) => l(new JavaRandom(0n)));
    const wheat = all.find((x) => itemName(x.costA.id) === 'wheat')!;
    expect(wheat.costA.count).toBe(20);
    expect(itemName(wheat.result.id)).toBe('emerald');
    expect(wheat.maxUses).toBe(16);
    expect(wheat.xp).toBe(2);
  });
  it('demand raises the price after a restock of a sold-out offer', () => {
    const o = VILLAGER_TRADES.armorer![0]![1]!(new JavaRandom(0n)); // 7 emeralds → iron leggings, mult 0.2
    expect(costA(o).count).toBe(7);
    for (let i = 0; i < 12; i++) expect(takeOffer(o, stack('emerald', 64), null)).toBe(true);
    expect(isOutOfStock(o)).toBe(true);
    expect(takeOffer(o, stack('emerald', 64), null)).toBe(false);
    updateDemand(o);
    expect(o.demand).toBe(12);
    expect(costA(o).count).toBe(7 + Math.floor(7 * 12 * 0.2));
  });
  it('job sites and level xp thresholds', () => {
    expect(JOB_SITES.lectern).toBe('librarian');
    expect(JOB_SITES.water_cauldron).toBe('leatherworker');
    expect(minXp(1)).toBe(0);
    expect(maxXp(1)).toBe(10);
    expect(maxXp(4)).toBe(250);
  });
});

describe('enchanted trades', () => {
  it('librarian books store one tradeable enchantment; enchanted tools carry enchantments', () => {
    const r = new JavaRandom(9n);
    for (let i = 0; i < 20; i++) {
      const o = VILLAGER_TRADES.librarian![0]![1]!(r);
      expect(itemName(o.result.id)).toBe('enchanted_book');
      expect(o.result.tag?.StoredEnchantments?.length).toBe(1);
      expect(itemName(o.costB!.id)).toBe('book');
      expect(o.costA.count).toBeLessThanOrEqual(64);
    }
    const sword = VILLAGER_TRADES.weaponsmith![4]![0]!(r);
    expect(itemName(sword.result.id)).toBe('diamond_sword');
    expect(sword.result.tag?.Enchantments?.length).toBeGreaterThan(0);
  });
});

describe('MerchantMenu', () => {
  it('selecting an offer moves the payment in; shift-taking the result pays and counts uses', () => {
    const inv = new Inventory();
    inv.set(0, stack('wheat', 45));
    const m = new MerchantMenu(1, new InventoryContainer(inv));
    const o = VILLAGER_TRADES.farmer![0]![0]!(new JavaRandom(0n)); // 20 wheat → emerald
    m.setOffers([o]);
    const p = { inventory: inv, creative: false, drop: () => {} };
    m.clickMenuButton(p, 0);
    expect(m.payments.getItem(0)?.count).toBe(45);
    expect(itemName(m.result.getItem(0)!.id)).toBe('emerald');
    m.clicked(2, 0, ClickType.QUICK_MOVE, p);
    expect(o.uses).toBe(2);
    expect(m.payments.getItem(0)?.count ?? 0).toBe(5);
    expect(m.result.getItem(0)).toBeNull();
  });
});
