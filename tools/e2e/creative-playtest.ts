/**
 * Creative play-test (built client): flying, the creative inventory, placing blocks, F3, pause and
 * options screens, the Nether via /execute-free teleport. Logs page errors.
 * Usage: (cd client && npx vite build) && pnpm tsx tools/e2e/creative-playtest.ts
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const WEB = join(root, 'client/dist');
const out = join(root, 'tools/bench/out/playtest');
await mkdir(out, { recursive: true });
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg' };
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
const PORT = 47980 + Math.floor(Math.random() * 9);
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors: string[] = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('console.error', m.text().slice(0, 300)));
const shot = (n: string) => page.screenshot({ path: join(out, `${n}.png`), timeout: 120000 });
const G = <T>(fn: string) => page.evaluate((f) => new Function('g', `return (${f})`)((window as any).game), fn) as Promise<T>;
const cmd = (c: string) => page.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const key = async (code: string, hold = 120) => {
  await page.evaluate((c) => (window as any).game.input.press(c), code);
  await page.waitForTimeout(hold);
  await page.evaluate((c) => (window as any).game.input.release(c), code);
};
try {
  await page.goto(`http://127.0.0.1:${PORT}/?nolock=1&rd=4&seed=987654&gamemode=creative`);
  await page.waitForFunction(() => {
    const g = (window as any).game;
    if (!g?.chunks || !g.loggedIn) return false;
    const s = g.chunks.stats();
    return g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
  }, undefined, { timeout: 240000, polling: 1000 });
  console.log('spawn', await G('[g.player.x, g.player.y, g.player.z, g.gameMode]'));
  // double-tap space to fly
  await key('Space', 60);
  await page.waitForTimeout(80);
  await key('Space', 60);
  await page.waitForTimeout(300);
  await key('Space', 1500);
  console.log('flying', await G('[g.player.abilities.flying, g.player.y]'));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  console.log('screen', await G('g.screen && (g.screen.title || g.screen.constructor.name)'));
  await shot('c1-creative-inv');
  await page.evaluate(() => (window as any).game.screen?.selectTab?.('search'));
  await page.keyboard.type('stairs');
  await page.waitForTimeout(500);
  await shot('c2-creative-search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  for (const c of ['/give @s oak_stairs 64', '/give @s glass 64', '/give @s torch 64', '/give @s oak_door 4', '/give @s chest 4', '/give @s water_bucket 1']) await cmd(c);
  const p = await G<number[]>('[Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)]');
  await cmd(`/fill ${p[0]! - 1} ${p[1]! + 8} ${p[2]! - 1} ${p[0]! + 1} ${p[1]! + 8} ${p[2]! + 1} glass`);
  await cmd(`/fill ${p[0]! - 3} ${p[1]! + 8} ${p[2]! + 3} ${p[0]! + 3} ${p[1]! + 8} ${p[2]! + 6} oak_planks`);
  await cmd(`/setblock ${p[0]} ${p[1]! + 9} ${p[2]! + 4} oak_stairs`);
  await cmd(`/setblock ${p[0]! + 1} ${p[1]! + 9} ${p[2]! + 4} torch`);
  await cmd(`/setblock ${p[0]! - 1} ${p[1]! + 9} ${p[2]! + 4} chest`);
  await cmd(`/setblock ${p[0]! + 2} ${p[1]! + 9} ${p[2]! + 4} oak_door[half=lower]`);
  await cmd(`/setblock ${p[0]! + 2} ${p[1]! + 10} ${p[2]! + 4} oak_door[half=upper]`);
  await cmd(`/setblock ${p[0]! - 2} ${p[1]! + 9} ${p[2]! + 4} water`);
  await cmd(`/tp @s ${p[0]! + 0.5} ${p[1]! + 10} ${p[2]! + 0.5} 0 35`);
  await page.waitForTimeout(3000);
  await key('F3');
  await page.waitForTimeout(800);
  await shot('c3-build-f3');
  await key('F3');
  // right-click placing with the held item
  await page.keyboard.press('Digit2');
  for (let n = 0; n < 3; n++) await key('Mouse2', 150);
  await page.waitForTimeout(500);
  // pause → options → video settings
  await page.evaluate(() => { const g = (window as any).game; import('/assets/' + '').catch(() => {}); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  console.log('after esc', await G('g.screen && (g.screen.title || g.screen.constructor.name)'));
  await shot('c4-pause');
  const btns = await G<string[]>('g.screen && g.screen.buttons ? g.screen.buttons.map(b => b.label || b.text || b.message) : []');
  console.log('pause buttons', JSON.stringify(btns));
  // nether
  await page.evaluate(() => (window as any).game.setScreen(null));
  // build an obsidian frame on the platform, light it with flint and steel, step in
  const f = await G<number[]>('[Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)]');
  const fz = f[2]! - 3;
  await cmd(`/fill ${f[0]! - 1} ${f[1]! - 1} ${fz} ${f[0]! + 2} ${f[1]! + 3} ${fz} obsidian`);
  await cmd(`/fill ${f[0]} ${f[1]} ${fz} ${f[0]! + 1} ${f[1]! + 2} ${fz} air`);
  await cmd('/clear @s');
  await cmd('/give @s flint_and_steel 1');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Digit1');
  await page.evaluate(([x, y, z]) => (window as any).game.send({ t: 'useOn', x, y, z, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 }), [f[0]!, f[1]! - 1, fz]);
  await page.waitForTimeout(1500);
  console.log('frame', f, await G(`[${f[0]! - 1}, ${f[0]}, ${f[0]! + 1}, ${f[0]! + 2}].map(x => [${f[1]! - 1}, ${f[1]}, ${f[1]! + 1}].map(y => g.world.getState(x, y, ${fz})))`), await G('[g.interaction.inventory.selected, g.interaction.inventory.slots.slice(0, 3).map(s => s && s.id)]'));
  console.log('portal block',await G(`g.world.getState(${f[0]}, ${f[1]}, ${fz}) === g.stateOfName('nether_portal') || g.world.getState(${f[0]}, ${f[1]}, ${fz})`));
  await cmd(`/tp @s ${f[0]! + 1} ${f[1]} ${fz + 0.5}`);
  await page.waitForFunction(() => (window as any).game.dimension === 'the_nether', undefined, { timeout: 90000, polling: 500 }).catch(() => console.log('NO NETHER'));
  await page.waitForTimeout(8000);
  console.log('dimension', await G('[g.dimension, g.player.x, g.player.y, g.player.z]'));
  await shot('c5-nether');
  await cmd('/time set 18000');
  await cmd('/weather thunder');
} catch (e) {
  console.log('FAILED', e);
}
console.log('page errors:', errors.length);
await browser.close();
server.close();
