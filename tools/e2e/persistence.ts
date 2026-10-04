/**
 * World persistence check against the built web app (client/dist): create a world in the
 * launcher, break and place a block, Save and Quit to Title, reopen the world and verify the
 * change, the player's position and inventory survived. Also exercises export/import/delete.
 * Usage: pnpm build && pnpm tsx tools/e2e/persistence.ts [outDir]
 */
import { chromium, type Page } from '@playwright/test';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { stateOf } from '../../shared/src/world/blockstate';

const root = new URL('../../', import.meta.url).pathname;
const WEB = join(root, 'client/dist');
const out = process.argv[2] ?? join(root, 'tools/bench/out/shots');
await mkdir(out, { recursive: true });
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const file = normalize(join(WEB, url === '/' ? 'index.html' : url));
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(47997, '127.0.0.1', r));
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.status() >= 400 && console.log('  http', r.status(), r.url()));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.text().startsWith('[server]')) console.log('  worker:', m.text());
});
const shot = async (name: string) => {
  await page.screenshot({ path: join(out, `persist-${name}.png`) });
  console.log(`saved persist-${name}.png`);
};
const fail = (msg: string) => {
  console.log('FAIL:', msg);
  process.exitCode = 1;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function waitLoaded(p: Page): Promise<void> {
  await p.waitForFunction(() => {
    const g = (window as any).game;
    if (!g?.chunks || !g.loggedIn) return false;
    const s = g.chunks.stats();
    return g.player.onGround && g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
  }, undefined, { timeout: 120000 });
  await p.waitForTimeout(500);
}
const press = (p: Page, code: string) => p.evaluate((c) => {
  const i = (window as any).game.input;
  i.press(c);
  i.release(c);
}, code);
const look = (p: Page, yaw: number, pitch: number) => p.evaluate(([y, pt]) => {
  const g = (window as any).game;
  g.yaw = y;
  g.pitch = pt;
}, [yaw, pitch] as const);
const target = (p: Page) => p.evaluate(() => {
  const t = (window as any).game.target;
  return t ? { x: t.x as number, y: t.y as number, z: t.z as number, face: t.face as number, state: t.state as number } : null;
});
const blockAt = (p: Page, x: number, y: number, z: number) => p.evaluate(([a, b, c]) => (window as any).game.world.getState(a, b, c) as number, [x, y, z] as const);

await page.goto('http://127.0.0.1:47997/');
await page.waitForSelector('#l-play');
await page.waitForTimeout(300);
await shot('1-launcher-empty');
await page.fill('#l-name', 'Tester');
await page.fill('#l-wname', 'Persist Test');
await page.fill('#l-seed', 'blockcraft');
await page.selectOption('#l-gm', 'creative');
await page.click('#l-play');
await page.waitForURL(/world=/);
await waitLoaded(page);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => (window as any).game.setScreen(null));

