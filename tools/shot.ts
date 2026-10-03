/** Screenshot helper: tsx tools/shot.ts <url> <out.png> [width] [height] [waitMs] */
import { chromium } from '@playwright/test';

const [url, out, w = '1280', h = '800', wait = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url!);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out!, fullPage: false });
await browser.close();
