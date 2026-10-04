import { describe, it, expect } from 'vitest';
import { parseSnbt, itemTagFromSnbt } from './snbt';

describe('snbt', () => {
  it('parses compounds, lists, typed numbers and quoted strings', () => {
    expect(parseSnbt('{a:1b,b:[1,2s,3L],c:"x y",d:{e:1.5f}}')).toEqual({ a: 1, b: [1, 2, 3], c: 'x y', d: { e: 1.5 } });
    expect(parseSnbt('[I;1,2]')).toEqual([1, 2]);
  });
  it('normalises item tags', () => {
    expect(itemTagFromSnbt('{Potion:"minecraft:strong_healing"}')).toEqual({ Potion: 'strong_healing' });
    expect(itemTagFromSnbt(`{Enchantments:[{id:"minecraft:sharpness",lvl:5s}],display:{Name:'{"text":"Blade"}'}}`)).toEqual({ Enchantments: [{ id: 'sharpness', lvl: 5 }], display: { Name: 'Blade' } });
  });
});
