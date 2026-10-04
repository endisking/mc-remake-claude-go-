import { describe, expect, it } from 'vitest';
import { isMobileDevice } from './touch';

const dev = (userAgent: string, maxTouchPoints = 0, mobile?: boolean) => ({ userAgent, maxTouchPoints, userAgentData: mobile === undefined ? undefined : { mobile } });

describe('touch controls only on phones and tablets', () => {
  it('phones and tablets', () => {
    expect(isMobileDevice(dev('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 5))).toBe(true);
    expect(isMobileDevice(dev('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 5))).toBe(true);
    expect(isMobileDevice(dev('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 5))).toBe(true);
    // iPadOS in desktop mode reports a Mac but has touch points
    expect(isMobileDevice(dev('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 5))).toBe(true);
    expect(isMobileDevice(dev('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0', 0, true))).toBe(true);
  });

  it('not computers, touchscreen laptops or Chromebooks', () => {
    expect(isMobileDevice(dev('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 10, false))).toBe(false);
    expect(isMobileDevice(dev('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 10, false))).toBe(false);
    expect(isMobileDevice(dev('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 0, false))).toBe(false);
    expect(isMobileDevice(dev('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 0))).toBe(false);
  });
});
