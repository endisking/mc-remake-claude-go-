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
  models: 'scene=models&x=14&y=104.5&z=13&yaw=160&pitch=30&time=6000',
  models2: 'scene=models&x=36&y=104.5&z=13&yaw=180&pitch=30&time=6000',
  rain: 'x=40&y=80&z=40&yaw=30&pitch=10&time=6000&weather=rain',
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, q] of Object.entries(SHOTS)) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`${base}?nolock=1&rd=4&${q}`);
  // wait until meshing settles
  await page.waitForFunction(() => {
    const g = (window as any).game;
    if (!g?.chunks) return false;
    const s = g.chunks.stats();
    return g.loggedIn && s.sections > 50 && s.pending === 0 && s.building === 0;
  }, undefined, { timeout: 90000 }).catch(() => console.log(`[${name}] timeout waiting for chunks`));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`saved ${name}.png`);
  await page.close();
}
await browser.close();
