/**
 * Time to first playable frame for a new world: page load → login → the chunks around the
 * player received and meshed (the "Loading terrain…" screen closes). Also samples the
 * integrated server's tick time while flying over fresh terrain.
 *
 * Usage: pnpm tsx tools/bench/ttff.ts [baseUrl] [renderDistance] [screenshot.png]
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173/';
const rd = Number(process.argv[3] ?? 6);
const shot = process.argv[4];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const t0 = Date.now();
await page.goto(`${base}?nolock=1&seed=20211&rd=${rd}&time=6000&weather=clear`);
await page.waitForFunction(() => (window as any).game?.loggedIn, undefined, { timeout: 120000 });
const tLogin = Date.now() - t0;
if (shot) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot });
}
// ready: the loading screen is gone (or, on builds without it, the player's 3×3 columns are meshed)
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (g.screen && g.screen.title === 'Loading terrain...') return false;
  // same check on builds with and without the loading screen: the 3×3 columns around the player drawable
  const cx = Math.floor(g.player.x) >> 4, cz = Math.floor(g.player.z) >> 4;
  const secs = g.chunks.sections;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const k = ((cx + dx + 0x200000) * 0x400000 + (cz + dz + 0x200000)) * 16;
      for (let sy = 0; sy < 16; sy++) {
        const s = secs.get(k + sy);
        if (!s || !s.hasMesh) return false;
      }
    }
  return true;
}, undefined, { timeout: 180000, polling: 50 });
const tReady = Date.now() - t0;
console.log(JSON.stringify({ rd, loginMs: tLogin, readyMs: tReady, terrainMs: tReady - tLogin }));
await browser.close();
