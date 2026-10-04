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
  portal: ['x=0.5&y=120&z=0.5&yaw=0&pitch=5&laterms=15000&cmd=%2Fgamemode%20creative', [], 30000],
};
for (const [name, tp] of Object.entries({
  wastes: '/tp @s 0 70 0 0 10',
  crimson: '/tp @s -48 70 48 30 10',
  warped: '/tp @s 80 70 -80 30 10',
  basalt: '/tp @s -256 70 256 30 10',
  soulsand: '/tp @s -400 70 576 30 10',
  lavaocean: '/tp @s 0 45 0 0 25',
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
