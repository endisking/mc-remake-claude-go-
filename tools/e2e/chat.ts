/**
 * Chat, commands and the player list on the dedicated server: Alex (op via OPS) opens chat with
 * T, types a command and sees the suggestion box, chats with Blake, Blake holds Tab for the player
 * list and sees Alex's nameplate, Alex runs commands with feedback, then kicks Blake (disconnected
 * screen). Starts its own server on port 8093 with a temporary world folder.
 * Usage: pnpm tsx tools/e2e/chat.ts
 */
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const root = new URL('../../', import.meta.url).pathname;
const worldDir = mkdtempSync(join(tmpdir(), 'bc-chat-'));
const srv = spawn('pnpm', ['-s', 'tsx', '--tsconfig', 'server/tsconfig.json', 'server/src/node/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: '8093', SCENE: 'models', GAMEMODE: '0', OPS: 'Alex', WORLD_DIR: worldDir },
  stdio: 'pipe',
});
srv.stderr.on('data', (d) => process.stdout.write(`[server!] ${d}`));
// wait for the listen line
await new Promise<void>((resolve) => {
  srv.stdout.on('data', (d) => {
    process.stdout.write(`[server] ${d}`);
    if (String(d).includes('Blockcraft server on')) resolve();
  });
  setTimeout(resolve, 30000);
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (what: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};
try {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (name: string, x: number, z: number, yaw: number, op = true) => {
    const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
    page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
    // non-ops can't use the ?x= test hooks (they run /tp): an op teleports them instead
    await page.goto(op ? `http://localhost:8093/?nolock=1&rd=2&server=ws://localhost:8093&room=chat&name=${name}&x=${x}&y=101&z=${z}&yaw=${yaw}&pitch=0&time=6000` : `http://localhost:8093/?nolock=1&rd=2&server=ws://localhost:8093&room=chat&name=${name}`);
    if (!op) {
      await page.waitForFunction(() => (window as any).game?.loggedIn, null, { timeout: 60000 });
      await opPage!.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), `/tp ${name} ${x} 101 ${z} ${yaw} 0`);
    }
    try {
      await page.waitForFunction((xx) => {
        const g = (window as any).game;
        return g?.loggedIn && Math.abs(g.player.x - xx) < 0.01 && g.player.onGround;
      }, x, { timeout: 60000 });
    } catch (e) {
      console.log(name, await page.evaluate(() => { const g = (window as any).game; return JSON.stringify({ loggedIn: g?.loggedIn, x: g?.player?.x, y: g?.player?.y, og: g?.player?.onGround, chat: g?.hud?.chatLines?.map((l: any) => l.text) }); }));
      await page.screenshot({ path: `${out}chat-fail-${name}.png` });
      throw e;
    }
    return page;
  };
  const tap = (p: Page, code: string, hold = 60) => p.evaluate(([c, h]) => {
    const i = (window as any).game.input;
    i.press(c);
    setTimeout(() => i.release(c), h as number);
  }, [code, hold] as const);
  const chatLines = (p: Page) => p.evaluate(() => ((window as any).game.hud.chatLines as { text: string }[]).map((l) => l.text.replace(/§./g, '')));

  let opPage: Page | null = null;
  const a = await open('Alex', 31.5, 7.5, 0);
  opPage = a;
  const b = await open('Blake', 31.5, 12.5, 180, false);
  await b.evaluate(() => (window as any).game.send({ t: 'chat', message: '/time set day' }));
  await wait(400);
  check('Blake (not an op) cannot use cheat commands', (await chatLines(b)).includes('Unknown or incomplete command, see below for error'));
  await wait(1500);
  // T opens the chat; typing a command shows suggestions from the server
  await tap(a, 'KeyT');
  const opened = await a.waitForFunction(() => (window as any).game.screen?.title === 'Chat screen', null, { timeout: 5000 }).then(() => true, () => false);
  check('T opened the chat screen', opened);
  await a.keyboard.type('/gamemode ');
  await wait(500);
  await a.screenshot({ path: `${out}chat-suggestions.png` });
  await a.keyboard.type('cr');
  await wait(300);
  await a.keyboard.press('Tab');
  await wait(200);
  check('Tab completed "creative"', (await a.evaluate(() => (window as any).game.screen.value)) === '/gamemode creative');
  await a.keyboard.press('Enter');
  await wait(600);
  check('the command ran (creative)', (await a.evaluate(() => (window as any).game.gameMode)) === 1);
  check('feedback "Set own game mode to Creative Mode"', (await chatLines(a)).includes('Set own game mode to Creative Mode'));
  // plain chat reaches Blake
  await tap(a, 'KeyT');
  await wait(300);
  await a.keyboard.type('hello Blake');
  await a.keyboard.press('Enter');
  await wait(600);
  check('Blake received "<Alex> hello Blake"', (await chatLines(b)).includes('<Alex> hello Blake'));
  // bad command: error with the <--[HERE] marker
  await tap(a, 'Slash');
  await wait(300);
  check('/ opens chat with a slash', (await a.evaluate(() => (window as any).game.screen?.value)) === '/');
  await a.keyboard.type('time set banana');
  await wait(500);
  await a.screenshot({ path: `${out}chat-error.png` });
  await a.keyboard.press('Enter');
  await wait(600);
  check('error context shown', (await chatLines(a)).some((l) => l.endsWith('<--[HERE]')));
  // history: up arrow brings back the last message
  await tap(a, 'KeyT');
  await wait(300);
  await a.keyboard.press('ArrowUp');
  check('ArrowUp recalls the last sent line', (await a.evaluate(() => (window as any).game.screen.value)) === '/time set banana');
  await a.keyboard.press('Escape');
  await wait(300);
  await a.screenshot({ path: `${out}chat-closed.png` });
  // player list and nameplates on Blake's screen
  await b.evaluate(() => (window as any).game.input.press('Tab'));
  await wait(400);
  await b.screenshot({ path: `${out}chat-playerlist.png` });
  await b.evaluate(() => (window as any).game.input.release('Tab'));
  check('Blake knows two players', (await b.evaluate(() => (window as any).game.playerInfo.size)) === 2);
  // Alex kicks Blake → disconnected screen
  await a.evaluate(() => (window as any).game.send({ t: 'chat', message: '/kick Blake Time for bed' }));
  await wait(800);
  await b.screenshot({ path: `${out}chat-kicked.png` });
  check('Blake sees the disconnected screen', await b.evaluate(() => (window as any).game.screen?.title === 'Connection Lost'));
  check('Alex sees "Blake left the game"', (await chatLines(a)).includes('Blake left the game'));
  // ban persists to banned-players.json in the room folder
  await a.evaluate(() => (window as any).game.send({ t: 'chat', message: '/ban Mallory' }));
  await wait(400);
  const banFile = join(worldDir, 'chat', 'banned-players.json');
  check('banned-players.json written', existsSync(banFile) && readFileSync(banFile, 'utf8').includes('Mallory'));
  await browser.close();
} finally {
  srv.kill();
}
process.exit(failed ? 1 : 0);
