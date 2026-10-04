/**
 * Block interaction through real input (mouse buttons, hotbar): place and open a door, till grass
 * with a hoe, plant seeds, bone-meal them, and break the block under sand so it falls.
 * Usage: tsx tools/e2e/blocks-input.ts [base-url]   Screenshots: tools/bench/out/shots/input-*.png
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { stateToString } from '../../shared/src/world/blockstate';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const shot = async (n: string) => {
  await page.screenshot({ path: `${out}input-${n}.png` });
  console.log(`saved input-${n}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const click = async (b: number) => {
  await page.evaluate((bb) => {
    const i = (window as any).game.input;
    i.press(`Mouse${bb}`);
    setTimeout(() => i.release(`Mouse${bb}`), 60);
  }, b);
  await page.waitForTimeout(250);
};
const name = async (x: number, y: number, z: number) => stateToString(await page.evaluate(([a, b, c]) => (window as any).game.world.getState(a, b, c) as number, [x, y, z]));
/** Hover at (px, py, pz) (feet) and aim the eye at a world point. */
const aim = async (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
  await page.evaluate(([a, b, c, d, e, f]) => {
    const g = (window as any).game;
    g.player.abilities.flying = true;
    g.send({ t: 'chat', message: `/tp ${a} ${b} ${c}` });
    const dx = d - a, dy = e - (b + 1.62), dz = f - c;
    g.yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
    g.pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  }, [px, py, pz, tx, ty, tz]);
  await page.waitForTimeout(400);
};
const hold = async (item: string) => {
  await cmd(page, '/clear');
  await cmd(page, `/give @s ${item}`);
  await page.waitForTimeout(300);
};

const X = -200;
await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&scene=models&x=${X + 0.5}&y=120&z=6.5&fly=1&time=6000`);
await page.waitForFunction((x) => { const g = (window as any).game; return g?.loggedIn && Math.abs(g.player.x - x - 0.5) < 0.01; }, X, { timeout: 90000 });
await page.waitForTimeout(2000);
for (let x = -3; x <= 3; x++) for (let z = -2; z <= 2; z++) await cmd(page, `/setblock ${X + x} 114 ${z} ${z === 2 ? 'water' : 'grass_block'}`);
await page.waitForTimeout(500);

// door: place on top of the grass, then open it
await hold('oak_door');
await aim(X - 1.5, 116, 3.5, X - 2.5, 115, 0.5);
await page.waitForTimeout(800);
await aim(X - 1.5, 116, 3.5, X - 2.5, 115, 0.5);
console.log('door target', await page.evaluate(() => { const g = (window as any).game; return g.target ? `${g.target.x},${g.target.y},${g.target.z} face ${g.target.face}` : null; }), await page.evaluate(() => JSON.stringify((window as any).game.interaction.inventory.selectedStack)));
await click(2);
await page.waitForTimeout(300);
const doorPlaced = await name(X - 3, 115, 0);
await page.waitForTimeout(500);
await shot('door-closed');
await click(2); // open
await page.waitForTimeout(300);
await page.waitForTimeout(500);
await shot('door-open');
console.log('door', doorPlaced, '→', await name(X - 3, 115, 0));

// hoe + seeds + bone meal
await hold('iron_hoe');
await aim(X + 0.5, 116.5, 3.5, X + 0.5, 115, 0.5);
await click(2);
console.log('tilled', await name(X, 114, 0));
await hold('wheat_seeds 8');
await click(2);
console.log('planted', await name(X, 115, 0));
await hold('bone_meal 8');
await aim(X + 0.5, 116.5, 3.5, X + 0.5, 115.1, 0.5);
for (let i = 0; i < 3; i++) await click(2);
console.log('bone-mealed', await name(X, 115, 0));

// sand on a pillar: break the pillar's top block so the sand falls
await cmd(page, `/setblock ${X + 2} 115 0 dirt`);
await cmd(page, `/setblock ${X + 2} 116 0 dirt`);
await cmd(page, `/setblock ${X + 2} 117 0 sand`);
await page.waitForTimeout(400);
await hold('dirt');
await aim(X + 2.5, 117, 3.5, X + 2.5, 116.5, 0.5);
await click(0);
await page.waitForTimeout(1500);
console.log('sand fell to', await name(X + 2, 116, 0), await name(X + 2, 117, 0));
// flint and steel on the grass
await hold('flint_and_steel');
await aim(X + 0.5, 116.5, 1.5, X - 0.5, 115, -1.5);
await click(2);
console.log('fire', await name(X - 1, 115, -2));
await cmd(page, `/setblock ${X - 2} 115 1 oak_planks`);
await cmd(page, `/setblock ${X - 2} 116 1 fire`);
await aim(X - 0.5, 116.2, 2.5, X - 1.5, 115.5, -1.5);
await page.waitForTimeout(800);
await shot('fire');
await aim(X + 0.5, 118, 6.5, X + 0.5, 115, 0);
await page.waitForTimeout(800);
console.log('door at end', await name(X - 3, 115, 0), await name(X - 3, 116, 0));
await shot('result');
// TNT: light it and watch the crater form
for (let x = -3; x <= 3; x++) for (let z = -2; z <= 1; z++) await cmd(page, `/setblock ${X + x} 113 ${z} stone`);
await cmd(page, `/setblock ${X} 115 -1 tnt`);
await hold('flint_and_steel');
await aim(X + 0.5, 116.5, 1.5, X + 0.5, 115.5, -0.5);
await click(2);
await aim(X + 0.5, 121, 9.5, X + 0.5, 114, -1);
await page.waitForTimeout(1500);
await shot('tnt-lit');
await page.waitForTimeout(3500);
await shot('tnt-crater');
console.log('crater', await name(X, 114, -1), await name(X, 113, -1));
await browser.close();
