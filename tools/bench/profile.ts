/**
 * Main-thread CPU and allocation profile of the benchmark flight (Chrome DevTools Protocol).
 * Prints the top functions by self time and the top allocation sites while flying.
 *
 * Usage: pnpm tsx tools/bench/profile.ts [baseUrl] [renderDistance] [seconds]
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173/';
const rd = Number(process.argv[3] ?? 6);
const seconds = Number(process.argv[4] ?? 10);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&fly=1&seed=20211&rd=${rd}&fps=0&x=0&y=100&z=0&time=6000&weather=clear`);
await page.waitForFunction(() => (window as any).game?.loggedIn && (window as any).game.chunks, undefined, { timeout: 60000 });
await page.waitForFunction(() => { const s = (window as any).game.chunks.stats(); return s.sections > 100 && s.pending < 20; }, undefined, { timeout: 180000 }).catch(() => {});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as any);
await cdp.send('Profiler.start');
const frames = (await page.evaluate(`(async () => {
  const g = window.game; const start = performance.now(); let n = 0;
  await new Promise((resolve) => { function step(t) { const el = (t - start) / 1000; n++;
    const a = el * 0.25; g.setCamera(Math.cos(a) * 60, 100, Math.sin(a) * 60, (a * 180) / Math.PI + 90, 20);
    if (el < ${seconds}) requestAnimationFrame(step); else resolve(); } requestAnimationFrame(step); });
  return { n, cpuFrameMs: g.cpuFrameMs };
})()`)) as { n: number; cpuFrameMs: number };
const { profile } = (await cdp.send('Profiler.stop')) as any;
const { profile: heap } = (await cdp.send('HeapProfiler.stopSampling')) as any;

// self time per function
const self = new Map<string, number>();
const byId = new Map<number, any>();
for (const n of profile.nodes) byId.set(n.id, n);
const dt = new Map<number, number>();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
let total = 0;
for (const [id, t] of dt) {
  const n = byId.get(id);
  const f = n.callFrame;
  const name = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self.set(name, (self.get(name) ?? 0) + t);
  total += t;
}
console.log(`frames ${frames.n} in ${seconds}s, cpuFrameMs ${frames.cpuFrameMs.toFixed(2)}; profile ${(total / 1000).toFixed(0)} ms`);
console.log('--- top self time (ms)');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 35)) console.log((v / 1000).toFixed(1).padStart(8), k);

// allocations per site
const alloc = new Map<string, number>();
const walk = (n: any) => {
  const f = n.callFrame;
  const name = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  alloc.set(name, (alloc.get(name) ?? 0) + n.selfSize);
  for (const c of n.children) walk(c);
};
walk(heap.head);
console.log('--- top allocation sites (KB sampled during flight)');
for (const [k, v] of [...alloc].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log((v / 1024).toFixed(0).padStart(8), k);
await browser.close();
