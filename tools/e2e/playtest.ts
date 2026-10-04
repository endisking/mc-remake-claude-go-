/**
 * Release play-test: serves client/dist, creates a world from the launcher like a player, checks the spawn
 * point, punches a tree, crafts, saves and quits, reopens the world. Logs page errors.
 * Usage: (cd client && npx vite build) && pnpm tsx tools/e2e/playtest.ts [step]
 */
import { chromium, type Page } from '@playwright/test';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const WEB = join(root, 'client/dist');
const out = join(root, 'tools/bench/out/playtest');
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
const PORT = 47990 + Math.floor(Math.random() * 7);
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'bcpt-')), {
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  viewport: { width: 960, height: 540 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors: string[] = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 4).join(' | '));
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`console.${m.type()}`, m.text().slice(0, 300));
});
export const shot = async (name: string) => {
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 120000 });
  console.log(`shot ${name}.png`);
};
export const cmd = (c: string) => page.evaluate((m) => (window as any).game.send({ t: 'chat', message: m }), c);
const G = <T>(fn: string) => page.evaluate((f) => new Function('g', `return (${f})`)((window as any).game), fn) as Promise<T>;
const waitLoaded = () => page.waitForFunction(() => {
  const g = (window as any).game;
  if (!g?.chunks || !g.loggedIn) return false;
  const s = g.chunks.stats();
  return g.world.chunks.size >= 25 && s.pending === 0 && s.building === 0;
}, undefined, { timeout: 240000, polling: 1000 });

