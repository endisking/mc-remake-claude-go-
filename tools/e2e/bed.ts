/**
 * Bed check: place a bed, try to sleep by day (message), sleep at night (fade, lying camera),
 * skip to morning, respawn at the bed after dying. Screenshots: tools/bench/out/shots/bed-*.png
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const shot = async (n: string) => {
  await page.screenshot({ path: `${out}bed-${n}.png` });
  console.log(`saved bed-${n}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const click = (p: Page, b: number) => p.evaluate((bb) => {
  const i = (window as any).game.input;
  i.press(`Mouse${bb}`);
  setTimeout(() => i.release(`Mouse${bb}`), 60);
}, b);
const state = () => page.evaluate(() => {
  const g = (window as any).game;
  return { sleeping: g.sleeping, day: Math.floor(g.world.dayTime) % 24000, x: g.player.x.toFixed(2), y: g.player.y.toFixed(2), z: g.player.z.toFixed(2), target: g.target ? `${g.target.x},${g.target.y},${g.target.z}` : null };
});

await page.goto(`${base}?nolock=1&rd=2&gamemode=survival&scene=models&x=31.5&y=101&z=7.5&yaw=0&pitch=60&time=6000`);
await page.waitForFunction(() => { const g = (window as any).game; return g?.loggedIn && Math.abs(g.player.x - 31.5) < 0.01 && g.player.onGround; }, undefined, { timeout: 90000 });
await cmd(page, '/give @s red_bed');
await page.waitForTimeout(400);
await click(page, 2); // place
await page.waitForTimeout(500);
console.log('placed', await state());
await shot('placed');
await click(page, 2); // try to sleep by day
await page.waitForTimeout(300);
await shot('day');
await cmd(page, '/time set 18000');
await cmd(page, '/gamerule doDaylightCycle true');
await page.waitForTimeout(300);
await click(page, 2);
await page.waitForTimeout(2500);
console.log('in bed', await state());
await shot('sleeping');
await page.evaluate(() => ((window as any).game.cameraType = 2));
await page.waitForTimeout(200);
await shot('sleeping3rd');
await page.evaluate(() => ((window as any).game.cameraType = 0));
await page.waitForTimeout(3500);
console.log('after night', await state());
await shot('morning');
await cmd(page, '/kill');
await page.waitForTimeout(1500);
await page.evaluate(() => (window as any).game.respawn());
await page.waitForTimeout(1500);
console.log('respawned', await state());
await shot('respawn');
await browser.close();
