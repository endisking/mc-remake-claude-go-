import { describe, it, expect } from 'vitest';
import { Inventory, stack, type ItemStack } from '../item/stack';
import { ChestMenu, ClickType, CraftingMenu, FurnaceMenu, InventoryMenu, SLOT_OUTSIDE, type MenuPlayer } from './menu';
import { InventoryContainer, SimpleContainer } from './container';
import { craftingResult } from './recipes';
import { FurnaceContainer, newFurnace, tickFurnace, takeFurnaceExperience } from './furnace';
import { ITEMS_BY_ID } from '../data';
import { fillWithLoot } from './chestloot';

function player(creative = false): MenuPlayer & { dropped: ItemStack[] } {
  const dropped: ItemStack[] = [];
  return { inventory: new Inventory(), creative, drop: (s) => dropped.push(s), dropped };
}
const name = (s: ItemStack | null | undefined) => (s && s.count > 0 ? `${ITEMS_BY_ID[s.id]!.name}x${s.count}` : 'empty');

describe('click semantics (AbstractContainerMenu.doClick)', () => {
  it('left click picks up and places a whole stack, right click halves and places one', () => {
    const p = player();
    p.inventory.set(9, stack('cobblestone', 37));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 1, ClickType.PICKUP, p); // right: take half rounded up
    expect(name(m.carried)).toBe('cobblestonex19');
    expect(name(p.inventory.get(9))).toBe('cobblestonex18');
    m.clicked(10, 1, ClickType.PICKUP, p); // right on empty: place one
    expect(name(p.inventory.get(10))).toBe('cobblestonex1');
    expect(name(m.carried)).toBe('cobblestonex18');
    m.clicked(9, 0, ClickType.PICKUP, p); // left on same item: merge all
    expect(name(p.inventory.get(9))).toBe('cobblestonex36');
    expect(m.carried).toBeNull();
    m.clicked(9, 0, ClickType.PICKUP, p);
    expect(name(m.carried)).toBe('cobblestonex36');
  });

  it('respects max stack sizes and swaps different items', () => {
    const p = player();
    p.inventory.set(9, stack('ender_pearl', 10));
    p.inventory.set(10, stack('ender_pearl', 10));
    p.inventory.set(11, stack('dirt', 5));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 0, ClickType.PICKUP, p);
    m.clicked(10, 0, ClickType.PICKUP, p); // 10 + 10 but max 16
    expect(name(p.inventory.get(10))).toBe('ender_pearlx16');
    expect(name(m.carried)).toBe('ender_pearlx4');
    m.clicked(11, 0, ClickType.PICKUP, p); // swap
    expect(name(p.inventory.get(11))).toBe('ender_pearlx4');
    expect(name(m.carried)).toBe('dirtx5');
    m.clicked(SLOT_OUTSIDE, 1, ClickType.PICKUP, p); // drop one outside
    expect(name(m.carried)).toBe('dirtx4');
    expect(name(p.dropped[0])).toBe('dirtx1');
  });

  it('shift-click moves between main inventory and hotbar, armour to its slot', () => {
    const p = player();
    p.inventory.set(9, stack('stone', 20));
    p.inventory.set(0, stack('stone', 60));
    p.inventory.set(12, stack('iron_helmet'));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 0, ClickType.QUICK_MOVE, p); // main → hotbar: tops up slot 0 then fills slot 1
    expect(name(p.inventory.get(0))).toBe('stonex64');
    expect(name(p.inventory.get(1))).toBe('stonex16');
    expect(p.inventory.get(9)).toBeNull();
    m.clicked(12, 0, ClickType.QUICK_MOVE, p);
    expect(name(p.inventory.get(39))).toBe('iron_helmetx1');
  });

  it('number keys swap with the hotbar and the off hand (40)', () => {
    const p = player();
    p.inventory.set(9, stack('dirt', 3));
    p.inventory.set(2, stack('sand', 7));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 2, ClickType.SWAP, p);
    expect(name(p.inventory.get(9))).toBe('sandx7');
    expect(name(p.inventory.get(2))).toBe('dirtx3');
    m.clicked(9, 40, ClickType.SWAP, p);
    expect(name(p.inventory.get(40))).toBe('sandx7');
  });

  it('click-drag splits evenly (left), one each (right), full stacks in creative (middle)', () => {
    const p = player();
    p.inventory.set(9, stack('dirt', 64));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 0, ClickType.PICKUP, p);
    m.clicked(-999, 0, ClickType.QUICK_CRAFT, p); // start, left
    for (const s of [10, 11, 12]) m.clicked(s, 1, ClickType.QUICK_CRAFT, p);
    m.clicked(-999, 2, ClickType.QUICK_CRAFT, p);
    expect([10, 11, 12].map((i) => name(p.inventory.get(i)))).toEqual(['dirtx21', 'dirtx21', 'dirtx21']);
    expect(name(m.carried)).toBe('dirtx1');
    m.clicked(9, 0, ClickType.PICKUP, p);
    m.clicked(10, 0, ClickType.PICKUP, p);
    expect(name(m.carried)).toBe('dirtx21');
    m.clicked(-999, 4, ClickType.QUICK_CRAFT, p); // right drag
    for (const s of [13, 14]) m.clicked(s, 5, ClickType.QUICK_CRAFT, p);
    m.clicked(-999, 6, ClickType.QUICK_CRAFT, p);
    expect(name(p.inventory.get(13))).toBe('dirtx1');
    expect(name(m.carried)).toBe('dirtx19');
    // middle drag is creative only
    m.clicked(-999, 8, ClickType.QUICK_CRAFT, p);
    m.clicked(15, 9, ClickType.QUICK_CRAFT, p);
    m.clicked(16, 9, ClickType.QUICK_CRAFT, p);
    m.clicked(-999, 10, ClickType.QUICK_CRAFT, p);
    expect(p.inventory.get(15)).toBeNull();
    const c = player(true);
    c.inventory.set(9, stack('dirt', 1));
    const cm = new InventoryMenu(new InventoryContainer(c.inventory));
    cm.clicked(9, 0, ClickType.PICKUP, c);
    cm.clicked(-999, 8, ClickType.QUICK_CRAFT, c);
    cm.clicked(15, 9, ClickType.QUICK_CRAFT, c);
    cm.clicked(16, 9, ClickType.QUICK_CRAFT, c);
    cm.clicked(-999, 10, ClickType.QUICK_CRAFT, c);
    expect(name(c.inventory.get(15))).toBe('dirtx64');
    expect(cm.carried).toBeNull(); // vanilla: the count goes negative → empty cursor
  });

  it('double click collects matching items, partial stacks first', () => {
    const p = player();
    p.inventory.set(9, stack('dirt', 10));
    p.inventory.set(10, stack('dirt', 64));
    p.inventory.set(11, stack('dirt', 30));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 0, ClickType.PICKUP, p);
    m.clicked(9, 0, ClickType.PICKUP_ALL, p);
    // first pass skips full stacks, the second tops the cursor up from them
    expect(name(m.carried)).toBe('dirtx64');
    expect(p.inventory.get(11)).toBeNull();
    expect(name(p.inventory.get(10))).toBe('dirtx40');
  });

  it('Q / Ctrl+Q over a slot throws one or all; middle click clones in creative', () => {
    const p = player(true);
    p.inventory.set(9, stack('dirt', 10));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 0, ClickType.THROW, p);
    expect(name(p.dropped[0])).toBe('dirtx1');
    m.clicked(9, 2, ClickType.CLONE, p);
    expect(name(m.carried)).toBe('dirtx64');
    m.carried = null;
    m.clicked(9, 1, ClickType.THROW, p);
    expect(name(p.dropped[1])).toBe('dirtx9');
    expect(p.inventory.get(9)).toBeNull();
  });

  it('closing returns the carried stack and the crafting grid to the inventory', () => {
    const p = player();
    p.inventory.set(9, stack('oak_planks', 4));
    const m = new InventoryMenu(new InventoryContainer(p.inventory));
    m.clicked(9, 1, ClickType.PICKUP, p);
    m.clicked(1, 0, ClickType.PICKUP, p);
    m.clicked(9, 0, ClickType.PICKUP, p);
    expect(name(m.slots[1]!.getItem())).toBe('oak_planksx2');
    m.removed(p);
    expect(name(p.inventory.get(0))).toBe('oak_planksx4');
    expect(m.slots[1]!.getItem()).toBeNull();
  });
});

