/**
 * Brewing check: the creative Brewing tab with tinted potions, a potion tooltip, and the
 * brewing stand window mid-brew. Screenshots: tools/bench/out/shots/brewing-*.png.
 * Usage: npx tsx tools/e2e/brewing.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../bench/out/shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}?nolock=1&scene=flat&rd=2&gamemode=creative&x=40.5&y=70&z=40.5&pitch=10&yaw=0&time=6000`);
await page.waitForFunction(() => {
  const g = (window as any).game;
  return g?.loggedIn && g.world.chunks.size >= 9;
}, undefined, { timeout: 180000 });
await page.waitForTimeout(1000);
const cmd = (c: string) => page.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
await page.evaluate(() => (window as any).game.openInventory());
await page.waitForTimeout(300);
await page.evaluate(() => (window as any).game.screen.selectTab('brewing'));
await page.waitForTimeout(500);
// hover the first tagged potion row
const pos = await page.evaluate(() => {
  const g = (window as any).game, s = g.screen;
  const sl = s.menu.slots.find((x: any) => x.getItem()?.tag?.Potion === 'swiftness') ?? s.menu.slots[20];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return [((s.leftPos + sl.x + 8) * g.gui.scale) / dpr, ((s.topPos + sl.y + 8) * g.gui.scale) / dpr];
});
await page.mouse.move(pos[0]!, pos[1]!);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}brewing-creative.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// brewing stand mid-brew
await cmd('/gamemode survival');
const [x, y, z] = await page.evaluate(() => {
  const p = (window as any).game.player;
  return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
});
await cmd(`/setblock ${x} ${y} ${z! + 2} brewing_stand`);
await cmd('/give @s potion{Potion:"minecraft:water"} 3');
await cmd('/give @s nether_wart 4');
await cmd('/give @s blaze_powder 2');
await page.waitForTimeout(800);
await page.evaluate(([bx, by, bz]) => (window as any).game.send({ t: 'useOn', x: bx, y: by, z: bz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 }), [x, y, z! + 2]);
await page.waitForFunction(() => (window as any).game.screen?.menu?.type === 'brewing_stand', undefined, { timeout: 20000 });
for (let i = 0; i < 6; i++) {
  await page.evaluate((k) => {
    const g = (window as any).game;
    g.send({ t: 'clickWindow', windowId: g.screen.menu.containerId, slot: 32 + k, button: 0, clickType: 1 });
  }, i);
}
await page.waitForTimeout(4000);
console.log('data', await page.evaluate(() => (window as any).game.screen.menu.data));
await page.screenshot({ path: `${out}brewing-stand.png` });
await browser.close();
