/**
 * Nether visual check: builds and lights a portal in creative, stands in it, then teleports to
 * places in the Nether and screenshots them (seed 12345). Drives the game through window.game.
 * Usage: pnpm tsx tools/nethershots.ts <baseUrl> <outDir> [names...]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', out = 'tools/bench/out/nether', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

type G = { send(p: unknown): void };
const chat = (page: Page, cmds: string[]) =>
  page.evaluate((cs) => {
    const g = (window as unknown as { game: G }).game;
    for (const c of cs) g.send({ t: 'chat', message: c });
  }, cmds);
const until = async (page: Page, what: string, fn: string, timeout = 240000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn).catch(() => false)) return;
    await page.waitForTimeout(1000);
  }
  console.log(`timed out waiting for ${what}`);
};
const loaded = (n: number) => `(() => { const g = window.game; return !!g && g.world.chunks.size >= ${n} && g.world.isLoaded(Math.floor(g.player.x), Math.floor(g.player.z)); })()`;

const FRAME = ['/fill -1 149 0 2 153 0 obsidian', '/fill 0 150 0 1 152 0 air', '/setblock 0 150 0 fire'];
const PLACES: Record<string, string> = {
  // open spots found by scanning the terrain of seed 12345 (look south along 20 clear blocks)
  wastes: '/tp @s 8 80 0 0 15',
  crimson: '/tp @s -40 91 48 0 25',
  warped: '/tp @s 88 42 -96 0 20',
  basalt: '/tp @s -248 35 256 0 15',
  soulsand: '/tp @s -424 72 592 0 20',
  lavaocean: '/tp @s -56 38 -64 0 30',
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&time=6000&x=1&y=150&z=-3.5&cmd=${encodeURIComponent('/gamemode spectator')}`);
await until(page, 'overworld chunks', loaded(60));
await chat(page, FRAME);
await chat(page, ['/tp @s 1 151 -3.5 0 5']);
await page.waitForTimeout(5000);
if (!only.length || only.includes('portal')) {
  await page.screenshot({ path: `${out}/portal.png` });
  console.log('saved portal');
}
// step in (creative: one tick) and wait for the Nether
await chat(page, ['/gamemode creative', '/tp @s 0.5 150 0.5 0 0']);
await until(page, 'the nether', `window.game.dimension === 'the_nether'`, 60000);
await page.screenshot({ path: `${out}/arrival_overlay.png` });
await until(page, 'nether chunks', loaded(60));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/arrival.png` });
console.log('saved arrival');
await chat(page, ['/gamemode spectator']);
for (const [name, tp] of Object.entries(PLACES)) {
  if (only.length && !only.includes(name)) continue;
  await chat(page, [tp]);
  await page.waitForTimeout(1500);
  await until(page, `${name} chunks`, loaded(60));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
}
await browser.close();
