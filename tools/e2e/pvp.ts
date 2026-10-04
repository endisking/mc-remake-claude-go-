/**
 * Two-player check on the dedicated server: A punches B (red hurt tint, knockback, hearts),
 * screenshots from both sides. Starts its own server on port 8091.
 * Usage: pnpm tsx tools/e2e/pvp.ts
 */
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const root = new URL('../../', import.meta.url).pathname;
const srv = spawn('pnpm', ['-s', 'tsx', '--tsconfig', 'server/tsconfig.json', 'server/src/node/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: '8091', SCENE: 'models', GAMEMODE: '0', OPS: '*' },
  stdio: 'pipe',
});
srv.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
await new Promise((r) => setTimeout(r, 4000));
try {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (name: string, x: number, z: number, yaw: number) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
    await page.goto(`http://localhost:8091/?nolock=1&rd=2&server=ws://localhost:8091&room=pvp&name=${name}&x=${x}&y=101&z=${z}&yaw=${yaw}&pitch=8&time=6000`);
    await page.waitForFunction((xx) => {
      const g = (window as any).game;
      return g?.loggedIn && Math.abs(g.player.x - xx) < 0.01 && g.player.onGround;
    }, x, { timeout: 90000 });
    return page;
  };
  const a = await open('Alex', 31.5, 7.5, 0);
  const b = await open('Blake', 31.5, 9.7, 180);
  await new Promise((r) => setTimeout(r, 3500)); // spawn invulnerability + tracking
  const target = await a.evaluate(() => (window as any).game.targetEntity);
  console.log('A targets', target);
  const punch = (p: Page) => p.evaluate(() => {
    const i = (window as any).game.input;
    i.press('Mouse0');
    setTimeout(() => i.release('Mouse0'), 60);
  });
  await punch(a);
  await new Promise((r) => setTimeout(r, 120));
  await a.screenshot({ path: `${out}pvp-attacker.png` });
  await new Promise((r) => setTimeout(r, 200));
  await b.screenshot({ path: `${out}pvp-victim.png` });
  console.log('B health', await b.evaluate(() => (window as any).game.health));
  console.log('B moved to z', await b.evaluate(() => (window as any).game.player.z.toFixed(2)));
  await browser.close();
} finally {
  srv.kill();
}
