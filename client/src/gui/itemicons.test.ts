import { describe, expect, it } from 'vitest';
import { durabilityColor, durabilityWidth, itemAnim, itemSpriteName } from './itemicons';
import { ITEMS_BY_NAME } from '@shared/data';

describe('item decorations (vanilla ItemRenderer.renderGuiItemDecorations)', () => {
  it('durability bar width: round(13 − damage·13/max)', () => {
    expect(durabilityWidth(0, 250)).toBe(13);
    expect(durabilityWidth(125, 250)).toBe(7); // 6.5 rounds up
    expect(durabilityWidth(249, 250)).toBe(0);
    expect(durabilityWidth(1, 1561)).toBe(13);
  });

  it('durability colour goes green → yellow → red', () => {
    expect(durabilityColor(0, 100)).toBe(0x00ff00);
    expect(durabilityColor(50, 100)).toBe(0xffff00);
    expect(durabilityColor(100, 100)).toBe(0xff0000);
  });

  it('compass and clock pick their animation frame', () => {
    const compass = ITEMS_BY_NAME.get('compass')!.id, clock = ITEMS_BY_NAME.get('clock')!.id;
    itemAnim.compass = 5;
    itemAnim.clock = 40;
    expect(itemSpriteName(compass)).toBe('compass_05');
    expect(itemSpriteName(clock)).toBe('clock_40');
    expect(itemSpriteName(ITEMS_BY_NAME.get('apple')!.id)).toBe('apple');
  });
});
