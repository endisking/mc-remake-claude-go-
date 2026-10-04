/**
 * Anvil check: combine a sword with an enchanted book and rename it by typing.
 * Screenshot: tools/bench/out/shots/anvil.png.
 * Usage: npx tsx tools/e2e/anvil.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&scene=flat&rd=2&gamemode=survival&x=40.5&y=70&z=40.5&pitch=10&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  return g?.loggedIn && g.player.onGround && g.world.chunks.size >= 9;
}, undefined, { timeout: 180000 });
const cmd = (c: string) => page.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const [x, y, z] = await page.evaluate(() => {
  const p = (window as any).game.player;
  return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
});
await cmd(`/setblock ${x} ${y} ${z! + 2} anvil`);
await cmd('/xp add @s 20 levels');
await cmd('/give @s diamond_sword 1');
await cmd('/give @s enchanted_book{StoredEnchantments:[{id:"minecraft:sharpness",lvl:4s}]} 1');
await page.waitForTimeout(800);
await page.evaluate(([bx, by, bz]) => (window as any).game.send({ t: 'useOn', x: bx, y: by, z: bz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 }), [x, y, z! + 2]);
await page.waitForFunction(() => (window as any).game.screen?.menu?.type === 'anvil', undefined, { timeout: 20000 });
for (const k of [0, 1]) {
  await page.evaluate((i) => {
    const g = (window as any).game;
    g.send({ t: 'clickWindow', windowId: g.screen.menu.containerId, slot: 30 + i, button: 0, clickType: 1 });
  }, k);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(500);
for (let i = 0; i < 20; i++) await page.keyboard.press('Backspace');
await page.keyboard.type('Starblade');
await page.waitForTimeout(800);
console.log('cost', await page.evaluate(() => (window as any).game.screen.menu.data), await page.evaluate(() => JSON.stringify((window as any).game.screen.menu.result.items[0])));
await page.screenshot({ path: `${out}anvil.png` });
await browser.close();
