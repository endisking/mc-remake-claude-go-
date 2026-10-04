/**
 * Multiplayer play-test on the dedicated server with real world generation: two players join one room,
 * see each other, chat, a block placed by one shows for the other; the server log is checked for errors.
 * Usage: (cd client && npx vite build) && pnpm tsx tools/e2e/mp-playtest.ts
 */
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const out = join(root, 'tools/bench/out/playtest');
mkdirSync(out, { recursive: true });
const PORT = '8093';
const srv = spawn('pnpm', ['-s', 'tsx', '--tsconfig', 'server/tsconfig.json', 'server/src/node/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT, OPS: '*', SEED: '424242', WORLDS_DIR: mkdtempSync(join(tmpdir(), 'bcmp-')) },
});
let serverLog = '';
srv.stdout.on('data', (d) => { serverLog += d; process.stdout.write(`[server] ${d}`); });
srv.stderr.on('data', (d) => { serverLog += d; process.stdout.write(`[server!] ${d}`); });
await new Promise((r) => setTimeout(r, 8000));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
const open = async (name: string) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', (e) => { errors.push(`${name}: ${e.message}`); console.log(`[${name}] PAGEERROR`, e.message); });
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console.error`, m.text().slice(0, 300)));
  await page.goto(`http://localhost:${PORT}/?nolock=1&rd=3&server=ws://localhost:${PORT}&room=mp&name=${name}`);
  await page.waitForFunction(() => {
    const g = (window as any).game;
    if (!g?.chunks || !g.loggedIn) return false;
    const s = g.chunks.stats();
    return g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
  }, undefined, { timeout: 300000, polling: 1000 });
  return page;
};
const G = <T>(page: Page, fn: string) => page.evaluate((f) => new Function('g', `return (${f})`)((window as any).game), fn) as Promise<T>;
try {
  if (process.argv[2] === 'lan') {
    // "Open to LAN": a browser-hosted world, a guest joins over WebRTC via the server's /signal relay
    const host = await browser.newPage({ viewport: { width: 800, height: 450 } });
    host.on('pageerror', (e) => { errors.push(`host: ${e.message}`); console.log('[host] PAGEERROR', e.message); });
    host.on('console', (m) => (m.type() === 'error' || m.text().includes('LAN')) && console.log('[host]', m.text().slice(0, 300)));
    await host.goto(`http://localhost:${PORT}/?nolock=1&rd=3&seed=55&name=Host&host=LANTEST&signal=ws://localhost:${PORT}/signal`);
    await host.waitForFunction(() => (window as any).game?.loggedIn, undefined, { timeout: 300000, polling: 1000 });
    await host.waitForTimeout(5000);
    const guest = await browser.newPage({ viewport: { width: 800, height: 450 } });
    guest.on('pageerror', (e) => { errors.push(`guest: ${e.message}`); console.log('[guest] PAGEERROR', e.message); });
    guest.on('console', (m) => console.log('[guest]', m.type(), m.text().slice(0, 300)));
    await guest.goto(`http://localhost:${PORT}/?nolock=1&rd=3&name=Guest&join=LANTEST&signal=ws://localhost:${PORT}/signal`);
    await guest.waitForFunction(() => (window as any).game?.loggedIn, undefined, { timeout: 90000, polling: 1000 }).catch(() => console.log('guest never logged in'));
    await guest.waitForTimeout(8000);
    console.log('guest', await G(guest, '[g.loggedIn, g.player.x, g.player.y, g.player.z, g.world.chunks.size]'), 'host lan status', await G(host, 'g.lanStatus'));
    await guest.screenshot({ path: join(out, 'lan-guest.png') });
    throw 'done';
  }
  const a = await open('Alice');
  console.log('Alice in', await G(a, '[g.player.x, g.player.y, g.player.z, g.player.onGround]'));
  const b = await open('Bob');
  console.log('Bob in', await G(b, '[g.player.x, g.player.y, g.player.z, g.player.onGround]'));
  await a.waitForTimeout(3000);
  await a.evaluate(() => (window as any).game.send({ t: 'chat', message: 'hello bob' }));
  const pb = await G<number[]>(b, '[Math.floor(g.player.x), Math.floor(g.player.y), Math.floor(g.player.z)]');
  await a.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), `/tp Alice ${pb[0]! + 0.5} ${pb[1]} ${pb[2]! + 3.5} 180 0`);
  await a.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), `/setblock ${pb[0]! + 2} ${pb[1]} ${pb[2]} gold_block`);
  await a.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), '/time set night');
  await a.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), `/summon zombie ${pb[0]! - 3} ${pb[1]} ${pb[2]}`);
  await b.waitForTimeout(5000);
  const gold = await G<boolean>(b, `g.world.getState(${pb[0]! + 2}, ${pb[1]}, ${pb[2]}) === g.stateOfName('gold_block')`);
  console.log('Bob sees gold block:', gold, 'Bob remote players:', await G(b, 'g.remotePlayers ? g.remotePlayers.size : (g.players ? g.players.size : "?")'));
  await b.screenshot({ path: join(out, 'mp-bob.png') });
  await a.screenshot({ path: join(out, 'mp-alice.png') });
  await b.keyboard.press('Tab').catch(() => {});
  await b.reload();
  await b.waitForFunction(() => (window as any).game?.loggedIn, undefined, { timeout: 300000 });
  await b.waitForTimeout(3000);
  console.log('Bob rejoined at', await G(b, '[g.player.x, g.player.y, g.player.z]'));
} catch (e) {
  if (e !== 'done') console.log('FAILED', e);
}
await browser.close();
srv.kill();
const bad = serverLog.split('\n').filter((l) => /error|exception|TypeError|RangeError/i.test(l));
console.log('server error lines:', bad.length, bad.slice(0, 10).join('\n'));
console.log('page errors:', errors.length);
process.exit(0);
