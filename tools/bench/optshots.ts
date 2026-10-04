/**
 * Screenshots of the options screens (and the loading screen) for review.
 * Usage: pnpm tsx tools/bench/optshots.ts [baseUrl] [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const sc of ['options', 'video', 'chatsettings', 'skin', 'sound', 'controls']) {
  const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
  page.on('pageerror', (e) => console.log(sc, 'pageerror', e.message));
  await page.goto(`${base}?nolock=1&seed=20211&rd=4&screen=${sc}`);
  await page.waitForFunction(() => (window as any).game?.loggedIn && (window as any).game.screen, undefined, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/options-${sc}.png` });
  if (sc === 'video') {
    // scrolled to the bottom of the list
    await page.mouse.move(427, 240);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 100);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/options-video-scrolled.png` });
  }
  await page.close();
}
await browser.close();
