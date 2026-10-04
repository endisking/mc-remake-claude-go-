/**
 * Phase 7 check: status effect HUD icons, the inventory effect list, enchantment glint on
 * hotbar/inventory items, the enchanting table window, night vision and blindness.
 * Screenshots go to tools/bench/out/shots/effects-*.png.
 * Usage: npx tsx tools/e2e/effects.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
const shot = async (name: string) => {
  await page.screenshot({ path: `${out}effects-${name}.png` });
  console.log(`saved effects-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);

await page.goto(`${base}?nolock=1&scene=flat&rd=2&gamemode=survival&x=40.5&y=70&z=40.5&pitch=10&yaw=0&time=18000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.player.onGround && g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 180000 });
await page.waitForTimeout(500);
await shot('night-before');
for (const e of ['speed 60 1', 'haste 60 0', 'regeneration 8 1', 'night_vision 60 0', 'poison 60 0', 'slowness 60 0', 'absorption 60 1', 'water_breathing 60 0']) await cmd(page, `/effect give @s ${e}`);
await cmd(page, '/give @s diamond_sword 1');
await cmd(page, '/enchant @s sharpness 5');
await cmd(page, '/give @s enchanted_golden_apple 3');
await page.waitForFunction(() => (window as any).game.localEffects.size >= 8, undefined, { timeout: 30000 });
await page.waitForTimeout(1500);
console.log('effects', await page.evaluate(() => [...(window as any).game.localEffects.entries()]));
console.log('held', await page.evaluate(() => JSON.stringify((window as any).game.interaction.inventory.slots[0])));
await shot('hud');
// third person: swirl particles around the player
await page.evaluate(() => ((window as any).game.cameraType = 2));
await page.waitForTimeout(1200);
await shot('swirls');
await page.evaluate(() => ((window as any).game.cameraType = 0));
// inventory list
await page.evaluate(() => (window as any).game.openInventory());
await page.waitForTimeout(500);
await shot('inventory');
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);
// blindness
await cmd(page, '/effect clear @s');
await cmd(page, '/effect give @s blindness 30 0');
await page.waitForTimeout(1500);
await shot('blindness');
await cmd(page, '/effect clear @s');
// enchanting table with bookshelves
const pos = await page.evaluate(() => {
  const p = (window as any).game.player;
  return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
});
const [x, y, z] = pos as [number, number, number];
await cmd(page, '/time set day');
await cmd(page, `/setblock ${x} ${y} ${z + 3} enchanting_table`);
await cmd(page, `/fill ${x - 2} ${y} ${z + 5} ${x + 2} ${y + 1} ${z + 5} bookshelf`);
await cmd(page, `/fill ${x - 2} ${y} ${z + 1} ${x - 2} ${y + 1} ${z + 4} bookshelf`);
await cmd(page, '/xp add @s 30 levels');
await cmd(page, '/give @s diamond_pickaxe 1');
await cmd(page, '/give @s lapis_lazuli 10');
await page.waitForTimeout(800);
await page.evaluate(([bx, by, bz]) => (window as any).game.send({ t: 'useOn', x: bx, y: by, z: bz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 }), [x, y, z + 3]);
await page.waitForFunction(() => (window as any).game.screen?.menu?.type === 'enchantment', undefined, { timeout: 20000 });
const shift = async (slotIndex: number) => page.evaluate((i) => {
  const g = (window as any).game;
  g.send({ t: 'clickWindow', windowId: g.screen.menu.containerId, slot: i, button: 0, clickType: 1 });
}, slotIndex);
const findSlot = (name: string) => page.evaluate((n) => {
  const g = (window as any).game;
  const inv = g.interaction.inventory;
  const ITEMS = g.itemNames ?? null;
  void ITEMS;
  for (let i = 0; i < 36; i++) {
    const s = inv.slots[i];
    if (s && g.itemName?.(s.id) === n) return i;
  }
  return -1;
}, name);
void findSlot;
// pickaxe and lapis were given into hotbar slots 2 and 3 (menu slots 2 + 27 + i)
await shift(2 + 27 + 2);
await shift(2 + 27 + 3);
await page.waitForTimeout(800);
console.log('offers', await page.evaluate(() => (window as any).game.screen.menu.data));
const off = await page.evaluate(() => {
  const g = (window as any).game, s = g.screen;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return [((s.leftPos + 60 + 50) * g.gui.scale) / dpr, ((s.topPos + 14 + 19 * 2 + 9) * g.gui.scale) / dpr];
});
await page.mouse.move(off[0]!, off[1]!);
await page.waitForTimeout(300);
await shot('enchanting');
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(800);
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
await shot('enchanted');
console.log('result', await page.evaluate(() => JSON.stringify((window as any).game.screen.menu.slots[0].getItem())));
await browser.close();
