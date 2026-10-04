/**
 * Loaded-area edge check: flies high in spectator and looks at the edge of the loaded chunks,
 * which must show no walls of faces against chunks that are not loaded yet.
 * Saves tools/bench/out/shots/edge-*.png. Usage: pnpm tsx tools/e2e/edge.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));

await page.goto(`${base}?nolock=1&rd=4&gamemode=spectator&x=8.5&y=115&z=8.5&pitch=40&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 120000 });
await page.waitForTimeout(1500);
for (const yaw of [0, 90, 180, 270]) {
  await page.evaluate((y) => { (window as any).game.yaw = y; }, yaw);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}edge-${yaw}.png` });
  console.log(`saved edge-${yaw}.png`);
}
console.log(await page.evaluate(() => ({ chunks: (window as any).game.world.chunks.size, stats: (window as any).game.chunks.stats() })));
await browser.close();
