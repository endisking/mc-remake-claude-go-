/**
 * Environment check: lightning bolt + sky flash in a thunderstorm, underwater view adapting
 * over time, and the in-wall overlay. Screenshots: tools/bench/out/shots/env-*.png.
 * Usage: pnpm tsx tools/e2e/environment.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const shot = async (name: string) => {
  await page.screenshot({ path: `${out}env-${name}.png` });
  console.log(`saved env-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const ready = () => page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 90000 });

// lightning in a thunderstorm at dusk
await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&fly=1&x=40.5&y=80&z=40.5&pitch=-5&yaw=0&time=13000&weather=thunder`);
await ready();
await page.waitForTimeout(6000); // let the storm build (rain/thunder levels ramp over ~5 s)
await shot('storm');
await cmd(page, '/summon lightning_bolt ~ ~-15 ~25');
await page.waitForFunction(() => (window as any).game.bolts.size > 0, undefined, { timeout: 5000 });
await page.waitForTimeout(40);
await shot('lightning');
console.log(await page.evaluate(() => ({ bolts: (window as any).game.bolts.size, flash: (window as any).game.skyFlashTime })));

// underwater: just submerged vs adapted
await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&x=-56&y=60&z=-56&yaw=45&pitch=10&time=6000`);
await ready();
await page.waitForTimeout(300);
await shot('underwater-start');
await page.evaluate(() => ((window as any).game.waterVisionTime = 600));
await page.waitForTimeout(300);
await shot('underwater-adapted');

// in a wall
await page.goto(`${base}?nolock=1&rd=2&gamemode=creative&fly=1&x=40.5&y=55&z=40.5&time=6000`);
await ready();
await page.waitForTimeout(500);
await shot('inwall');
await browser.close();
