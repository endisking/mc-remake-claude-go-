/**
 * End visual check: fills a 3×3 end portal in creative, steps in, then screenshots the arrival
 * platform, the obsidian pillars around the main island, the exit fountain and outer islands
 * (seed 12345). Drives the game through window.game.
 * Usage: pnpm tsx tools/endshots.ts <baseUrl> <outDir> [names...]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', out = 'tools/bench/out/end', ...only] = process.argv.slice(2);
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

const PLACES: Record<string, string> = {
  // the ring of pillars from outside the main island, looking at the centre
  pillars: '/tp @s 110 95 -30 70 10',
  fountain: '/tp @s 14 72 14 135 25',
  above: '/tp @s 0 125 -70 0 45',
  islands: '/tp @s 1250 80 -40 0 15',
  highlands: '/tp @s 1340 85 100 180 15',
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&time=6000&x=1&y=150&z=-3.5&cmd=${encodeURIComponent('/gamemode creative')}`);
await until(page, 'overworld chunks', loaded(40));
for (let i = 0; i < 6; i++) {
  await chat(page, ['/fill -1 149 -1 1 149 1 end_portal', '/tp @s 0.5 149.5 0.5 0 0']);
  await until(page, 'the end', `window.game.dimension === 'the_end'`, 15000);
  if (await page.evaluate(`window.game.dimension === 'the_end'`)) break;
}
await until(page, 'end chunks', loaded(40));
await page.waitForTimeout(4000);
await chat(page, ['/tp @s 100.5 50 0.5 90 5']);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/arrival.png` });
console.log('saved arrival');
await chat(page, ['/gamemode spectator']);
for (const [name, tp] of Object.entries(PLACES)) {
  if (only.length && !only.includes(name)) continue;
  await chat(page, [tp]);
  await page.waitForTimeout(1500);
  await until(page, `${name} chunks`, loaded(40));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
}
await browser.close();
