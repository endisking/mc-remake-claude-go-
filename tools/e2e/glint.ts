/**
 * Enchantment glint check: an enchanted sword in first person and an enchanted item dropped
 * on the ground. Screenshots: tools/bench/out/shots/glint-*.png.
 * Usage: npx tsx tools/e2e/glint.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&scene=flat&rd=2&gamemode=survival&x=40.5&y=70&z=40.5&pitch=30&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  return g?.loggedIn && g.player.onGround && g.world.chunks.size >= 9;
}, undefined, { timeout: 180000 });
const cmd = (c: string) => page.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
await cmd('/give @s diamond_sword 1');
await page.waitForTimeout(500);
await cmd('/enchant @s sharpness 5');
await cmd('/give @s golden_pickaxe 1');
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => {
  const g = (window as any).game;
  const bi = g.blockItems;
  return [!!bi.glintTex, JSON.stringify(g.handItem), bi.u.get('uGlint') !== null, bi.u.get('uGlintTex') !== null];
}));
await page.screenshot({ path: `${out}glint-hand.png`, clip: { x: 560, y: 160, width: 294, height: 320 } });
await page.evaluate(() => (window as any).game.send({ t: 'dropItem', all: false }));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}glint-dropped.png` });
await browser.close();
