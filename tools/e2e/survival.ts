/**
 * Survival check: HUD, fall damage (hurt tilt + blinking hearts), burning in lava (fire
 * overlay), death screen and respawn. Screenshots go to tools/bench/out/shots/survival-*.png.
 * Usage: pnpm tsx tools/e2e/survival.ts [baseUrl]
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
  await page.screenshot({ path: `${out}survival-${name}.png` });
  console.log(`saved survival-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const state = () => page.evaluate(() => {
  const g = (window as any).game;
  return { health: g.health, food: g.food, air: g.air, xp: g.xpLevel, dead: g.dead, onFire: g.onFire, y: g.player.y, screen: g.screen?.title ?? null };
});

await page.goto(`${base}?nolock=1&rd=3&gamemode=survival&x=40.5&y=70&z=40.5&pitch=10&yaw=30&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && Math.abs(g.player.x - 40.5) < 0.01 && g.player.onGround && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 90000 });
await page.waitForTimeout(3200); // spawn invulnerability
await cmd(page, '/xp add @s 5 levels');
await cmd(page, '/xp add @s 6');
await cmd(page, '/give @s cobblestone 23');
await page.waitForTimeout(300);
console.log(await state());
await shot('hud');

// fall 12 blocks
const y0 = await page.evaluate(() => (window as any).game.player.y);
await cmd(page, `/tp 40.5 ${y0 + 12} 40.5`);
await page.waitForFunction(() => (window as any).game.hurtTime > 0, undefined, { timeout: 10000 });
await page.waitForTimeout(80);
await shot('hurt');
console.log('after fall', await state());

// lava at the feet
await page.waitForTimeout(1000);
await cmd(page, '/setblock ~ ~ ~ lava');
await page.waitForFunction(() => (window as any).game.onFire, undefined, { timeout: 10000 });
await page.waitForTimeout(400);
await shot('burning');
console.log('in lava', await state());
await cmd(page, '/setblock ~ ~ ~ air');

// die and respawn
await cmd(page, '/kill');
await page.waitForFunction(() => (window as any).game.screen?.title === 'You died!', undefined, { timeout: 10000 });
await page.waitForTimeout(1200);
await shot('death');
console.log('dead', await state());
await page.evaluate(() => (window as any).game.respawn());
await page.waitForTimeout(1500);
await shot('respawned');
console.log('respawned', await state());
await browser.close();
