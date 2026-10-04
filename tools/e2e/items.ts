/**
 * Item use check: eating bread while hungry (use state, crumbs, food restored), drawing and
 * shooting a bow (FOV zoom, arrow entity), equipping armour (HUD armour row).
 * Screenshots go to tools/bench/out/shots/items-*.png.
 * Usage: pnpm tsx tools/e2e/items.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ITEMS_BY_NAME } from '../../shared/src/data';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
const shot = async (name: string) => {
  await page.screenshot({ path: `${out}items-${name}.png` });
  console.log(`saved items-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const mouse = (p: Page, button: number, down: boolean) =>
  p.evaluate(([b, d]) => {
    const i = (window as any).game.input;
    if (d) i.press(`Mouse${b}`);
    else i.release(`Mouse${b}`);
  }, [button, down] as const);
const state = () =>
  page.evaluate(() => {
    const g = (window as any).game;
    const u = g.itemUse;
    return {
      food: g.food, using: u.isUsing, ticks: u.ticksUsing, anim: u.useAnimOf, arrows: g.arrows.arrows.size, absorption: u.absorption,
      effects: [...u.effects.values()].map((e: any) => `${e.name}:${e.amplifier}`), armor: u.armorPoints(g.interaction.inventory),
      held: g.interaction.inventory.selectedStack,
    };
  });
const select = (name: string) =>
  page.evaluate((id) => {
    const ia = (window as any).game.interaction;
    ia.select(ia.inventory.find(id));
  }, ITEMS_BY_NAME.get(name)!.id);

await page.goto(`${base}?nolock=1&rd=3&gamemode=survival&pitch=0&yaw=30&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.player.onGround && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 90000 });
await page.waitForTimeout(3200);

// get hungry, then eat bread
await cmd(page, '/effect give @s hunger 10 120');
await page.waitForFunction(() => (window as any).game.food <= 14, undefined, { timeout: 30000 });
await cmd(page, '/effect clear @s');
await cmd(page, '/clear');
await cmd(page, '/give @s bread 4');
await page.waitForTimeout(300);
await select('bread');
const before = await state();
console.log('hungry', before);
await mouse(page, 2, true);
await page.waitForTimeout(1100);
console.log('eating', await state());
await shot('eating');
await page.waitForFunction(() => !(window as any).game.itemUse.isUsing, undefined, { timeout: 5000 });
await mouse(page, 2, false);
await page.waitForTimeout(300);
const after = await state();
console.log('ate', after);
if (after.food !== Math.min(20, before.food + 5)) console.log("food", before.food, "→", after.food, "(holding the key keeps eating, like vanilla)");

// golden apple: regeneration + absorption hearts
await cmd(page, '/give @s golden_apple 1');
await page.waitForTimeout(300);
await select('golden_apple');
await mouse(page, 2, true);
await page.waitForFunction(() => (window as any).game.itemUse.absorption > 0, undefined, { timeout: 5000 });
await mouse(page, 2, false);
await page.waitForTimeout(200);
console.log('golden apple', await state());
await shot('absorption');

// bow: draw 1.2 s, shoot
await cmd(page, '/give @s bow 1');
await cmd(page, '/give @s arrow 8');
await page.waitForTimeout(300);
await select('bow');
await page.evaluate(() => { (window as any).game.pitch = -15; });
await mouse(page, 2, true);
await page.waitForTimeout(1200);
console.log('drawing', await state());
await shot('bow-draw');
await mouse(page, 2, false);
await page.waitForTimeout(150);
console.log('shot', await state());
await shot('arrow-flying');

// armour
await cmd(page, '/give @s iron_chestplate 1');
await cmd(page, '/give @s diamond_helmet 1');
await page.waitForTimeout(300);
for (const s of ['iron_chestplate', 'diamond_helmet']) {
  await select(s);
  await mouse(page, 2, true);
  await page.waitForTimeout(120);
  await mouse(page, 2, false);
  await page.waitForTimeout(200);
}
console.log('armour', await state());
await shot('armor');
await browser.close();
