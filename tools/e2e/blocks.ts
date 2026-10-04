/**
 * Block behaviour check: falling sand/gravel in mid-air and landed, a sapling grown into a tree
 * with bone meal, and tilled farmland with crops grown by bone meal.
 * Usage: tsx tools/e2e/blocks.ts [base-url]   Screenshots: tools/bench/out/shots/blocks-*.png
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
  await page.screenshot({ path: `${out}blocks-${n}.png` });
  console.log(`saved blocks-${n}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const send = (p: Page, packet: unknown) => p.evaluate((m) => (window as any).game.send(m), packet);
const block = (x: number, y: number, z: number) => page.evaluate(([a, b, c]) => {
  const g = (window as any).game;
  return g.world.getState(a, b, c) as number;
}, [x, y, z]);

const X = 200; // away from the model showcase
const view = (x: number, y: number, z: number, yaw: number, pitch: number) => page.evaluate(([a, b, c, ya, pi]) => {
  const g = (window as any).game;
  g.player.abilities.flying = true;
  g.send({ t: 'chat', message: `/tp ${a} ${b} ${c}` });
  g.yaw = ya;
  g.pitch = pi;
}, [x, y, z, yaw, pitch]);
await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&scene=models&x=${X + 0.5}&y=119&z=9.5&fly=1&time=6000`);
await page.waitForFunction((x) => { const g = (window as any).game; return g?.loggedIn && Math.abs(g.player.x - x - 0.5) < 0.01; }, X, { timeout: 90000 });
await view(X + 0.5, 119, 9.5, 180, 0);
await page.waitForTimeout(2500);

// a stone platform in the sky
for (let x = -4; x <= 4; x++) for (let z = -5; z <= 3; z++) await cmd(page, `/setblock ${X + x} 114 ${z} stone`);
await cmd(page, `/setblock ${X + 3} 115 1 torch`);
await page.waitForTimeout(800);

// falling blocks
await cmd(page, `/setblock ${X - 2} 126 1 sand`);
await cmd(page, `/setblock ${X} 128 1 gravel`);
await cmd(page, `/setblock ${X + 2} 125 1 red_sand`);
await cmd(page, `/setblock ${X + 3} 124 1 sand`);
await page.waitForTimeout(450);
await shot('falling');
await page.evaluate(() => ((window as any).game.pitch = 25));
await page.waitForTimeout(2500);
await shot('landed');
console.log('landed: sand', await block(X - 2, 115, 1), 'torch kept', await block(X + 3, 115, 1));

// sapling + bone meal
await cmd(page, `/setblock ${X} 114 -3 grass_block`);
await cmd(page, `/setblock ${X} 115 -3 oak_sapling`);
await cmd(page, '/clear');
await cmd(page, '/give @s bone_meal 64');
await send(page, { t: 'heldSlot', slot: 0 });
await page.waitForTimeout(500);
// bone meal needs the block within reach
await view(X + 0.5, 116, 0.5, 180, 30);
await page.waitForTimeout(500);
const sapling = await block(X, 115, -3);
for (let i = 0; i < 40; i++) {
  await send(page, { t: 'useOn', x: X, y: 115, z: -3, face: 3, cx: 0.5, cy: 0.5, cz: 1, hand: 0 });
  await page.waitForTimeout(120);
  const s = await block(X, 115, -3);
  if (s !== sapling && s !== sapling + 1) break;
}
await view(X + 0.5, 119, 9.5, 180, 15);
await page.waitForTimeout(300);
await shot('tree-particles');
await page.waitForTimeout(1500);
await shot('tree');

// farmland and crops
await view(X + 0.5, 117, 11.5, 180, 40);
for (let x = -3; x <= 3; x++) {
  await cmd(page, `/setblock ${X + x} 114 8 grass_block`);
  await cmd(page, `/setblock ${X + x} 114 9 water`);
}
await cmd(page, '/clear');
await cmd(page, '/give @s iron_hoe');
await send(page, { t: 'heldSlot', slot: 0 });
await page.waitForTimeout(400);
for (let x = -3; x <= 3; x++) await send(page, { t: 'useOn', x: X + x, y: 114, z: 8, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
await page.waitForTimeout(300);
const crops = ['wheat', 'wheat', 'wheat', 'wheat', 'wheat', 'wheat', 'wheat'];
for (let x = -3; x <= 3; x++) await cmd(page, `/setblock ${X + x} 115 8 ${crops[x + 3]}`);
await cmd(page, '/clear');
await cmd(page, '/give @s bone_meal 64');
await send(page, { t: 'heldSlot', slot: 0 });
await page.waitForTimeout(400);
for (let x = -1; x <= 3; x++) for (let k = 0; k < x + 2; k++) await send(page, { t: 'useOn', x: X + x, y: 115, z: 8, face: 1, cx: 0.5, cy: 0.5, cz: 0.5, hand: 0 });
await view(X + 0.5, 118, 14.5, 180, 30);
await page.waitForTimeout(300);
await shot('farm-particles');
await page.waitForTimeout(2500);
await shot('farm');
await browser.close();
