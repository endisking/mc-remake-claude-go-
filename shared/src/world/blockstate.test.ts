import { describe, it, expect } from 'vitest';
import { propsOf, stateOf, getProp, withProp, parseState, stateToString, blockNameOf } from './blockstate';

describe('block states', () => {
  it('decodes vanilla default states', () => {
    expect(stateOf('stone')).toBe(1);
    expect(stateOf('oak_stairs')).toBe(2021);
    expect(propsOf(2021)).toEqual({ facing: 'north', half: 'bottom', shape: 'straight', waterlogged: false });
    expect(propsOf(stateOf('redstone_wire'))).toEqual({ east: 'none', north: 'none', power: 0, south: 'none', west: 'none' });
  });
  it('round trips properties', () => {
    const s = stateOf('oak_stairs', { facing: 'east', half: 'top', waterlogged: true });
    expect(getProp(s, 'facing')).toBe('east');
    expect(getProp(s, 'half')).toBe('top');
    expect(getProp(s, 'waterlogged')).toBe(true);
    expect(getProp(withProp(s, 'facing', 'west'), 'facing')).toBe('west');
    expect(blockNameOf(s)).toBe('oak_stairs');
  });
  it('parses state strings', () => {
    const s = parseState('minecraft:redstone_wire[power=15,north=side]');
    expect(getProp(s, 'power')).toBe(15);
    expect(getProp(s, 'north')).toBe('side');
    expect(parseState(stateToString(s))).toBe(s);
  });
});
