/**
 * Container screens check: survival inventory (2×2 crafting by real mouse clicks), crafting
 * table, chest + double chest, furnace smelting, creative inventory tabs/search. Screenshots go to
 * tools/bench/out/shots/containers-*.png.
 * Usage: pnpm tsx tools/e2e/containers.ts [baseUrl]
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
  await page.screenshot({ path: `${out}containers-${name}.png` });
  console.log(`saved containers-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);

/** CSS pixel position of a menu slot's centre in the open container screen. */
const slotXY = (i: number) => page.evaluate((idx) => {
  const g = (window as any).game;
  const s = g.screen, sl = s.menu.slots[idx];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return [((s.leftPos + sl.x + 8) * g.gui.scale) / dpr, ((s.topPos + sl.y + 8) * g.gui.scale) / dpr] as [number, number];
}, i);
const click = async (i: number, button: 'left' | 'right' = 'left') => {
  const [x, y] = await slotXY(i);
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  await page.waitForTimeout(80);
};
const screenTitle = () => page.evaluate(() => (window as any).game.screen?.title ?? null);

await page.goto(`${base}?nolock=1&scene=flat&rd=2&gamemode=survival&x=40.5&y=70&z=40.5&pitch=10&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && Math.abs(g.player.x - 40.5) < 0.01 && g.player.onGround && g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 180000 });
await page.waitForTimeout(500);
await cmd(page, '/give @s oak_log 5');
await cmd(page, '/give @s cobblestone 20');
await cmd(page, '/give @s iron_pickaxe 1');
await cmd(page, '/give @s coal 3');
await cmd(page, '/give @s raw_iron 4');
await page.waitForFunction(() => (window as any).game.interaction.inventory.slots.filter(Boolean).length >= 5, undefined, { timeout: 30000 });

// ---- survival inventory: 1 log into the 2×2 grid → planks
await page.evaluate(() => (window as any).game.openInventory());
await page.waitForTimeout(200);
console.log('screen', await screenTitle());
// hotbar slot 0 = menu slot 36
await click(36);
console.log('carried after pickup', await page.evaluate(() => (window as any).game.screen.menu.carried));
await click(1, 'right');
await click(36);
await page.mouse.move(700, 120);
await page.waitForTimeout(300);
await shot('inventory');
// shift-click the result → planks into the inventory
const res = await page.evaluate(() => (window as any).game.screen.menu.slots[0].getItem());
console.log('result', res);
await page.keyboard.down('Shift');
await click(0);
await page.keyboard.up('Shift');
await page.keyboard.press('KeyE');
await page.waitForTimeout(300);
console.log('after close', await screenTitle());

// ---- crafting table + furnace + chests next to the player
const pos = await page.evaluate(() => {
  const p = (window as any).game.player;
  return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
});
const [px, py, pz] = pos as [number, number, number];
await cmd(page, `/setblock ${px + 2} ${py} ${pz} crafting_table`);
await cmd(page, `/setblock ${px - 2} ${py} ${pz} furnace`);
await cmd(page, `/setblock ${px} ${py} ${pz + 2} chest[facing=north,type=left]`);
await cmd(page, `/setblock ${px + 1} ${py} ${pz + 2} chest[facing=north,type=right]`);
await page.waitForTimeout(300);
await page.waitForFunction(([x, y, z]) => (window as any).game.world.getState(x, y, z) !== 0, [px + 1, py, pz + 2], { timeout: 30000 });
const use = (x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as any).game.send({ t: 'useOn', x, y, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 }), [x, y, z]);

await use(px + 2, py, pz);
await page.waitForFunction(() => (window as any).game.screen?.title === 'Crafting', undefined, { timeout: 5000 });
// planks are in some inventory slot: find and lay out a crafting table recipe by drag
const planksSlot = await page.evaluate(() => (window as any).game.screen.menu.slots.findIndex((s: any, i: number) => i >= 10 && s.getItem()?.id === 22));
console.log('planks slot', planksSlot);
await click(planksSlot);
{
  const pts = await Promise.all([1, 2, 4, 5].map(slotXY));
  await page.mouse.move(pts[0]![0], pts[0]![1]);
  await page.mouse.down();
  for (const p of pts) await page.mouse.move(p[0], p[1], { steps: 3 });
  await page.waitForTimeout(100);
  await shot('crafting-drag');
  await page.mouse.up();
}
await page.waitForTimeout(300);
await shot('crafting');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await use(px, py, pz + 2);
await page.waitForFunction(() => (window as any).game.screen?.title === 'Large Chest', undefined, { timeout: 5000 });
// shift-click the cobblestone and pickaxe into the chest
for (let i = 54; i < 90; i++) {
  const has = await page.evaluate((i) => !!(window as any).game.screen.menu.slots[i].getItem(), i);
  if (has) {
    await page.keyboard.down('Shift');
    await click(i);
    await page.keyboard.up('Shift');
    break;
  }
}
await page.waitForTimeout(300);
const [hx, hy] = await slotXY(0);
await page.mouse.move(hx, hy);
await page.waitForTimeout(150);
await shot('chest');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await use(px - 2, py, pz);
await page.waitForFunction(() => (window as any).game.screen?.title === 'Furnace', undefined, { timeout: 5000 });
const findItem = (name: string) => page.evaluate((n) => {
  const g = (window as any).game;
  return g.screen.menu.slots.findIndex((s: any, i: number) => i >= 3 && s.getItem() && g.itemNameOf?.(s.getItem().id) === n);
}, name);
void findItem;
for (let i = 3; i < 39; i++) {
  const has = await page.evaluate((i) => !!(window as any).game.screen.menu.slots[i].getItem(), i);
  if (has) {
    await page.keyboard.down('Shift');
    await click(i);
    await page.keyboard.up('Shift');
  }
}
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(1000);
}
await shot('furnace');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ---- stonecutter
await cmd(page, '/give @s stone 16');
await cmd(page, `/setblock ${px - 2} ${py} ${pz + 2} stonecutter`);
await page.waitForFunction(([x, y, z]) => (window as any).game.world.getState(x, y, z) !== 0, [px - 2, py, pz + 2], { timeout: 30000 });
await page.waitForTimeout(300);
await use(px - 2, py, pz + 2);
await page.waitForFunction(() => (window as any).game.screen?.title === 'Stonecutter', undefined, { timeout: 5000 });
{
  const stoneSlot = await page.evaluate(() => (window as any).game.screen.menu.slots.findIndex((s: any, i: number) => i >= 2 && s.getItem()?.id === 1));
  await page.keyboard.down('Shift');
  await click(stoneSlot);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  const [bx, by] = await page.evaluate(() => {
    const g = (window as any).game, s = g.screen;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return [((s.leftPos + 52 + 16 * 1 + 8) * g.gui.scale) / dpr, ((s.topPos + 14 + 9) * g.gui.scale) / dpr];
  });
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot('stonecutter');
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ---- smithing table
await cmd(page, '/give @s diamond_sword 1');
await cmd(page, `/setblock ${px - 3} ${py} ${pz} smithing_table`);
await page.waitForFunction(([x, y, z]) => (window as any).game.world.getState(x, y, z) !== 0, [px - 3, py, pz], { timeout: 30000 });
await page.waitForTimeout(300);
await use(px - 3, py, pz);
await page.waitForFunction(() => (window as any).game.screen?.title === 'Upgrade Gear', undefined, { timeout: 5000 });
{
  const sw = await page.evaluate(() => (window as any).game.screen.menu.slots.findIndex((s: any, i: number) => i >= 3 && s.getItem()?.id && (window as any).game.screen.menu.slots[i].getItem().count === 1 && s.getItem().id > 600));
  await page.keyboard.down('Shift');
  await click(sw);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await shot('smithing');
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ---- creative inventory
await cmd(page, '/gamemode creative');
await page.waitForTimeout(300);
await page.evaluate(() => (window as any).game.openInventory());
await page.waitForTimeout(300);
await shot('creative-building');
await page.evaluate(() => {
  const s = (window as any).game.screen;
  s.selectTab('redstone');
});
await page.waitForTimeout(200);
await click(3);
await page.mouse.move(600, 300);
await page.waitForTimeout(100);
await shot('creative-redstone');
await page.evaluate(() => (window as any).game.screen.selectTab('search'));
await page.keyboard.type('glass');
await page.waitForTimeout(200);
await shot('creative-search');
await page.evaluate(() => (window as any).game.screen.selectTab('inventory'));
await page.waitForTimeout(200);
await shot('creative-inventory');
// save the hotbar with C+2, then look at the Saved Hotbars tab
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.down('KeyC');
await page.waitForTimeout(150);
await page.keyboard.press('Digit2');
await page.waitForTimeout(150);
await page.keyboard.up('KeyC');
await page.waitForTimeout(300);
await shot('hotbar-saved');
await page.evaluate(() => (window as any).game.openInventory());
await page.evaluate(() => (window as any).game.screen.selectTab('hotbar'));
await page.waitForTimeout(200);
await click(0);
await page.waitForTimeout(100);
await shot('creative-hotbars');
await browser.close();