/** Look around until the crosshair is on a block (other than `not`). */
const OFF = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) <= 1;
async function aimAt(yaws: number[], not?: { x: number; y: number; z: number }) {
  for (const pitch of [55, 65, 45, 75, 35])
    for (const yaw of yaws) {
      await look(page, yaw, pitch);
      await page.waitForTimeout(150);
      const t = await target(page);
      if (!t) continue;
      const o = OFF[t.face]!;
      if (not && (near(t, not) || near({ x: t.x + o[0]!, y: t.y + o[1]!, z: t.z + o[2]! }, not))) continue;
      return { t, yaw, pitch };
    }
  throw new Error('nothing to aim at');
}
// break a block on the ground ahead, then place glass on the ground behind
const first = await aimAt([30, 60, 0, 90, 120]);
const broken = first.t;
await press(page, 'Mouse0');
await page.waitForTimeout(400);
await page.evaluate(() => (window as any).game.send({ t: 'chat', message: '/give @s glass 7' }));
await page.waitForFunction(() => (window as any).game.interaction.inventory.slots.some((s: any) => s && s.count === 7), undefined, { timeout: 30000 });
const second = await aimAt([210, 240, 180, 270, 300], broken);
const aim = second.t;
const glass = await page.evaluate(() => (window as any).game.interaction.inventory.slots.findIndex((s: any) => s && s.count === 7));
if (glass < 0 || glass > 8) fail(`glass not in hotbar (slot ${glass})`);
await page.evaluate((s) => ((window as any).game.interaction.inventory.selected = s), glass);
await press(page, `Digit${glass + 1}`);
await press(page, 'Mouse2');
const off = OFF[aim.face]!;
const placed = { x: aim.x + off[0]!, y: aim.y + off[1]!, z: aim.z + off[2]! };
// the server confirms the placement with a block change
await page.waitForFunction(([x, y, z, g]) => (window as any).game.world.getState(x, y, z) === g, [placed.x, placed.y, placed.z, stateOf('glass')] as const, { timeout: 15000 }).catch(() => {});
const placedState = await blockAt(page, placed.x, placed.y, placed.z);
const brokenState = await blockAt(page, broken.x, broken.y, broken.z);
console.log('broke', broken, '→', brokenState, '; placed at', placed, '→', placedState);
if (brokenState !== 0) fail('block was not broken');
if (placedState !== stateOf('glass')) fail(`glass was not placed (state ${placedState})`);
const before = await page.evaluate(() => {
  const g = (window as any).game;
  return { x: g.player.x, y: g.player.y, z: g.player.z, inv: g.interaction.inventory.slots.filter((s: any) => s).length };
});
await shot('2-changed');

// Save and Quit to Title
const saving = page.evaluate(() => (window as any).game.quitToTitle());
await page.waitForTimeout(150);
await shot('3-saving').catch(() => {});
await saving;
await page.waitForSelector('#l-open:not([disabled])', { timeout: 30000 });
await page.waitForTimeout(300);
await shot('4-launcher-list');

// reopen
await page.click('#l-open');
await page.waitForURL(/world=/);
await waitLoaded(page);
await page.evaluate(() => (window as any).game.setScreen(null));
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const g = (window as any).game;
  return { x: g.player.x, y: g.player.y, z: g.player.z, inv: g.interaction.inventory.slots.filter((s: any) => s).length };
});
const placedAfter = await blockAt(page, placed.x, placed.y, placed.z);
const brokenAfter = await blockAt(page, broken.x, broken.y, broken.z);
console.log('after reopen: placed', placedAfter, 'broken', brokenAfter, 'player', after, 'before', before);
if (placedAfter !== placedState) fail('placed block not persisted');
if (brokenAfter !== 0) fail('broken block not persisted');
if (Math.abs(after.x - before.x) > 0.01 || Math.abs(after.z - before.z) > 0.01) fail('player position not restored');
if (after.inv !== before.inv) fail('inventory not restored');
await look(page, second.yaw, second.pitch);
await page.waitForTimeout(800);
await shot('5-reopened');

// export, import, delete
await page.evaluate(() => (window as any).game.quitToTitle());
await page.waitForSelector('#l-open:not([disabled])', { timeout: 30000 });
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#l-export')]);
const zipPath = join(out, 'persist-export.zip');
await download.saveAs(zipPath);
console.log('exported', download.suggestedFilename());
await page.setInputFiles('#l-import-file', zipPath);
await page.waitForFunction(() => document.querySelectorAll('#launcher .world').length === 2, undefined, { timeout: 30000 });
await shot('6-imported');
await page.click('#l-delete');
await page.waitForTimeout(200);
await shot('7-delete-confirm');
await page.click('#l-confirm-yes');
await page.waitForFunction(() => document.querySelectorAll('#launcher .world').length === 1, undefined, { timeout: 30000 });

await browser.close();
server.close();
// (the built page has no favicon: the browser's /favicon.ico request 404s)
const real = errors.filter((e) => !/AudioContext|autoplay|status of 404/i.test(e));
if (real.length) {
  console.log('page errors:\n' + real.join('\n'));
  process.exitCode = 1;
}
console.log(process.exitCode ? 'persistence check FAILED' : 'persistence check ok');
