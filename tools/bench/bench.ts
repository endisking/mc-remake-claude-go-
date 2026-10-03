/**
 * Performance benchmark: flies a fixed path through a fixed seed and reports average FPS,
 * 1% lows and chunk build time. Results are appended to tools/bench/out/results.jsonl.
 *
 * Usage: pnpm bench [baseUrl] [renderDistance] [seconds]
 * In this container Chromium uses SwiftShader (software GL), so absolute numbers are far
 * below real hardware; compare runs against each other to catch regressions.
 */
import { chromium } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const rd = Number(process.argv[3] ?? 6);
const seconds = Number(process.argv[4] ?? 20);
const outDir = new URL('./out/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const gpuArgs = process.env.BENCH_GPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: gpuArgs });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&seed=20211&rd=${rd}&fps=0&x=0&y=100&z=0&time=6000&weather=clear`);
await page.waitForFunction(() => (window as any).game?.loggedIn && (window as any).game.chunks, undefined, { timeout: 60000 });
// let the initial area load
await page.waitForFunction(() => { const s = (window as any).game.chunks.stats(); return s.sections > 100 && s.pending < 20; }, undefined, { timeout: 180000 }).catch(() => {});

const result = await page.evaluate(async (seconds) => {
  const g = (window as any).game;
  const times: number[] = [];
  const start = performance.now();
  let last = start;
  // fixed path: a slow circle of radius 60 at y=100 while yawing
  await new Promise<void>((resolve) => {
    const step = (t: number) => {
      const el = (t - start) / 1000;
      times.push(t - last);
      last = t;
      const a = el * 0.25;
      g.setCamera(Math.cos(a) * 60, 100, Math.sin(a) * 60, (a * 180) / Math.PI + 90, 20);
      if (el < seconds) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  times.shift();
  const sorted = [...times].sort((a, b) => b - a);
  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const p1 = sorted[Math.max(0, Math.floor(sorted.length * 0.01))]!;
  const st = g.chunks.stats();
  return { frames: times.length, avgFps: 1000 / avgMs, low1Fps: 1000 / p1, chunkBuildMs: st.avgBuildMs, sections: st.sections };
}, seconds);

const rec = { date: new Date().toISOString(), rd, seconds, gpu: process.env.BENCH_GPU ? 'hardware' : 'swiftshader', ...result };
console.log(JSON.stringify(rec, null, 1));
appendFileSync(`${outDir}results.jsonl`, JSON.stringify(rec) + '\n');
await browser.close();
