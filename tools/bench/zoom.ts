/** Crop and upscale part of a screenshot (pixelated) for close inspection: tsx tools/bench/zoom.ts in.png x y w h scale out.png */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [inp, x, y, w, h, sc, outp] = process.argv.slice(2);
const s = Number(sc);
const b64 = readFileSync(inp!).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: Number(w) * s, height: Number(h) * s } });
await page.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${b64}" style="image-rendering:pixelated;transform-origin:0 0;transform:scale(${s}) translate(${-Number(x)}px,${-Number(y)}px)"></body>`);
await page.waitForTimeout(100);
await page.screenshot({ path: outp! });
await browser.close();
