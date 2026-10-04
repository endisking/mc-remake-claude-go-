/**
 * Interaction check: gives items, digs a block in survival (crack + particles + drop + pickup),
 * places blocks and flat items, and saves screenshots to tools/bench/out/shots/interact-*.png.
 * Usage: pnpm tsx tools/e2e/interact.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));

const shot = async (name: string) => {
  await page.screenshot({ path: `${out}interact-${name}.png` });
  console.log(`saved interact-${name}.png`);
};
const cmd = (p: Page, c: string) => p.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const mouse = (p: Page, button: number, down: boolean) =>
  p.evaluate(([b, d]) => {
    const i = (window as any).game.input;
    if (d) i.press(`Mouse${b}`);
    else i.release(`Mouse${b}`);
  }, [button, down] as const);
const key = (p: Page, code: string) => p.evaluate((c) => {
  const i = (window as any).game.input;
  i.press(c);
  i.release(c);
}, code);
const state = () =>
  page.evaluate(() => {
    const g = (window as any).game;
    const t = g.target;
    return { target: t ? { x: t.x, y: t.y, z: t.z, state: t.state } : null, items: g.items.size, inv: g.interaction.inventory.slots.slice(0, 36).filter((s: any) => s).map((s: any) => (s ? `${s.id}x${s.count}` : '-')), sel: g.interaction.inventory.selected, particles: g.particles.count ?? null };
  });

await page.goto(`${base}?nolock=1&rd=3&gamemode=survival&x=40.5&y=90&z=40.5&pitch=55&yaw=20&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks) return false;
  const s = g.chunks.stats();
  return g.loggedIn && Math.abs(g.player.x - 40.5) < 0.01 && g.player.onGround && g.world.chunks.size >= 49 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 90000 });
await page.waitForTimeout(500);
for (const c of ['give @s grass_block 64', 'give @s oak_planks 30', 'give @s dandelion 5', 'give @s torch 12', 'give @s oak_log 1', 'give @s glass 3', 'give @s cobblestone 64', 'give @s oak_leaves 20', 'give @s rail 7']) await cmd(page, `/${c}`);
await page.waitForTimeout(400);
console.log(await state());
await shot('hotbar');

// dig the block below/in front: hold attack until it breaks (grass by hand: 0.9 s)
await mouse(page, 0, true);
await page.waitForTimeout(500);
await shot('cracking');
await page.waitForTimeout(700);
await mouse(page, 0, false);
await page.waitForTimeout(60);
await shot('broken');
console.log(await state());
await page.waitForTimeout(1500);
console.log('after pickup', await state());
await shot('pickup');

// place: select slot 2 (planks) and use; then torch, dandelion
await key(page, 'Digit2');
await page.waitForTimeout(100);
await mouse(page, 2, true);
await page.waitForTimeout(80);
await mouse(page, 2, false);
await page.waitForTimeout(300);
await shot('placed');
await page.evaluate(() => ((window as any).game.yaw += 40));
await key(page, 'Digit4');
await page.waitForTimeout(100);
await mouse(page, 2, true);
await page.waitForTimeout(80);
await mouse(page, 2, false);
await page.evaluate(() => ((window as any).game.yaw -= 80));
await key(page, 'Digit3');
await page.waitForTimeout(100);
await mouse(page, 2, true);
await page.waitForTimeout(80);
await mouse(page, 2, false);
await page.waitForTimeout(500);
console.log(await state());
await shot('placed2');
// drop a stack with Q and look at it
await key(page, 'Digit7');
await page.waitForTimeout(100);
await page.evaluate(() => (window as any).game.input.press('ControlLeft'));
await key(page, 'KeyQ');
await page.waitForTimeout(100);
await page.evaluate(() => (window as any).game.input.release('ControlLeft'));
await page.waitForTimeout(900);
// look at the dropped stack from 2 blocks away
const it = await page.evaluate(() => {
  const g = (window as any).game;
  const [e] = [...g.items.values()];
  if (!e) return null;
  g.yaw = Math.atan2(-(e.x - g.player.x), e.z - g.player.z) * 180 / Math.PI;
  g.pitch = -Math.atan2(e.y + 0.2 - (g.player.y + 1.62), Math.hypot(e.x - g.player.x, e.z - g.player.z)) * 180 / Math.PI;
  return { x: e.x, y: e.y, z: e.z, item: e.item, count: e.count, px: g.player.x, py: g.player.y, pz: g.player.z };
});
console.log('dropped item', it);
await page.waitForTimeout(300);
await shot('dropped');
console.log(await state());
await browser.close();
