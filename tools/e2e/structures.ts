/**
 * Structure check in game: flies to generated structures for seed 12345 and screenshots them.
 * Screenshots: tools/bench/out/shots/struct-*.png. Usage: pnpm tsx tools/e2e/structures.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const ready = () => page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 180000 });

// [name, x, y, z, yaw, pitch]
const views: [string, number, number, number, number, number][] = [
  ['village', 740, 135, -500, 315, 50],
  ['desert-pyramid', 1386, 100, -250, 0, 45],
  ['ruined-portal', 8, 100, -14, 315, 50],
  ['swamp-hut', -326, 85, 645, 0, 35],
];
const only = process.argv[3]?.split(',');
for (const [name, x, y, z, yaw, pitch] of views) {
  if (only && !only.includes(name)) continue;
  await page.goto(`${base}?nolock=1&rd=4&seed=12345&gamemode=creative&fly=1&x=${x}&y=${y}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=6000`);
  await ready();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}struct-${name}.png` });
  console.log(`saved struct-${name}.png`);
}
await browser.close();
