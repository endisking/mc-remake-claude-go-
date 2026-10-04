/**
 * Mob visual check: spawns client-side mobs in the models showcase scene (no server mob
 * system needed) and saves screenshots to tools/bench/out/mobs/.
 * Usage: pnpm tsx tools/mobshots.ts [baseUrl] [filter]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ITEMS_BY_NAME } from '../shared/src/data/index';

const base = process.argv[2] ?? 'http://localhost:5173/';
const filter = process.argv[3] ?? '';
const out = new URL('./bench/out/mobs/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

interface MobSpec { type: string; x: number; z: number; yaw?: number; data?: Record<string, number>; walk?: boolean; flags?: number; hurt?: boolean; die?: number; name?: string; hold?: number }
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
  dying: { cam: NEAR, mobs: row(['zombie', 'cow', 'spider', 'creeper'], { yaw: 150, die: 9 }), wait: 50 },
  close: { cam: 'x=24.2&y=200&z=1.8&lookat=24.2,200.8,4.5&fov=65', mobs: row(['pig', 'creeper', 'zombie']) },
  close2: { cam: 'x=24.2&y=200&z=1.8&lookat=24.2,200.8,4.5&fov=65', mobs: row(['cow', 'skeleton', 'sheep']) },
  names: { cam: NEAR, mobs: row(['pig', 'zombie', 'sheep', 'creeper'], { name: 'Sir Oinks', data: { name_visible: 1 } }) },
  e_front: { cam: NEAR, mobs: row(['villager', 'witch', 'zombie_villager', 'wandering_trader']) },
  e_side: { cam: NEAR, mobs: row(['villager', 'witch', 'zombie_villager', 'wandering_trader'], { yaw: 120, walk: true }), wait: 1100 },
  f_front: { cam: NEAR, mobs: row(['creeper', 'glow_squid', 'wolf', 'villager']).map((m, i) => ({ ...m, data: ([{ charged: 1 }, {}, {}, { baby: 1 }] as Record<string, number>[])[i] })) },
  g_front: { cam: FAR, mobs: row(['iron_golem', 'wolf', 'wolf', 'phantom', 'pillager', 'vindicator', 'evoker', 'mooshroom'], { yaw: 160 }).map((m, i) => ({ ...m, data: ([{}, {}, { sitting: 1, tame: 1 }, {}, {}, { aggressive: 1 }, {}, {}] as Record<string, number>[])[i] })) },
  g_walk: { cam: FAR, mobs: row(['iron_golem', 'wolf', 'pillager', 'vindicator', 'mooshroom', 'phantom', 'wolf', 'evoker'], { yaw: 110, walk: true }).map((m, i) => ({ ...m, data: ([{}, {}, { aggressive: 1 }, {}, {}, {}, { baby: 1 }, { aggressive: 1 }] as Record<string, number>[])[i] })), wait: 1100 },
  held: { cam: NEAR, mobs: row(['zombie', 'skeleton', 'zombie', 'husk']).map((m, i) => ({ ...m, yaw: 150, hold: [ITEMS_BY_NAME.get('torch')!.id, 0, ITEMS_BY_NAME.get('oak_planks')!.id, ITEMS_BY_NAME.get('glass')!.id][i] })) },
  heldclose: { cam: 'x=24.2&y=200&z=1.8&lookat=24.2,200.8,4.5&fov=65', mobs: [{ type: 'zombie', x: 24.2, z: 4.5, yaw: 180, hold: ITEMS_BY_NAME.get('oak_planks')!.id }] },
  heldtop: { cam: 'x=26.2&y=201.5&z=4.5&lookat=24.2,201,4.5&fov=65', mobs: [{ type: 'zombie', x: 24.2, z: 4.5, yaw: 180, hold: ITEMS_BY_NAME.get('oak_planks')!.id }] },
  fish: { cam: 'x=24.2&y=200&z=2.5&lookat=24.2,200.2,4.5&fov=60', mobs: row(['cod', 'salmon', 'cod', 'salmon'], { yaw: 120 }) },
  h_front: { cam: FAR, mobs: row(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'cat', 'ocelot', 'cat'], { yaw: 120 }).map((m, i) => (i === 7 ? { ...m, data: { sitting: 1 } } : m)) },
  h_walk: { cam: FAR, mobs: row(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'cat', 'ocelot', 'horse'], { yaw: 120, walk: true }).map((m, i) => (i === 7 ? { ...m, data: { baby: 1 } } : m)), wait: 1100 },
  i_front: { cam: NEAR, mobs: row(['polar_bear', 'snow_golem', 'silverfish', 'bee', 'endermite'], { yaw: 140 }) },
  i_walk: { cam: NEAR, mobs: row(['polar_bear', 'snow_golem', 'silverfish', 'bee', 'endermite'], { yaw: 120, walk: true }), wait: 1100 },
  third: { cam: 'x=24.2&y=200&z=1.5&yaw=0&pitch=45&camera=1&fov=60', mobs: row(['pig', 'sheep'], { yaw: 180 }) },
  j_front: { cam: NEAR, mobs: row(['rabbit', 'llama', 'trader_llama', 'turtle'], { yaw: 140 }) },
  j_walk: { cam: NEAR, mobs: row(['rabbit', 'llama', 'trader_llama', 'turtle'], { yaw: 110, walk: true }), wait: 1100 },
  rabbit: { cam: 'x=24.2&y=200&z=2.5&lookat=24.2,200.2,4.5&fov=60', mobs: row(['rabbit', 'rabbit', 'rabbit'], { yaw: 120 }).map((m, i) => (i === 1 ? { ...m, data: { baby: 1 } } : i === 2 ? { ...m, walk: true } : m)), wait: 900 },
  k_front: { cam: NEAR, mobs: row(['fox', 'fox', 'fox'], { yaw: 140 }).map((m, i) => (i === 1 ? { ...m, walk: true, yaw: 110 } : i === 2 ? { ...m, data: { baby: 1 } } : m)), wait: 900 },
  chick: { cam: 'x=24.2&y=200&z=3&lookat=24.2,200.3,4.5&fov=60', mobs: [{ type: 'chicken', x: 24.2, z: 4.5, yaw: 180 }] },
  nether: { cam: FAR, mobs: row(['blaze', 'magma_cube', 'piglin', 'zombified_piglin', 'piglin_brute', 'blaze'], { yaw: 160 }).map((m, i) => (i === 1 ? { ...m, data: { size: 2 } } : i === 5 ? { ...m, walk: true, yaw: 110 } : m)), wait: 900 },
  ghast: { cam: 'x=24.2&y=200&z=-8&lookat=24.2,203,4.5&fov=70', mobs: [{ type: 'ghast', x: 20.5, z: 4.5, yaw: 180 }, { type: 'ghast', x: 28.5, z: 4.5, yaw: 180, data: { aggressive: 1 } }] },
  l_front: { cam: NEAR, mobs: row(['illusioner', 'vex', 'vex', 'evoker'], { yaw: 150 }).map((m, i) => (i === 2 ? { ...m, data: { aggressive: 1 } } : m)) },
  parrot: { cam: 'x=24.2&y=200&z=2.5&lookat=24.2,200.3,4.5&fov=60', mobs: row(['parrot', 'parrot', 'parrot'], { yaw: 140 }).map((m, i) => (i === 1 ? { ...m, yaw: 90 } : m)) },
  night: { cam: NEAR + '&time=18000', mobs: row(['spider', 'enderman', 'zombie', 'cave_spider']) },
};

/** Spawns mobs through the client's packet handler (the same path server packets take). */
async function spawn(page: Page, mobs: MobSpec[]): Promise<void> {
  await page.evaluate(({ mobs, Y }) => {
    const g = (window as any).game;
    const h = (p: Record<string, unknown>) => g.handle(p);
    let id = 900000;
    for (const s of mobs) {
      const eid = id++;
      const yaw = s.yaw ?? 0;
      h({ t: 'addEntity', id: eid, type: s.type, x: s.x, y: Y, z: s.z, vx: 0, vy: 0, vz: 0, data: 0 });
      const m = g.mobs.get(eid);
      m.setPos(s.x, Y, s.z, yaw, 0, yaw);
      h({ t: 'entityMove', id: eid, x: s.x, y: Y, z: s.z, yaw, pitch: 0, headYaw: yaw, onGround: true });
      for (const [key, value] of Object.entries(s.data ?? {})) h({ t: 'mobData', id: eid, key, value });
      if (s.name) h({ t: 'mobName', id: eid, name: s.name });
      if (s.hold) h({ t: 'equipment', id: eid, mainHand: s.hold, offHand: 0 });
      if (s.flags) h({ t: 'entityState', id: eid, flags: s.flags, pose: 'standing', frozen: 0 });
      if (s.hurt) {
        h({ t: 'entityEvent', id: eid, event: 2 });
        setInterval(() => h({ t: 'entityEvent', id: eid, event: 2 }), 400);
      }
      if (s.die) {
        h({ t: 'entityEvent', id: eid, event: 2 });
        h({ t: 'entityEvent', id: eid, event: 3 });
        m.deathTime = s.die;
      }
      if (s.walk) {
        // walk back and forth through the spot at 0.1 blocks/tick so the limbs swing
        let t = 0;
        const r = (yaw * Math.PI) / 180;
        setInterval(() => {
          t++;
          const d = ((t % 30) - 15) * 0.1;
          if (t % 30 === 0) m.setPos(s.x + Math.sin(r) * 1.5, Y, s.z - Math.cos(r) * 1.5, yaw, 0, yaw);
          h({ t: 'entityMove', id: eid, x: s.x - Math.sin(r) * d, y: Y, z: s.z + Math.cos(r) * d, yaw, pitch: 0, headYaw: yaw, onGround: true });
        }, 50);
      }
    }
  }, { mobs, Y: 200 });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, shot] of Object.entries(SHOTS)) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  // tsx (esbuild keepNames) wraps named functions in __name inside evaluated code
  await page.addInitScript('window.__name = (f) => f;');
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
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => (window as any).game.player.y);
    if (Math.abs(y - Number(q.get('y'))) < 0.6) break;
    await page.evaluate(([x, y, z]) => {
      const g = (window as any).game;
      g.send({ t: 'chat', message: `/tp ${x} ${y} ${z}` });
      g.player.abilities.flying = true;
    }, [q.get('x'), q.get('y'), q.get('z')]);
  }
  await spawn(page, shot.mobs);
  await page.waitForTimeout(shot.wait ?? 500);
  console.log(name, await page.evaluate(() => { const g = (window as any).game; return [g.loggedIn, g.player.x, g.player.y, g.player.z, g.mobs.mobs.size, g.world.getState(37, 199, 9)]; }));
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`saved ${name}.png`);
  await page.close();
}
await browser.close();
