/**
 * Fluid check: water flowing down a staircase (levels, falling columns, flow textures) and lava
 * meeting water (cobblestone / obsidian). Screenshots: tools/bench/out/shots/fluids-*.png.
 * Usage: pnpm tsx tools/e2e/fluids.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { stateOf, stateToString } from '../../shared/src/world/blockstate';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text()); });
const shot = async (name: string) => {
  await page.screenshot({ path: `${out}fluids-${name}.png` });
  console.log(`saved fluids-${name}.png`);
};
const ready = () => page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 120000 });
/** Raw block writes through the setBlock packet: [x, y, z, blockName][] */
const place = (p: Page, blocks: [number, number, number, string][]) =>
  p.evaluate((bs) => {
    const g = (window as any).game;
    for (const [x, y, z, s] of bs) g.send({ t: 'setBlock', x, y, z, state: s });
  }, blocks.map(([x, y, z, n]) => [x, y, z, stateOf(n)] as const));
const row = async (p: Page, cells: [number, number, number][]) => {
  const ids: number[] = await p.evaluate((cs) => cs.map(([x, y, z]) => (window as any).game.world.getState(x, y, z)), cells);
  return cells.map((c, i) => `${c[0]}:${stateToString(ids[i]!).replace('minecraft:', '')}`).join(' ');
};

/** Fly to (x,y,z) looking at (tx,ty,tz) (the URL fly flag is lost when the game mode packet arrives). */
const pose = async (p: Page, x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
  const dx = tx - x, dy = ty - (y + 1.62), dz = tz - z;
  const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI, pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  await p.evaluate(([x, y, z, yaw, pitch]) => {
    const g = (window as any).game;
    g.player.abilities.flying = true;
    g.send({ t: 'chat', message: `/tp ${x} ${y} ${z}` });
    g.yaw = yaw;
    g.pitch = pitch;
  }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(1000);
  await p.evaluate(() => ((window as any).game.player.abilities.flying = true));
};
const Y = 200;
// 1) water down a staircase descending toward +x (two blocks per step), walled on three sides
await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&fly=1&x=-3.5&y=${Y + 7}&z=-7.5&lookat=2,${Y - 2},0&time=6000`);
await ready();
const blocks: [number, number, number, string][] = [];
for (let x = -7; x <= 9; x++) {
  const top = Y - Math.floor((x + 6) / 2);
  for (let z = -3; z <= 3; z++) {
    const wall = z === -3 || z === 3 || x === -7;
    for (let y = Y - 10; y <= (x === -7 ? Y + 1 : top + (wall ? 1 : 0)); y++) blocks.push([x, y, z, 'stone']);
  }
}
blocks.push([1, Y + 1, -7, 'stone']); // a perch for the camera
await place(page, blocks);
await page.waitForTimeout(500);
await pose(page, 1.5, Y + 2, -6.5, 0.5, Y - 3, 0.5);
await place(page, [[-6, Y + 1, 0, 'water']]);
await page.waitForTimeout(6000);
await shot('slope');
console.log(await row(page, Array.from({ length: 17 }, (_, i) => [i - 6, Y + 1 - Math.floor(i / 2), 0] as [number, number, number])));

// 2) lava meeting water in a flat walled basin
await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&fly=1&x=4.5&y=${Y + 6}&z=-6.5&lookat=4,${Y},0&time=6000`);
await ready();
const basin: [number, number, number, string][] = [];
for (let x = -2; x <= 10; x++) for (let z = -3; z <= 3; z++) {
  basin.push([x, Y, z, 'stone']);
  if (z === -3 || z === 3 || x === -2 || x === 10) basin.push([x, Y + 1, z, 'stone']);
}
basin.push([4, Y + 5, -7, 'stone']);
await place(page, basin);
await page.waitForTimeout(500);
await pose(page, 4.5, Y + 6, -6.5, 4, Y, 0);
await place(page, [[0, Y + 1, 0, 'lava'], [8, Y + 1, 0, 'water'], [0, Y + 1, 2, 'lava']]);
await page.waitForTimeout(8000);
await shot('lava-water');
for (let z = -2; z <= 2; z++) console.log(await row(page, Array.from({ length: 11 }, (_, i) => [-1 + i, Y + 1, z] as [number, number, number])));
await browser.close();
