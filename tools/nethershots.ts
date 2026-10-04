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
  `/fill -1 149 ${dz} 2 153 ${dz} obsidian`,
  `/fill 0 150 ${dz} 1 152 ${dz} air`,
  `/setblock 0 150 ${dz} fire`,
  // creative players fall while waiting; stand on the frame's bottom row inside the portal
  '/tp @s 0.5 150 0.5 0 0',
];
const enc = (cmds: string[], key: string) => cmds.map((c) => `${key}=${encodeURIComponent(c)}`).join('&');

/** name → [extra query, commands run after arriving in the Nether, wait ms] */
const SHOTS: Record<string, [string, string[], number]> = {
  // stand in front of the lit portal in the overworld
  portal: ['x=1&y=150&z=-3&yaw=0&pitch=5&laterms=25000&cmd=%2Fgamemode%20spectator', [], 45000],
};
for (const [name, tp] of Object.entries({
  // open spots found by scanning the terrain of seed 12345 (look south along 20 clear blocks)
  wastes: '/tp @s 8 80 0 0 15',
  crimson: '/tp @s -40 91 48 0 25',
  warped: '/tp @s 88 42 -96 0 20',
  basalt: '/tp @s -232 42 240 0 20',
  soulsand: '/tp @s -424 72 576 0 20',
  lavaocean: '/tp @s 8 80 0 0 50',
})) SHOTS[name] = ['x=0.5&y=150&z=0.5&yaw=0&pitch=0&fly=1&laterms=25000&later2ms=45000&cmd=%2Fgamemode%20creative', ['/gamemode spectator', tp], 85000];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, [q, later, wait]] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  const portal = enc(name === 'portal' ? [...PORTAL(0).slice(0, 3), '/tp @s 1 151 -3.5 0 5'] : PORTAL(0), 'later');
  const url = `${base}?nolock=1&time=6000&${q}&${portal}&${enc(later, 'later2')}`;
  await page.goto(url);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
  await page.close();
}
await browser.close();
