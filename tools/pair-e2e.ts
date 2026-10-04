/**
 * End-to-end check of offline play: the built game is served on localhost, cached by the service
 * worker, then the web server is shut down. The host reloads the world offline and makes an
 * invite; a guest (separate browser profile, also offline) pastes it, answers, the host pastes the reply, and the
 * guest must log into the host's world. Screenshots go to the given directory.
 * Usage: pnpm tsx tools/pair-e2e.ts <outdir>   (after `npx vite build` in client/)
 */
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const out = process.argv[2] ?? '.';
const dist = new URL('../client/dist/', import.meta.url).pathname;
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(dist, path);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${(server.address() as { port: number }).port}/`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  // Chrome hides local IPs behind mDNS .local names (as it does until camera access is granted);
  // this container has no mDNS resolver, so show real addresses, as a guest who scanned would
  '--disable-features=WebRtcHideLocalIpsWithMdns',
] });
const log = (who: string, p: Page) => {
  p.on('console', (m) => { if (/LAN|offline|error|rror/i.test(m.text())) console.log(`[${who}]`, m.text()); });
  p.on('pageerror', (e) => console.log(`[${who} pageerror]`, e.message));
};
const viewport = { width: 960, height: 600 };
const hostCtx = await browser.newContext({ viewport });
const guestCtx = await browser.newContext({ viewport });
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();
log('host', host);
log('guest', guest);

// first visit online: the service worker caches the whole build
for (const p of [host, guest]) {
  await p.goto(base);
  await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('no active service worker');
  });
  // wait for precaching to finish (install completes before ready resolves, but be safe)
  await p.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('blockcraft-')), null, { timeout: 120000 });
}
console.log('cached; going offline');
server.close();
server.closeAllConnections();
// (the web server is gone, so everything below loads from the cache; Playwright's setOffline isn't
// used because it also blocks WebRTC, which a Wi-Fi network without internet does not)

// host: launcher and world load from the cache alone
await host.goto(base);
await host.screenshot({ path: `${out}/pair-0-launcher-offline.png` });
await host.goto(`${base}?seed=42`);
await host.waitForFunction(() => (window as any).game?.integrated && (window as any).game?.loggedIn, null, { timeout: 120000 });
await host.waitForTimeout(4000);
await host.evaluate(() => (window as any).game.startOfflineLan());
const inviteEl = await host.waitForSelector('[data-ticket]', { timeout: 30000 });
const invite = (await inviteEl.getAttribute('data-ticket'))!;
console.log('invite', invite.length, 'chars');
await host.screenshot({ path: `${out}/pair-1-host-invite.png` });

// guest: paste the invite, get the reply
await guest.goto(`${base}?pair=1`);
await guest.waitForSelector('#bc-pair-paste', { timeout: 30000 });
await guest.fill('#bc-pair-paste', invite);
await guest.getByText('Use pasted code').click();
const replyEl = await guest.waitForSelector('[data-ticket]', { timeout: 30000 });
const reply = (await replyEl.getAttribute('data-ticket'))!;
console.log('reply', reply.length, 'chars');
await guest.screenshot({ path: `${out}/pair-2-guest-reply.png` });

// host: scan (paste) the reply
await host.getByText('Next: scan their reply code').click();
await host.waitForSelector('#bc-pair-paste');
await host.fill('#bc-pair-paste', reply);
await host.getByText('Use pasted code').click();

try {
  await guest.waitForFunction(() => (window as any).game?.loggedIn, null, { timeout: 60000 });
} catch (e) {
  await guest.screenshot({ path: `${out}/pair-fail-guest.png` });
  await host.screenshot({ path: `${out}/pair-fail-host.png` });
  throw e;
}
await guest.waitForTimeout(8000);
await guest.screenshot({ path: `${out}/pair-3-guest-in-world.png` });
await host.screenshot({ path: `${out}/pair-4-host-after.png` });
const players = await host.evaluate(() => (window as any).game.lanStatus);
console.log('host status:', players);
await browser.close();
console.log('OK');
