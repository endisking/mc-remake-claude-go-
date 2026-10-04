/**
 * Natural block check: screenshots of the `scene=natural` showcase (every block world
 * generation places) and, optionally, of real terrain. Screenshots go to
 * tools/bench/out/shots/natural-*.png.
 * Usage: pnpm tsx tools/e2e/natural.ts [baseUrl] [only-shot-name-substring]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const only = process.argv[3] ?? '';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));

const ready = (min: number) => page.waitForFunction((n) => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.world.chunks.size >= n && s.pending === 0 && s.building === 0;
}, min, { timeout: 120000 });

interface View { name: string; q: string; min?: number }
const scene = 'nolock=1&scene=natural&gamemode=spectator&fly=1&time=6000&rd=3';
const views: View[] = [
  { name: 'cubes-a', q: `${scene}&x=8&y=104&z=13&lookat=8,101,18` },
  { name: 'cubes-b', q: `${scene}&x=24&y=104&z=13&lookat=24,101,18` },
  { name: 'cubes-c', q: `${scene}&x=40&y=104&z=13&lookat=40,101,18` },
  { name: 'cubes-d', q: `${scene}&x=56&y=104&z=13&lookat=56,101,18` },
  { name: 'cubes2', q: `${scene}&x=10&y=103.5&z=15&lookat=10,101,19` },
  { name: 'cubes2-b', q: `${scene}&x=26&y=103.5&z=15&lookat=26,101,19` },
  { name: 'plants-a', q: `${scene}&x=7&y=102.5&z=25&lookat=7,101.5,22` },
  { name: 'plants-b', q: `${scene}&x=19&y=102.5&z=25&lookat=19,101.5,22` },
  { name: 'plants-c', q: `${scene}&x=31&y=102.5&z=25&lookat=31,101.5,22` },
  { name: 'plants-d', q: `${scene}&x=43&y=102.5&z=25&lookat=43,101.5,22` },
  { name: 'plants-e', q: `${scene}&x=54&y=104&z=27&lookat=54,103,22` },
  { name: 'ocean-a', q: `${scene}&x=6&y=101.5&z=31&lookat=6,99,25` },
  { name: 'ocean-b', q: `${scene}&x=20&y=101.5&z=31&lookat=20,99,26` },
  { name: 'ocean-c', q: `${scene}&x=34&y=104&z=30&lookat=36,101,26` },
  { name: 'cave-a', q: `${scene}&x=4&y=103.5&z=31&lookat=4,103,35` },
  { name: 'cave-b', q: `${scene}&x=16&y=103&z=32&lookat=16,102,37` },
  { name: 'cave-c', q: `${scene}&x=27&y=103&z=31&lookat=27,102.5,35` },
  { name: 'cave-d', q: `${scene}&x=37&y=103&z=31&lookat=37,102.5,35` },
  { name: 'cave-e', q: `${scene}&x=49&y=103&z=31&lookat=49,102.5,35` },
  { name: 'ocean-under-a', q: `${scene}&x=6&y=98.2&z=29.5&lookat=5,98.5,25` },
  { name: 'ocean-under-b', q: `${scene}&x=18&y=98.2&z=29.5&lookat=18,98.5,25` },
  { name: 'ocean-under-c', q: `${scene}&x=26&y=98.2&z=24.5&lookat=26,98.5,28` },
  { name: 'low-flowers', q: `${scene}&x=16&y=100.6&z=25&lookat=16,101.6,22` },
  { name: 'low-fire', q: `${scene}&x=46&y=100.6&z=25&lookat=46,101.6,22` },
];
// real terrain (seed 12345): biome centres found with the biome source
const biome = (name: string, x: number, z: number, y = 96): View => ({
  name: `biome-${name}`,
  q: `nolock=1&seed=12345&gamemode=spectator&fly=1&time=6000&rd=4&x=${x}&y=${y}&z=${z}&lookat=${x + 24},66,${z + 24}`,
  min: 81,
});
views.push(
  biome('forest', 320, 0), biome('taiga', -136, -136), biome('swamp', 376, 518), biome('birch', -518, 376), biome('dark-forest', -623, 552),
  biome('savanna', 389, -807), biome('desert', 824, -895), biome('jungle', 974, -2088, 110), biome('giant-taiga', 0, 1024),
  biome('flower-forest', 1878, 399), biome('badlands', 448, 4265, 110), biome('eroded-badlands', 468, 4455, 110), biome('mushroom', 5369, 281),
  biome('snowy-taiga', -1118, -5259), biome('snowy-tundra', -1524, -5687), biome('ice-spikes', -1938, -5965),
  { name: 'biome-warm-ocean-floor', q: 'nolock=1&seed=12345&gamemode=spectator&fly=1&time=6000&rd=4&x=-1970&y=52&z=-1828&lookat=-1960,40,-1818', min: 81 },
  { name: 'biome-lukewarm-ocean-floor', q: 'nolock=1&seed=12345&gamemode=spectator&fly=1&time=6000&rd=4&x=1202&y=52&z=1415&lookat=1212,40,1425', min: 81 },
);

for (const v of views) {
  if (only && !v.name.includes(only)) continue;
  await page.goto(`${base}?${v.q}`);
  await ready(v.min ?? 49);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}natural-${v.name}.png` });
  console.log(`saved natural-${v.name}.png`);
}
await browser.close();
