/**
 * Release smoke test: serves the built web app (client/dist) like the desktop app does, opens the launcher,
 * starts a singleplayer world and takes screenshots; fails on page errors.
 * Usage: pnpm build && pnpm tsx tools/e2e/release-smoke.ts [outDir]
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const WEB = join(root, 'client/dist');
const out = process.argv[2] ?? join(root, 'tools/bench/out');
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
await new Promise<void>((r) => server.listen(47998, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:47998/');
await page.waitForSelector('#l-play');
await page.screenshot({ path: join(out, 'release-launcher.png') });
await page.fill('#l-seed', 'blockcraft');
await page.click('#l-play');
await page.waitForTimeout(40000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'release-ingame.png'), timeout: 180000 });
await browser.close();
server.close();
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`ok → ${out}/release-launcher.png, release-ingame.png`);
