/**
 * Redstone check: a dust line fed by a redstone block (15 → 0 tint gradient), a lever-powered
 * line lighting a redstone lamp, and a torch inverter, all built with /setblock through chat.
 * Screenshots go to tools/bench/out/shots/redstone-*.png.
 * Usage: npx tsx tools/e2e/redstone.ts [baseUrl]
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
  await page.screenshot({ path: `${out}redstone-${name}.png` });
  console.log(`saved redstone-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);

await page.goto(`${base}?nolock=1&scene=flat&rd=2&gamemode=creative&x=40.5&y=70&z=40.5&pitch=40&yaw=0&time=14000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.player.onGround && g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 180000 });
const pos = await page.evaluate(() => {
  const p = (window as any).game.player;
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
});
const { x, z } = pos;
// build on a floating stone floor (clear of water and terrain) and look down at it
const y = pos.y + 6;
await cmd(page, `/tp @s ${x + 0.5} ${y + 3} ${z + 0.5}`);
await page.evaluate(() => { const g = (window as any).game; g.player.flying = true; g.player.pitch = 45; });
// yaw 0 looks south (+z): a stone floor with open air above, then rows in front of the player
await cmd(page, `/fill ${x - 10} ${y - 1} ${z - 1} ${x + 10} ${y - 1} ${z + 9} stone`);
await cmd(page, `/fill ${x - 10} ${y} ${z + 1} ${x + 10} ${y + 4} ${z + 9} air`);
await page.waitForTimeout(500);
// row 1: redstone block + 16 dust → power 15 … 0
const z1 = z + 2;
await cmd(page, `/setblock ${x - 8} ${y} ${z1} redstone_block`);
for (let i = 0; i < 16; i++) await cmd(page, `/setblock ${x - 7 + i} ${y} ${z1} redstone_wire`);
// row 2: lever (on) → 4 dust → lamp
const z2 = z + 4;
for (let i = 0; i < 4; i++) await cmd(page, `/setblock ${x - 2 + i} ${y} ${z2} redstone_wire`);
await cmd(page, `/setblock ${x + 2} ${y} ${z2} redstone_lamp`);
await cmd(page, `/setblock ${x - 3} ${y} ${z2} lever[face=floor,facing=east,powered=true]`);
// row 3: a piston pushing three blocks when a redstone block appears behind it
const z3 = z + 6;
await cmd(page, `/setblock ${x - 3} ${y} ${z3} piston[facing=west]`);
for (let i = 1; i <= 3; i++) await cmd(page, `/setblock ${x - 3 - i} ${y} ${z3} oak_planks`);
await cmd(page, `/setblock ${x - 2} ${y} ${z3} redstone_block`);
// and a redstone torch on a block, lighting the lamp beside it
await cmd(page, `/setblock ${x + 1} ${y} ${z3} stone`);
await cmd(page, `/setblock ${x + 1} ${y + 1} ${z3} redstone_torch`);
await cmd(page, `/setblock ${x + 2} ${y + 1} ${z3} redstone_lamp`);
await page.waitForTimeout(11000); // let the chat fade
const powers = await page.evaluate(([x0, y0, zz]) => {
  const g = (window as any).game;
  const out: string[] = [];
  for (let i = 0; i < 16; i++) out.push(String(g.world.getState(x0 - 7 + i, y0, zz)));
  return out;
}, [x, y, z1]);
console.log('dust states', powers.join(','));
await shot('lines');
await page.evaluate(() => {
  const g = (window as any).game;
  g.player.pitch = 70;
});
await page.waitForTimeout(800);
await shot('lines-down');
await browser.close();
