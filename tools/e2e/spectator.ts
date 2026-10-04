/**
 * Spectator mode on the dedicated server with three players: Alex (spectator) opens the spectator
 * menu, sees Blake's face under "Teleport to Player", attacks Blake to look through Blake's eyes and
 * sneaks back out; Casey (spectator) sees Alex as a faint head; Blake (survival) sees nobody.
 * Also F3+G chunk borders and F3+Q help. Starts its own server on port 8092.
 * Usage: pnpm tsx tools/e2e/spectator.ts
 */
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const root = new URL('../../', import.meta.url).pathname;
const srv = spawn('pnpm', ['-s', 'tsx', '--tsconfig', 'server/tsconfig.json', 'server/src/node/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: '8092', SCENE: 'models', GAMEMODE: '0' },
  stdio: 'pipe',
});
srv.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
await new Promise((r) => setTimeout(r, 4000));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (what: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};
try {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (name: string, x: number, z: number, yaw: number) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
    await page.goto(`http://localhost:8092/?nolock=1&rd=2&server=ws://localhost:8092&room=spec&name=${name}&x=${x}&y=101&z=${z}&yaw=${yaw}&pitch=8&time=6000`);
    await page.waitForFunction((xx) => {
      const g = (window as any).game;
      return g?.loggedIn && Math.abs(g.player.x - xx) < 0.01 && g.player.onGround;
    }, x, { timeout: 90000 });
    return page;
  };
  const chat = (p: Page, m: string) => p.evaluate((mm) => (window as any).game.send({ t: 'chat', message: mm }), m);
  const tap = (p: Page, code: string, hold = 60) => p.evaluate(([c, h]) => {
    const i = (window as any).game.input;
    i.press(c);
    setTimeout(() => i.release(c), h as number);
  }, [code, hold] as const);
  const f3 = async (p: Page, code: string) => {
    await p.evaluate((c) => {
      const i = (window as any).game.input;
      i.press('F3');
      setTimeout(() => i.press(c), 80);
      setTimeout(() => i.release(c), 160);
      setTimeout(() => i.release('F3'), 240);
    }, code);
    await wait(400);
  };

  const a = await open('Alex', 31.5, 7.5, 0);
  const b = await open('Blake', 31.5, 9.7, 180);
  const c = await open('Casey', 33.5, 9.5, 120);
  await wait(1500);
  // F3+N: survival → spectator
  await f3(a, 'KeyN');
  await chat(c, '/gamemode spectator');
  await wait(1200);
  check('F3+N made Alex a spectator', (await a.evaluate(() => (window as any).game.gameMode)) === 3);
  check('Blake cannot see Alex', !(await b.evaluate(() => [...(window as any).game.players.values()].some((p: any) => p.name === 'Alex'))));
  check('Casey sees Alex flagged invisible', await c.evaluate(() => [...(window as any).game.players.values()].some((p: any) => p.name === 'Alex' && (p.flags & 32) !== 0)));
  await c.screenshot({ path: `${out}spectator-head.png` });
  // spectator menu: 1 opens it, 1 again highlights "Teleport to Player", 1 again enters it
  await tap(a, 'Digit1');
  await wait(200);
  await a.screenshot({ path: `${out}spectator-menu.png` });
  await tap(a, 'Digit1');
  await wait(200);
  await tap(a, 'Digit1');
  await wait(200);
  await tap(a, 'Digit1');
  await wait(300);
  await a.screenshot({ path: `${out}spectator-teleport.png` });
  // scroll wheel without the menu changes fly speed
  // attack Blake: look through Blake's eyes
  await a.evaluate(() => (window as any).game.spectatorGui.reset());
  const target = await a.evaluate(() => (window as any).game.targetEntity);
  check('Alex targets Blake', target !== null);
  await tap(a, 'Mouse0');
  await wait(600);
  check('Alex looks through Blake', (await a.evaluate(() => (window as any).game.cameraEntity)) === target);
  await b.evaluate(() => {
    (window as any).game.yaw = 90;
  });
  await wait(800);
  await a.screenshot({ path: `${out}spectator-through-blake.png` });
  // sneak to get out
  await tap(a, 'ShiftLeft', 300);
  await wait(800);
  check('sneaking returns Alex to its own view', (await a.evaluate(() => (window as any).game.cameraEntity)) === null);
  // F3+N back to the previous game mode (survival)
  await f3(a, 'KeyN');
  await wait(800);
  check('F3+N returns Alex to survival', (await a.evaluate(() => (window as any).game.gameMode)) === 0);
  check('Blake sees Alex again', await b.evaluate(() => [...(window as any).game.players.values()].some((p: any) => p.name === 'Alex')));
  // F3+G chunk borders, F3+Q help, F3+C copy location
  await f3(b, 'KeyG');
  await f3(b, 'KeyQ');
  await f3(b, 'KeyC');
  check('F3+C copies a /tp command', (await b.evaluate(() => (window as any).game.lastClipboard)).startsWith('/execute in minecraft:overworld run tp @s 31.50'));
  check('F3 combos do not toggle the debug screen', !(await b.evaluate(() => (window as any).game.showDebug)));
  await b.screenshot({ path: `${out}chunk-borders.png` });
  await browser.close();
} finally {
  srv.kill();
}
if (failed) process.exit(1);
