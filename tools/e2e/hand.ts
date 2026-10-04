/**
 * First-person hand check: empty hand, a held block, a held flat item, a held tool, mid-swing
 * and walking. Saves screenshots to tools/bench/out/shots/hand-*.png.
 * Usage: pnpm tsx tools/e2e/hand.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));

const shot = async (name: string) => {
  await page.screenshot({ path: `${out}hand-${name}.png` });
  console.log(`saved hand-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const key = (p: Page, code: string) => p.evaluate((c) => {
  const i = (window as any).game.input;
  i.press(c);
  i.release(c);
}, code);
/** Freeze the game loop's hand state for a stable frame (no-op if the hook is missing). */
const settle = () => page.waitForTimeout(700);

await page.goto(`${base}?nolock=1&rd=3&gamemode=creative&x=40.5&y=160&z=40.5&pitch=10&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && g.player.onGround && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 120000 });
await cmd(page, '/gamemode survival');
await page.waitForTimeout(800);
// hide the HUD's hotbar? no — vanilla screenshots include it; keep it
await key(page, 'Digit1');
await settle();
await shot('empty');

for (const c of ['give @s oak_planks 30', 'give @s torch 12', 'give @s iron_pickaxe 1', 'give @s diamond_sword 1', 'give @s bow 1', 'give @s apple 5']) await cmd(page, `/${c}`);
await page.waitForTimeout(400);
await key(page, 'Digit1');
await settle();
await shot('block');
await key(page, 'Digit2');
await settle();
await shot('torch');
await key(page, 'Digit3');
await settle();
await shot('pickaxe');
await key(page, 'Digit4');
await settle();
await shot('sword');
await key(page, 'Digit6');
await settle();
await shot('apple');

// mid-swing: the empty hand (slot 9), then a block
await key(page, 'Digit9');
await settle();
for (const [slot, name] of [['Digit9', 'empty'], ['Digit1', 'block']] as const) {
  await key(page, slot);
  await settle();
  for (const t of [1, 2, 3]) {
    await page.evaluate((tt) => {
      const g = (window as any).game;
      g.debugSwingFreeze = tt;
    }, t);
    await page.waitForTimeout(150);
    await shot(`swing-${name}-${t}`);
  }
  await page.evaluate(() => { (window as any).game.debugSwingFreeze = undefined; });
}

// walking with the empty hand (view bobbing)
await key(page, 'Digit9');
await settle();
await page.evaluate(() => (window as any).game.input.press('KeyW'));
await page.waitForTimeout(900);
await shot('walk-1');
await page.waitForTimeout(170);
await shot('walk-2');
await page.evaluate(() => (window as any).game.input.release('KeyW'));

await browser.close();
