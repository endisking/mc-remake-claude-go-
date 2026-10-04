/**
 * Nether visual check: builds and lights a portal in creative, walks in, then teleports to
 * places in the Nether and screenshots them. Usage: pnpm tsx tools/nethershots.ts <baseUrl> <outDir> [names...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', out = 'tools/bench/out/nether', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

/** a 2×3 portal `dz` blocks in front of the player (relative to where it stands after landing) */
const PORTAL = (dz: number) => [
  `/fill ~-1 ~-1 ~${dz} ~2 ~3 ~${dz} obsidian`,
  `/fill ~ ~ ~${dz} ~1 ~2 ~${dz} air`,
  `/setblock ~ ~ ~${dz} fire`,
];
const enc = (cmds: string[], key: string) => cmds.map((c) => `${key}=${encodeURIComponent(c)}`).join('&');

/** name → [extra query, commands run after arriving in the Nether, wait ms] */
const SHOTS: Record<string, [string, string[], number]> = {
  // stand in front of the lit portal in the overworld
  portal: ['x=0.5&y=120&z=0.5&yaw=0&pitch=5&laterms=15000&debug=1&cmd=%2Fgamemode%20creative', [], 30000],
};
for (const [name, tp] of Object.entries({
  // open spots found by scanning the terrain of seed 12345 (look south along 20 clear blocks)
  wastes: '/tp @s 8 80 0 0 15',
  crimson: '/tp @s -40 91 48 0 25',
  warped: '/tp @s 88 42 -96 0 20',
  basalt: '/tp @s -232 42 240 0 20',
  soulsand: '/tp @s -424 72 576 0 20',
  lavaocean: '/tp @s 8 80 0 0 50',
})) SHOTS[name] = ['x=0.5&y=120&z=0.5&yaw=0&pitch=0&laterms=15000&later2ms=30000&cmd=%2Fgamemode%20creative', ['/gamemode spectator', tp], 60000];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, [q, later, wait]] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  const portal = enc(PORTAL(name === 'portal' ? 3 : 0), 'later');
  const url = `${base}?nolock=1&time=6000&${q}&${portal}&${enc(later, 'later2')}`;
  await page.goto(url);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
  await page.close();
}
await browser.close();
