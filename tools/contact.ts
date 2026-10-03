/** Contact sheet: tsx tools/contact.ts out.png img1.png img2.png ... (3 columns, labelled) */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [out, ...imgs] = process.argv.slice(2);
const cells = imgs.map((p) => `<figure><img src="data:image/png;base64,${readFileSync(p).toString('base64')}"><figcaption>${basename(p)}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#222;color:#eee;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
<style>figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 4px}</style>${cells}</body></html>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1500, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: out!, fullPage: true });
await b.close();
