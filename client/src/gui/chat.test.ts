import { describe, it, expect } from 'vitest';
import { componentToLegacy } from './chat';

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
