import { describe, it, expect } from 'vitest';
import { componentToLegacy, componentClick, formatCommand } from './chat';

describe('chat click events', () => {
  it('finds the first click event in a component tree', () => {
    expect(componentClick('{"text":"Seed: ","extra":[{"text":"[","extra":[{"text":"7","clickEvent":{"action":"copy_to_clipboard","value":"7"}}]}]}')).toEqual({ action: 'copy_to_clipboard', value: '7' });
    expect(componentClick('{"text":"plain"}')).toBeUndefined();
    expect(componentClick('nope')).toBeUndefined();
  });
});

describe('chat text components', () => {
  it('turns JSON components into §-coloured lines with inherited colours', () => {
    expect(componentToLegacy('{"text":"hello"}')).toBe('hello');
    expect(componentToLegacy('{"text":"Alex joined the game","color":"yellow"}')).toBe('§eAlex joined the game');
    expect(componentToLegacy('{"text":"","color":"red","extra":[{"text":"Unknown command"}]}')).toBe('§cUnknown command');
    // admin echo: grey wrapper around a plain message
    expect(componentToLegacy('{"text":"","color":"gray","italic":true,"extra":["[","Mod",": ",{"text":"Set the time to 1000"},"]"]}')).toBe('§7[§7Mod§7: §7Set the time to 1000§7]');
    // error context: grey prefix, red rest
    expect(componentToLegacy('{"text":"","color":"red","extra":[{"text":"","color":"gray","extra":["...","time set ",{"text":"x","color":"red","underlined":true},{"text":"<--[HERE]","color":"red","italic":true}]}]}')).toBe('§7...§7time set §cx§c<--[HERE]');
    expect(componentToLegacy('{"text":"Seed: ","extra":[{"text":"[","color":"green","extra":[{"text":"7","color":"green"},"]"]}]}')).toBe('Seed: §a[§a7§a]');
    expect(componentToLegacy('not json')).toBe('not json');
    expect(componentToLegacy('"plain string"')).toBe('plain string');
  });
});

describe('command colouring', () => {
  it('colours arguments in turn, literals grey and the unparsed tail red', () => {
    expect(formatCommand('/tp @p ~ ~ ~', [[4, 6], [7, 12]], -1)).toEqual([
      { text: '/tp ', color: 0xaaaaaa },
      { text: '@p', color: 0x55ffff },
      { text: ' ', color: 0xaaaaaa },
      { text: '~ ~ ~', color: 0xffff55 },
    ]);
    expect(formatCommand('/time set banana', [], 10)).toEqual([
      { text: '/time set ', color: 0xaaaaaa },
      { text: 'banana', color: 0xff5555 },
    ]);
  });
});
