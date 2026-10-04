/**
 * Mob visual check: spawns client-side mobs in the models showcase scene (no server mob
 * system needed) and saves screenshots to tools/bench/out/mobs/.
 * Usage: pnpm tsx tools/mobshots.ts [baseUrl] [filter]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const filter = process.argv[3] ?? '';
const out = new URL('./bench/out/mobs/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

interface MobSpec { type: string; x: number; z: number; yaw?: number; data?: Record<string, number>; walk?: boolean; flags?: number; hurt?: boolean; die?: number }
interface Shot { cam: string; mobs: MobSpec[]; wait?: number; y?: number }

const A = ['zombie', 'skeleton', 'creeper', 'spider'];
const B = ['pig', 'cow', 'sheep', 'chicken'];
const C = ['enderman', 'slime', 'husk', 'drowned'];
const D = ['stray', 'cave_spider', 'bat', 'squid'];
/** a row centred on x = 24.2 at z = 4.5; yaw 180 faces the camera */
const row = (types: string[], extra: Partial<MobSpec> = {}) => types.map((type, i) => ({ type, x: 24.2 - (i - (types.length - 1) / 2) * 2.2, z: 4.5, yaw: 180, ...extra }));
const NEAR = 'x=24.2&y=200&z=-0.5&lookat=24.2,200.8,4.5&fov=70';
const FAR = 'x=24.2&y=200.5&z=-3.5&lookat=24.2,200.6,4.5&fov=60';

const SHOTS: Record<string, Shot> = {
  a_front: { cam: NEAR, mobs: row(A) },
  b_front: { cam: NEAR, mobs: row(B) },
  c_front: { cam: NEAR, mobs: row(C, { data: { size: 2 } }) },
  d_front: { cam: NEAR, mobs: row(D) },
  a_side: { cam: NEAR, mobs: row(A, { yaw: 90 }) },
  b_side: { cam: NEAR, mobs: row(B, { yaw: 90 }) },
  a_back: { cam: NEAR, mobs: row(A, { yaw: 0 }) },
  b_back: { cam: NEAR, mobs: row(B, { yaw: 0 }) },
  a_walk: { cam: NEAR, mobs: row(A, { yaw: 120, walk: true }), wait: 1100 },
  b_walk: { cam: NEAR, mobs: row(B, { yaw: 120, walk: true }), wait: 1100 },
  c_walk: { cam: NEAR, mobs: row(C, { yaw: 120, walk: true, data: { size: 2 } }), wait: 1100 },
  states: {
    cam: FAR,
    mobs: row(['zombie', 'zombie', 'skeleton', 'creeper', 'pig', 'sheep', 'sheep', 'chicken'], { yaw: 150 }).map((m, i) => ({
      ...m, data: ([{ aggressive: 1 }, { baby: 1 }, { aggressive: 1 }, { swell_dir: 1 }, { saddle: 1 }, { color: 14 }, { sheared: 1 }, { baby: 1 }] as Record<string, number>[])[i],
    })),
    wait: 1200,
  },
  babies: { cam: FAR, mobs: row(['zombie', 'pig', 'cow', 'sheep', 'chicken', 'husk', 'drowned', 'pig'], { yaw: 150, data: { baby: 1 } }) },
  effects: {
    cam: FAR,
    mobs: row(['zombie', 'skeleton', 'cow', 'pig', 'sheep', 'spider'], { yaw: 150 }).map((m, i) => ({ ...m, ...[{ hurt: true }, { flags: 1 }, { die: 8 }, { die: 30 }, { data: { color: 11 } }, { flags: 1 }][i] })),
    wait: 400,
  },
  night: { cam: NEAR + '&time=18000', mobs: row(['spider', 'enderman', 'zombie', 'cave_spider']) },
};

async function spawn(page: Page, mobs: MobSpec[]): Promise<void> {
  await page.evaluate(({ mobs, Y }) => {
    const g = (window as any).game;
    let id = 900000;
    for (const s of mobs) {
      const m = g.mobs.add(id++, s.type, s.x, Y, s.z);
      m.setPos(s.x, Y, s.z, s.yaw ?? 0, 0, s.yaw ?? 0);
      m.onGround = true;
      for (const [k, v] of Object.entries(s.data ?? {})) m.setData(k, v);
      if (s.flags) m.flags = s.flags;
      if (s.hurt) {
        const keep = () => { m.hurtTime = 10; };
        setInterval(keep, 50);
      }
      if (s.die) {
        g.mobs.event(m.id, 3);
        m.deathTime = s.die;
      }
      if (s.walk) {
        // walk back and forth through the spot at ~0.1 blocks/tick so the limbs swing
        let t = 0;
        const yaw = ((s.yaw ?? 0) * Math.PI) / 180;
        setInterval(() => {
          t++;
          const d = ((t % 30) - 15) * 0.1;
          if (t % 30 === 0) m.setPos(s.x + Math.sin(yaw) * 1.5, Y, s.z - Math.cos(yaw) * 1.5, s.yaw ?? 0, 0, s.yaw ?? 0);
          m.lerpTo(s.x - Math.sin(yaw) * d, Y, s.z + Math.cos(yaw) * d, s.yaw ?? 0, 0, s.yaw ?? 0, true);
        }, 50);
      }
    }
  }, { mobs, Y: 200 });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, shot] of Object.entries(SHOTS)) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console`, m.text()); });
  await page.goto(`${base}?nolock=1&fly=1&rd=3&gamemode=creative&${shot.cam.includes("time=") ? "" : "time=6000&"}${shot.cam}`);
  await page.waitForFunction(() => {
    const g = (window as any).game;
    if (!g?.chunks) return false;
    const s = g.chunks.stats();
    return g.loggedIn && s.pending === 0 && s.building === 0 && g.world.chunks.size > 20;
  }, undefined, { timeout: 90000 }).catch(() => console.log(`[${name}] timeout waiting for chunks`));
  // a grass platform in the sky (the world generator has no fixed showcase)
  await page.evaluate(() => {
    const g = (window as any).game;
    for (let x = 12; x <= 37; x++) for (let z = -6; z <= 9; z++) g.send({ t: 'chat', message: `/setblock ${x} 199 ${z} grass_block` });
  });
  await page.waitForFunction(() => {
    const g = (window as any).game;
    const s = g.chunks.stats();
    return g.world.getState(37, 199, 9) !== 0 && s.pending === 0 && s.building === 0;
  }, undefined, { timeout: 30000 }).catch(() => console.log(`[${name}] platform timeout`));
  // put the camera back (the player may have fallen before the platform existed)
  const q = new URLSearchParams(shot.cam);
  await page.evaluate(([x, y, z]) => {
    const g = (window as any).game;
    g.send({ t: 'chat', message: `/tp ${x} ${y} ${z}` });
    g.player.abilities.flying = true;
  }, [q.get('x'), q.get('y'), q.get('z')]);
  await page.waitForTimeout(300);
  await spawn(page, shot.mobs);
  await page.waitForTimeout(shot.wait ?? 500);
  console.log(name, await page.evaluate(() => { const g = (window as any).game; return [g.loggedIn, g.player.x, g.player.y, g.player.z, g.mobs.mobs.size, g.world.getState(37, 199, 9)]; }));
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`saved ${name}.png`);
  await page.close();
}
await browser.close();
