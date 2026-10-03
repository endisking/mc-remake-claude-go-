/**
 * Visual check runner: renders a set of named camera setups and saves screenshots to
 * tools/bench/out/shots/ for review. Usage: pnpm tsx tools/shots.ts [baseUrl] [filter]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const filter = process.argv[3] ?? '';
const out = new URL('./bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

export const SHOTS: Record<string, string> = {
  noon: 'x=40&y=90&z=40&yaw=30&pitch=10&time=6000',
  sunrise: 'x=40&y=90&z=40&yaw=-90&pitch=-5&time=23500',
  sunset: 'x=40&y=90&z=40&yaw=90&pitch=-5&time=12300',
  night: 'x=40&y=90&z=40&yaw=30&pitch=-30&time=18000',
  water: 'x=-60&y=70&z=-60&yaw=45&pitch=30&time=6000',
  torch: 'x=8.5&y=75&z=2&yaw=0&pitch=35&time=18000',
  stairs: 'scene=models&x=6.5&y=102&z=9.5&lookat=3,101.5,4&time=6000',
  fences: 'scene=models&x=11.5&y=102.5&z=10.5&lookat=8,101.5,4.5&time=6000',
  doors: 'scene=models&x=12.5&y=102&z=9.5&lookat=11.5,102,3.5&time=6000',
  rails: 'scene=models&x=17.5&y=103&z=9.5&lookat=14.5,101,5.5&time=6000',
  ladder: 'scene=models&x=17.5&y=101&z=-2.5&lookat=17.5,102,2.5&time=6000',
  crops: 'scene=models&x=24&y=103&z=11&lookat=24,101,5.5&time=6000',
  misc: 'scene=models&x=24&y=103&z=-3&lookat=24,101,3&time=6000',
  stairsclose: 'scene=models&x=5.5&y=101.5&z=8.5&lookat=3,101.3,3.5&time=6000&fov=50',
  railsclose: 'scene=models&x=16&y=102&z=8.5&lookat=14.5,101,5.5&time=6000&fov=50',
  railside: 'scene=models&x=17.5&y=101&z=6.5&lookat=14.5,101.5,6.5&time=6000&fov=50&debug=1',
  crack: 'scene=models&x=5.5&y=101&z=4.5&lookat=5.5,101.5,6.5&time=6000&crack=7&fov=50',
  fastleaves: 'x=40&y=80&z=40&yaw=30&pitch=20&time=6000&graphics=fast',
  underwater: 'x=-56&y=60&z=-56&yaw=45&pitch=10&time=6000',
  inlava: 'scene=models&x=9.5&y=98.6&z=11.5&yaw=0&pitch=0&time=6000',
  thunder: 'x=40&y=80&z=40&yaw=30&pitch=10&time=6000&weather=thunder',
  snowfall: 'scene=snow&x=40&y=80&z=40&yaw=30&pitch=10&time=6000&weather=rain',
  floornight: 'scene=models&x=40.5&y=102&z=8.5&lookat=40.5,100,2.5&time=18000',
  torchnight: 'scene=models&x=14.5&y=102&z=8.5&lookat=14.5,101,2.5&time=18000',
  rain: 'x=40&y=80&z=40&yaw=30&pitch=10&time=6000&weather=rain',
  debug: 'scene=models&x=14&y=104.5&z=13&yaw=160&pitch=30&time=6000&debug=1',
  pause: 'x=40&y=90&z=40&yaw=30&pitch=10&time=6000&screen=pause',
  video: 'x=40&y=90&z=40&yaw=30&pitch=10&time=6000&screen=video',
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, q] of Object.entries(SHOTS)) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`${base}?nolock=1&fly=1&rd=4&${q}`);
  // wait until meshing settles
  await page.waitForFunction(() => {
    const g = (window as any).game;
    if (!g?.chunks) return false;
    const s = g.chunks.stats();
    const rd = g.settings.renderDistance;
    return g.loggedIn && g.world.chunks.size >= (2 * rd + 1) ** 2 && s.pending === 0 && s.building === 0;
  }, undefined, { timeout: 90000 }).catch(() => console.log(`[${name}] timeout waiting for chunks`));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`saved ${name}.png`);
  await page.close();
}
await browser.close();