const step = process.argv[2] ?? 'all';
try {
  await page.goto(BASE);
  await page.waitForSelector('#l-play');
  await shot('01-launcher');
  await page.fill('#l-seed', process.argv[3] ?? 'playtest');
  await page.fill('#l-wname', 'Release World');
  await page.click('#l-play');
  await page.waitForURL(/world=/);
  // headless Chromium can't take pointer lock: ?nolock=1 lets the world take input without it
  await page.goto(page.url() + '&nolock=1&rd=4');
  await waitLoaded();
  await page.waitForTimeout(2000);
  const spawn = await G<any>(`(() => { const p = g.player; const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const nm = (s) => g.blockNameOf ? g.blockNameOf(s) : s;
    return { x: p.x, y: p.y, z: p.z, onGround: p.onGround, feet: g.world.getState(bx, by, bz), head: g.world.getState(bx, by + 1, bz), below: g.world.getState(bx, by - 1, bz), ref: ["air","grass_block","water","oak_log","oak_leaves","sand","stone","dirt"].map(n => n + "=" + g.stateOfName(n)).join(" "), gm: g.gameMode, url: location.search }; })()`);
  console.log('spawn', JSON.stringify(spawn));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot('02-spawn');
  if (step === 'spawn') throw 'done';
  if (step === 'exitsave') {
    // the desktop app's window close: game.saveForExit(), then the page goes away
    await cmd('/give @s diamond 7');
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window as any).game.saveForExit());
    await page.goto(BASE);
    await page.waitForSelector('#l-open:not([disabled])');
    await page.click('#l-open');
    await page.waitForURL(/world=/);
    await waitLoaded();
    await page.waitForTimeout(1500);
    console.log('inventory after exit-save', await G<string>('g.interaction.inventory.slots.filter(Boolean).map(s => s.id + "x" + s.count).join(",")'));
    throw 'done';
  }

  // ---- punch a tree
  const tree = await G<any>(`(() => { const p = g.player; const logs = new Set(["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log"].map(n => g.stateOfName(n)));
    const solid = (s) => s !== 0 && !g.world.getState;
    let best = null, bd = 1e9;
    for (let dx = -90; dx <= 90; dx++) for (let dz = -90; dz <= 90; dz++) for (let y = 60; y < 100; y++) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
      if (!logs.has(g.world.getState(x, y, z)) || logs.has(g.world.getState(x, y - 1, z))) continue;
      for (const [ox, oz, yaw] of [[0, 2, 180], [0, -2, 0], [2, 0, 90], [-2, 0, 270]]) {
        const sx = x + ox, sz = z + oz;
        if (g.world.getState(sx, y, sz) !== 0 && g.world.getState(sx, y, sz) !== g.stateOfName("grass")) continue;
        if (g.world.getState(sx, y + 1, sz) !== 0) continue;
        if (g.world.getState(sx, y - 1, sz) === 0) continue;
        if (g.world.getState(x + ox / 2, y, z + oz / 2) !== 0 && g.world.getState(x + ox / 2, y, z + oz / 2) !== g.stateOfName("grass")) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = { x, y, z, sx, sz, yaw }; }
      }
    }
    return best; })()`);
  console.log("tree", JSON.stringify(tree), await G<any>(`(() => { let n = 0, m = 0; const p = g.player; for (let dx = -40; dx <= 40; dx++) for (let dz = -40; dz <= 40; dz++) for (let y = 50; y < 110; y++) { const s = g.world.getState(Math.floor(p.x) + dx, y, Math.floor(p.z) + dz); if (s >= 76 && s <= 78) n++; if (s >= 76 && s <= 100) m++; } return [n, m, g.world.chunks.size]; })()`));
  if (tree) {
    await cmd(`/setblock ${tree.x + (tree.sx - tree.x) / 2} ${tree.y} ${tree.z + (tree.sz - tree.z) / 2} air`);
    await cmd(`/tp @s ${tree.sx + 0.5} ${tree.y} ${tree.sz + 0.5} ${tree.yaw} 25`);
    await page.waitForTimeout(1500);
    for (let n = 0; n < 3; n++) {
      const tgt = await G<any>('g.target && { x: g.target.x, y: g.target.y, z: g.target.z, s: g.target.state }');
      console.log('target', JSON.stringify(tgt));
      await page.evaluate(() => (window as any).game.input.press('Mouse0'));
      await page.waitForTimeout(n === 0 ? 1500 : 3600);
      if (n === 0) await shot('03-punching');
      console.log('mining', JSON.stringify(await G<any>('({ prog: g.interaction.destroyProgress, destroying: g.interaction.isDestroying, onGround: g.player.onGround, miner: g.interaction.miner(), tick: g.world.gameTime, y: g.player.y, fps: g.fps })')));
      await page.waitForFunction(([x, y, z, st]) => (window as any).game.world.getState(x, y, z) !== st, [tgt.x, tgt.y, tgt.z, tgt.s], { timeout: 90000, polling: 250 }).catch(() => console.log('NOT BROKEN'));
      await page.evaluate(() => (window as any).game.input.release('Mouse0'));
      await cmd(`/tp @s ${tree.sx + 0.5} ${tree.y} ${tree.sz + 0.5} ${tree.yaw} ${n === 0 ? -15 : 25}`);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2000);
    console.log('inv after tree', await G<any>('g.interaction.inventory.slots.filter(Boolean).map(s => s.id + "x" + s.count).join(",")'));
    await shot('04-after-tree');
  }
  if (step === 'tree') throw 'done';

  // ---- crafting in the inventory
  const slotXY = (i: number) => page.evaluate((idx) => {
    const g = (window as any).game;
    const s = g.screen, sl = s.menu.slots[idx];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return [((s.leftPos + sl.x + 8) * g.gui.scale) / dpr, ((s.topPos + sl.y + 8) * g.gui.scale) / dpr] as [number, number];
  }, i);
  const click = async (i: number, button: 'left' | 'right' = 'left', shift = false) => {
    const [x, y] = await slotXY(i);
    await page.mouse.move(x, y);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.down({ button });
    await page.mouse.up({ button });
    if (shift) await page.keyboard.up('Shift');
    await page.waitForTimeout(250);
  };
  const findSlot = (name: string, from = 0) => page.evaluate(([n, f]) => {
    const g = (window as any).game;
    return g.screen.menu.slots.findIndex((s: any, i: number) => i >= f && s.getItem() && g.itemName?.(s.getItem().id) === n);
  }, [name, from] as const);
  const slotItems = () => page.evaluate(() => (window as any).game.screen.menu.slots.map((s: any, i: number) => (s.getItem() ? `${i}:${s.getItem().id}x${s.getItem().count}` : '')).filter(Boolean).join(' '));
  const invStr = () => G<string>('g.interaction.inventory.slots.filter(Boolean).map(s => s.id + "x" + s.count).join(",")');
  await cmd('/give @s oak_log 4');
  await page.waitForTimeout(1500);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  console.log('screen', await G('g.screen && g.screen.title'), await slotItems());
  const logSlot = await page.evaluate(() => (window as any).game.screen.menu.slots.findIndex((s: any, i: number) => i >= 9 && s.getItem()));
  await click(logSlot); // pick up 5 logs
  await click(1, 'right');
  await click(1, 'right');
  await click(logSlot); // put the rest back
  console.log('grid', await slotItems());
  await click(0, 'left', true); // shift-click planks out (2 crafts = 8 planks)
  console.log('after planks', await slotItems());
  const planks = await page.evaluate(() => (window as any).game.screen.menu.slots.findIndex((s: any, i: number) => i >= 9 && s.getItem() && s.getItem().count >= 8));
  await click(planks);
  for (const s of [1, 2, 3, 4]) await click(s, 'right');
  await click(planks);
  await shot('05-inventory-craft');
  console.log('table grid', await slotItems());
  await click(0, 'left', true);
  const planks2 = await page.evaluate(() => (window as any).game.screen.menu.slots.findIndex((s: any, i: number) => i >= 9 && s.getItem() && s.getItem().count >= 2 && s.getItem().count <= 4));
  await click(planks2);
  await click(1, 'right');
  await click(3, 'right');
  await click(planks2);
  await click(0, 'left', true);
  console.log('after sticks/table', await slotItems());
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  console.log('screen closed?', await G('g.screen && g.screen.title'), await invStr());

  // ---- place the crafting table and make a pickaxe
  if (step === 'craft') throw 'done';

  // ---- night, mobs, combat, death
  await cmd('/give @s iron_sword 1');
  await cmd('/give @s cooked_beef 5');
  await cmd('/time set night');
  await page.waitForTimeout(1500);
  const pp = await G<any>('({ x: g.player.x, y: g.player.y, z: g.player.z })');
  await cmd(`/tp @s ${pp.x} ${pp.y} ${pp.z} 0 0`);
  await cmd(`/summon zombie ${pp.x} ${pp.y} ${pp.z + 4}`);
  await cmd(`/summon skeleton ${pp.x + 6} ${pp.y} ${pp.z + 6}`);
  await cmd(`/summon cow ${pp.x - 4} ${pp.y} ${pp.z + 3}`);
  await page.waitForTimeout(4000);
  console.log('mobs', await G<any>('[...g.entities?.values?.() ?? []].length'), await G<any>('({ health: g.health, food: g.food, hurt: g.hurtTime })'));
  await shot('06-night-mobs');
  // fight: select the sword, swing repeatedly at whatever is targeted
  const swordHot = await G<number>('g.interaction.inventory.slots.slice(0, 9).findIndex(s => s && s.count === 1 && s.id > 500)');
  if (swordHot >= 0) await page.keyboard.press(`Digit${swordHot + 1}`);
  for (let n = 0; n < 25; n++) {
    await page.evaluate(() => { const i = (window as any).game.input; i.press('Mouse0'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const i = (window as any).game.input; i.release('Mouse0'); });
    await page.waitForTimeout(500);
  }
  console.log('after fight', await G<any>('({ health: g.health, items: g.items.size, hurt: g.hurtTime, dead: g.dead })'));
  await shot('07-after-fight');
  // eat
  await cmd('/effect give @s hunger 5 100');
  await page.waitForTimeout(6000);
  const beefHot = await G<number>('g.interaction.inventory.slots.slice(0, 9).findIndex(s => s && s.count >= 2 && s.count <= 5 && s.id > 500)');
  console.log('food before', await G<any>('g.food'), 'beef slot', beefHot);
  if (beefHot >= 0) await page.keyboard.press(`Digit${beefHot + 1}`);
  await page.evaluate(() => (window as any).game.input.press('Mouse2'));
  await page.waitForTimeout(8000);
  await page.evaluate(() => (window as any).game.input.release('Mouse2'));
  console.log('food after', await G<any>('g.food'), await invStr());
  // die and respawn
  await cmd('/kill');
  await page.waitForFunction(() => (window as any).game.screen?.title === 'You died!', undefined, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('08-death');
  await page.evaluate(() => (window as any).game.respawn());
  await page.waitForTimeout(4000);
  console.log('respawned', await G<any>('({ x: g.player.x, y: g.player.y, z: g.player.z, health: g.health, dead: g.dead, screen: g.screen && g.screen.title })'), await invStr());
  await shot('09-respawned');
  if (step === 'mobs') throw 'done';

  // ---- build something, save & quit, reopen
  await cmd('/give @s stone 64');
  await cmd('/time set day');
  const q = await G<any>('({ x: Math.floor(g.player.x), y: Math.floor(g.player.y), z: Math.floor(g.player.z) })');
  await cmd(`/setblock ${q.x + 2} ${q.y} ${q.z} diamond_block`);
  await cmd(`/setblock ${q.x + 2} ${q.y + 1} ${q.z} gold_block`);
  await page.waitForTimeout(2000);
  const before = { inv: await invStr(), pos: await G<any>('[g.player.x, g.player.y, g.player.z]'), time: await G<any>('g.world.dayTime') };
  console.log('before quit', JSON.stringify(before));
  await page.evaluate(() => (window as any).game.quitToTitle());
  await page.waitForSelector('#l-open', { timeout: 120000 });
  await page.waitForTimeout(1000);
  await shot('10-back-to-launcher');
  await page.click('#l-open');
  await page.waitForURL(/world=/);
  await page.goto(page.url() + '&nolock=1&rd=4');
  await waitLoaded();
  await page.waitForTimeout(2000);
  const after = { inv: await invStr(), pos: await G<any>('[g.player.x, g.player.y, g.player.z]'), time: await G<any>('g.world.dayTime'),
    blocks: await G<any>(`[g.world.getState(${q.x + 2}, ${q.y}, ${q.z}), g.world.getState(${q.x + 2}, ${q.y + 1}, ${q.z}), g.stateOfName('diamond_block'), g.stateOfName('gold_block')]`) };
  console.log('after reload', JSON.stringify(after));
  await shot('11-reloaded');

} catch (e) {
  if (e !== 'done') console.log('FAILED', e);
}
console.log('errors:', errors.length);
await ctx.close();
server.close();
