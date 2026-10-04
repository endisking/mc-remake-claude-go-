import { describe, expect, it } from 'vitest';
import { Hud } from './hud';
import { Inventory, stack } from '@shared/item/stack';

describe('hotbar pickup pop (vanilla ItemStack.popTime)', () => {
  it('pops a slot for 5 ticks when a stack appears or grows, not when it shrinks', () => {
    const hud = new Hud();
    const inv = new Inventory();
    inv.set(0, stack('cobblestone', 3));
    hud.tick(inv); // first tick: existing contents do not pop
    expect(hud.popTime[0]).toBe(0);
    inv.set(0, stack('cobblestone', 4));
    hud.tick(inv);
    expect(hud.popTime[0]).toBe(5);
    for (let i = 0; i < 5; i++) hud.tick(inv);
    expect(hud.popTime[0]).toBe(0);
    inv.set(0, stack('cobblestone', 2));
    hud.tick(inv);
    expect(hud.popTime[0]).toBe(0);
    inv.set(4, stack('apple', 1));
    hud.tick(inv);
    expect(hud.popTime[4]).toBe(5);
  });
});
