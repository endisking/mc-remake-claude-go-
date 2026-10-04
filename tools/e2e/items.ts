/**
 * Item rendering check: hotbar icons (item sprites + 3D block icons + durability bars),
 * dropped items on the ground (extruded sprites and small cubes) and held items in first and
 * third person. Screenshots go to tools/bench/out/shots/items-*.png.
 * Usage: pnpm tsx tools/e2e/items.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
/** 'third' runs only the third-person part */
const only = process.argv[3] ?? '';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
const shot = async (name: string) => {
  await page.screenshot({ path: `${out}items-${name}.png` });
  console.log(`saved items-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);

await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&x=40.5&y=140&z=40.5&pitch=35&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.player.onGround && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 90000 });
await page.waitForTimeout(500);
const inv = 'window.game.interaction.inventory';
// a flat stone platform high in the sky so dropped items are easy to see
for (let x = 33; x <= 48; x++) for (let z = 34; z <= 50; z++) await cmd(page, `/setblock ${x} 200 ${z} stone`);
await cmd(page, '/tp 40.5 201 37.5');
await page.waitForFunction(() => (window as any).game.player.onGround && Math.abs((window as any).game.player.y - 201) < 0.01, undefined, { timeout: 20000 });
if (only !== 'third') {
// drop a spread of items on the ground in front of us (Q with the slot selected, turning between throws)
await cmd(page, '/clear');
const drops = ['iron_ingot', 'diamond', 'stick', 'oak_log', 'golden_apple', 'iron_pickaxe', 'redstone', 'wheat_seeds', 'dirt'];
for (const it of drops) await cmd(page, `/give @s ${it} 1`);
await page.waitForTimeout(400);
for (let i = 0; i < drops.length; i++) {
  await page.evaluate(([s, yaw]) => {
    const g = (window as any).game;
    g.yaw = yaw * 0.6;
    g.pitch = 55;
  }, [i, -40 + i * 10]);
  await page.keyboard.press(`Digit${i + 1}`);
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(300);
// step back before the pickup delay (40 ticks) runs out, then look at them
await cmd(page, '/tp 40.5 201 35.5');
await page.evaluate(() => { const g = (window as any).game; g.yaw = 0; g.pitch = 40; });
await page.waitForTimeout(1200);
await shot('dropped');

await cmd(page, '/clear');
const hotbar = ['diamond_pickaxe', 'iron_sword', 'bread', 'oak_planks', 'torch', 'water_bucket', 'bow', 'cobblestone', 'compass'];
for (const it of hotbar) await cmd(page, `/give @s ${it} ${it === 'cobblestone' ? 64 : it === 'bread' ? 12 : 1}`);
await page.waitForTimeout(400);
// damage the sword so the durability bar shows
await page.evaluate((code) => {
  const s = eval(code).get(1);
  if (s) s.damage = 150;
}, inv);
await page.waitForTimeout(300);
await page.evaluate(() => { const g = (window as any).game; g.pitch = -10; });
await page.waitForTimeout(300);
await shot('hotbar');
// close-up of the hotbar
await page.screenshot({ path: `${out}items-hotbar-zoom.png`, clip: { x: 427 - 182, y: 480 - 46, width: 364, height: 46 } });

// held items in first person
for (const slot of [0, 1, 2, 3, 6]) {
  await page.keyboard.press(`Digit${slot + 1}`);
  await page.waitForTimeout(700);
  await shot(`held-${slot}`);
}
}
if (only === 'third') for (const it of ['diamond_pickaxe', 'iron_sword', 'bread']) await cmd(page, `/give @s ${it} 1`);
// third person (front view) holding the sword and the pickaxe: handheld transform
await page.evaluate(() => { const g = (window as any).game; g.cameraType = 2; g.pitch = 10; });
for (const slot of [1, 0, 2]) {
  await page.keyboard.press(`Digit${slot + 1}`);
  await page.waitForTimeout(700);
  await shot(`third-${slot}`);
}
await browser.close();