describe('crafting', () => {
  const grid = (w: number, names: (string | null)[]) => ({ width: w, height: w, items: names.map((n) => (n ? stack(n) : null)) });
  it('shapeless planks from logs', () => {
    expect(name(craftingResult(grid(2, [null, 'birch_log', null, null])))).toBe('birch_planksx4');
  });
  it('tag ingredients mix (crafting table from two kinds of planks)', () => {
    expect(name(craftingResult(grid(2, ['oak_planks', 'birch_planks', 'spruce_planks', 'oak_planks'])))).toBe('crafting_tablex1');
  });
  it('shaped recipes match anywhere in the grid and mirrored', () => {
    const axe = ['cobblestone', 'cobblestone', null, 'cobblestone', 'stick', null, null, 'stick', null];
    expect(name(craftingResult(grid(3, axe)))).toBe('stone_axex1');
    const mirrored = [null, 'cobblestone', 'cobblestone', null, 'stick', 'cobblestone', null, 'stick', null];
    expect(name(craftingResult(grid(3, mirrored)))).toBe('stone_axex1');
    expect(name(craftingResult(grid(3, [null, null, null, 'oak_planks', null, null, 'oak_planks', null, null])))).toBe('stickx4');
    expect(craftingResult(grid(3, ['oak_planks', null, null, null, 'oak_planks', null, null, null, null]))).toBeNull();
    expect(craftingResult(grid(2, ['cobblestone', 'cobblestone', 'cobblestone', null]))).toBeNull();
  });
  it('patterns are top row first (bucket, stairs, bed, door)', () => {
    expect(name(craftingResult(grid(3, ['iron_ingot', null, 'iron_ingot', null, 'iron_ingot', null, null, null, null])))).toBe('bucketx1');
    expect(craftingResult(grid(3, [null, 'iron_ingot', null, 'iron_ingot', null, 'iron_ingot', null, null, null]))).toBeNull();
    const P = 'oak_planks';
    expect(name(craftingResult(grid(3, [P, null, null, P, P, null, P, P, P])))).toBe('oak_stairsx4');
    expect(name(craftingResult(grid(3, [null, null, P, null, P, P, P, P, P])))).toBe('oak_stairsx4'); // mirrored
    expect(name(craftingResult(grid(3, ['white_wool', 'white_wool', 'white_wool', 'birch_planks', P, 'spruce_planks', null, null, null])))).toBe('white_bedx1');
    expect(name(craftingResult(grid(3, [P, P, null, P, P, null, P, P, null])))).toBe('oak_doorx3');
    expect(name(craftingResult(grid(3, ['coal', null, null, 'stick', null, null, null, null, null])))).toBe('torchx4');
    expect(name(craftingResult(grid(3, ['charcoal', null, null, 'stick', null, null, null, null, null])))).toBe('torchx4');
    expect(name(craftingResult(grid(3, ['paper', 'paper', 'leather', 'paper', null, null, null, null, null])))).toBe('bookx1');
    expect(name(craftingResult(grid(3, ['iron_ingot', null, 'iron_ingot', 'iron_ingot', 'stick', 'iron_ingot', 'iron_ingot', null, 'iron_ingot'])))).toBe('railx16');
    expect(name(craftingResult(grid(3, ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', null, 'cobbled_deepslate', 'blackstone', 'cobblestone', 'cobblestone'])))).toBe('furnacex1');
    // bamboo and planks don't mix for sticks (separate recipes in vanilla)
    expect(craftingResult(grid(3, ['bamboo', null, null, P, null, null, null, null, null]))).toBeNull();
  });
  it('shapeless in any order', () => {
    expect(name(craftingResult(grid(3, [null, 'cobblestone', null, null, null, null, 'vine', null, null])))).toBe('mossy_cobblestonex1');
    expect(name(craftingResult(grid(3, ['vine', null, null, null, null, null, null, null, 'cobblestone'])))).toBe('mossy_cobblestonex1');
  });
  it('repairing two damaged tools adds 5%', () => {
    const a = { ...stack('iron_pickaxe'), damage: 200 }, b = { ...stack('iron_pickaxe'), damage: 150 };
    const r = craftingResult({ width: 2, height: 2, items: [a, b, null, null] });
    // max 250: (50 + 100 + 12) = 162 → damage 88
    expect(r?.damage).toBe(88);
  });
  it('shift-clicking the result crafts as many as possible', () => {
    const p = player();
    const m = new CraftingMenu(1, new InventoryContainer(p.inventory));
    m.craftSlots.setItem(0, stack('oak_log', 3));
    expect(name(m.slots[0]!.getItem())).toBe('oak_planksx4');
    m.clicked(0, 0, ClickType.QUICK_MOVE, p);
    // result goes to the hotbar end first (reverse), all 3 logs consumed
    expect(m.craftSlots.getItem(0)).toBeNull();
    expect(name(p.inventory.get(8))).toBe('oak_planksx12');
    expect(m.slots[0]!.getItem()).toBeNull();
  });
  it('taking the result consumes one of each and leaves buckets', () => {
    const p = player();
    const m = new CraftingMenu(1, new InventoryContainer(p.inventory));
    const layout = ['milk_bucket', 'milk_bucket', 'milk_bucket', 'sugar', 'egg', 'sugar', 'wheat', 'wheat', 'wheat'];
    layout.forEach((n, i) => m.craftSlots.setItem(i, stack(n, 2)));
    m.craftSlots.setItem(0, stack('milk_bucket'));
    m.craftSlots.setItem(1, stack('milk_bucket'));
    m.craftSlots.setItem(2, stack('milk_bucket'));
    expect(name(m.slots[0]!.getItem())).toBe('cakex1');
    m.clicked(0, 0, ClickType.PICKUP, p);
    expect(name(m.carried)).toBe('cakex1');
    expect(name(m.craftSlots.getItem(0))).toBe('bucketx1');
    expect(name(m.craftSlots.getItem(3))).toBe('sugarx1');
    // cannot take another result onto a full cursor of a non-stacking item
    expect(m.slots[0]!.getItem()).toBeNull();
  });
});

describe('furnace', () => {
  it('cooks in 200 ticks; one coal smelts 8 items', () => {
    const f = newFurnace('furnace');
    const c = new FurnaceContainer(f);
    c.setItem(0, stack('raw_iron', 10));
    c.setItem(1, stack('coal', 1));
    let litChanges = 0;
    for (let t = 0; t < 199; t++) if (tickFurnace(f).litChanged) litChanges++;
    expect(f.items[2]).toBeNull();
    tickFurnace(f);
    expect(name(f.items[2])).toBe('iron_ingotx1');
    expect(litChanges).toBe(1);
    for (let t = 0; t < 1600; t++) tickFurnace(f);
    expect(name(f.items[2])).toBe('iron_ingotx8');
    expect(f.litTime).toBe(0);
    expect(takeFurnaceExperience(f, () => 0.99)).toBe(5); // 8 × 0.7 = 5.6, fraction lost
  });
  it('blast furnace cooks ores twice as fast and refuses food', () => {
    const f = newFurnace('blast_furnace');
    const c = new FurnaceContainer(f);
    c.setItem(0, stack('raw_gold', 2));
    c.setItem(1, stack('coal', 1));
    for (let t = 0; t < 100; t++) tickFurnace(f);
    expect(name(f.items[2])).toBe('gold_ingotx1');
    const s = newFurnace('blast_furnace');
    const sc = new FurnaceContainer(s);
    sc.setItem(0, stack('beef', 1));
    sc.setItem(1, stack('coal', 1));
    for (let t = 0; t < 300; t++) tickFurnace(s);
    expect(s.items[2]).toBeNull();
    expect(s.litTime).toBe(0);
  });
  it('shift-click routes smeltables to the input and fuel to the fuel slot', () => {
    const p = player();
    p.inventory.set(9, stack('sand', 5));
    p.inventory.set(10, stack('coal', 5));
    const f = newFurnace('furnace');
    const m = new FurnaceMenu('furnace', 1, new InventoryContainer(p.inventory), new FurnaceContainer(f));
    m.clicked(3, 0, ClickType.QUICK_MOVE, p);
    m.clicked(4, 0, ClickType.QUICK_MOVE, p);
    expect(name(f.items[0])).toBe('sandx5');
    expect(name(f.items[1])).toBe('coalx5');
  });
});

describe('chest menu', () => {
  it('shift-click moves into the chest and back to the end of the inventory', () => {
    const p = player();
    p.inventory.set(0, stack('dirt', 5));
    const chest = new SimpleContainer(27);
    const m = new ChestMenu(1, new InventoryContainer(p.inventory), chest, 3);
    // hotbar slot 0 is menu slot 27 + 27
    m.clicked(54, 0, ClickType.QUICK_MOVE, p);
    expect(name(chest.getItem(0))).toBe('dirtx5');
    m.clicked(0, 0, ClickType.QUICK_MOVE, p);
    expect(name(p.inventory.get(8))).toBe('dirtx5');
  });
});

describe('chest loot', () => {
  it('fills a dungeon chest deterministically from its seed, splitting stacks over free slots', () => {
    const a: (ItemStack | null)[] = new Array(27).fill(null);
    const b: (ItemStack | null)[] = new Array(27).fill(null);
    fillWithLoot(a, 'chests/simple_dungeon', 12345n);
    fillWithLoot(b, 'chests/simple_dungeon', 12345n);
    expect(a).toEqual(b);
    const filled = a.filter(Boolean) as ItemStack[];
    expect(filled.length).toBeGreaterThanOrEqual(2);
    for (const st of filled) expect(st.count).toBeLessThanOrEqual(64);
    const c: (ItemStack | null)[] = new Array(27).fill(null);
    fillWithLoot(c, 'chests/simple_dungeon', 999n);
    expect(c).not.toEqual(a);
  });
});
