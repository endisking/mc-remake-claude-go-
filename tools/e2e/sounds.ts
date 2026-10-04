/**
 * Sound check: every file in sounds.json decodes in the browser, and gameplay events start
 * playback (counts active sources while breaking, placing and walking).
 * Usage: pnpm tsx tools/e2e/sounds.ts [baseUrl]
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&rd=2&gamemode=survival&scene=models&x=20.5&y=101&z=-3.5&pitch=60`);
// wait for the URL teleport to land us on the ground
await page.waitForFunction(() => {
  const g = (window as any).game;
  return g?.loggedIn && Math.abs(g.player.x - 20.5) < 0.01 && g.player.onGround;
}, undefined, { timeout: 90000 });
const decoded = await page.evaluate(async () => {
  const m = await (await fetch('./sounds/sounds.json')).json();
  const names = new Set<string>();
  for (const e of Object.values(m) as any[]) for (const s of e.sounds) names.add(s.name);
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const bad: string[] = [];
  let seconds = 0;
  for (const n of names) {
    try {
      const b = await ctx.decodeAudioData(await (await fetch(`./sounds/${n}.ogg`)).arrayBuffer());
      seconds += b.duration;
    } catch {
      bad.push(n);
    }
  }
  return { files: names.size, bad, seconds: Math.round(seconds) };
});
console.log('decode', decoded);
// gameplay: count sources started
const played = await page.evaluate(async () => {
  const g = (window as any).game;
  g.sound.resume();
  const log: string[] = [];
  const orig = g.sound.play.bind(g.sound);
  g.sound.play = (ev: string, ...rest: unknown[]) => {
    log.push(ev);
    return orig(ev, ...rest);
  };
  g.send({ t: 'chat', message: '/give @s oak_planks 5' });
  // walk first (digging below leaves us in a hole)
  const pitch = g.pitch;
  g.pitch = 0;
  g.yaw = 270;
  g.input.press('KeyW');
  await new Promise((r) => setTimeout(r, 2000));
  g.input.release('KeyW');
  log.push(`walked to ${g.player.x.toFixed(1)},${g.player.y.toFixed(1)},${g.player.z.toFixed(1)} moveDist=${g.steps.moveDist.toFixed(2)} water=${g.player.isInWater}`);
  g.pitch = pitch;
  await new Promise((r) => setTimeout(r, 400));
  // dig the block below, then place, then walk
  g.input.press('Mouse0');
  await new Promise((r) => setTimeout(r, 1500));
  g.input.release('Mouse0');
  g.input.press('Mouse2');
  await new Promise((r) => setTimeout(r, 100));
  g.input.release('Mouse2');
  return { ctx: g.sound.ctx?.state, events: [...new Set(log)], count: log.length };
});
console.log('played', played);
await browser.close();
