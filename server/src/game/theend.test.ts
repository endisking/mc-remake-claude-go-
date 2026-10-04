import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { stateOf, blockNameOf } from '@shared/world/blockstate';
import { JavaRandom } from '@shared/util/random';
import { findPortalFrame, EyeOfEnder } from './theend';

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn, true);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

/** The 12 frames of a ring whose 3×3 interior starts at (x, z); facing toward the centre unless `outward`. */
function ring(x: number, z: number, outward = false): [number, number, string][] {
  const f = (inward: string, out: string) => (outward ? out : inward);
  const out: [number, number, string][] = [];
  for (let i = 0; i < 3; i++) {
    out.push([x + i, z - 1, f('south', 'north')]);
    out.push([x + i, z + 3, f('north', 'south')]);
    out.push([x - 1, z + i, f('east', 'west')]);
    out.push([x + 3, z + i, f('west', 'east')]);
  }
  return out;
}

describe('end portal frame pattern', () => {
  it('matches a ring of 12 eyed frames facing inward, from any of its frames', () => {
    const m = new Map<string, number>();
    for (const [x, z, facing] of ring(10, 20)) m.set(`${x},64,${z}`, stateOf('end_portal_frame', { facing, eye: true }));
    const get = (x: number, y: number, z: number) => m.get(`${x},${y},${z}`) ?? 0;
    for (const [x, z] of ring(10, 20)) {
      const o = findPortalFrame(get, x, 64, z);
      expect(o).not.toBeNull();
      // front-top-left corner offset (-3, 0, -3) is the interior's min corner
      expect([o![0] - 3, o![1], o![2] - 3]).toEqual([10, 64, 20]);
    }
    // one missing eye: no match
    m.set('11,64,19', stateOf('end_portal_frame', { facing: 'south', eye: false }));
    expect(findPortalFrame(get, 11, 64, 19)).toBeNull();
  });

  it('does not match frames facing outward', () => {
    const m = new Map<string, number>();
    for (const [x, z, facing] of ring(0, 0, true)) m.set(`${x},64,${z}`, stateOf('end_portal_frame', { facing, eye: true }));
    const get = (x: number, y: number, z: number) => m.get(`${x},${y},${z}`) ?? 0;
    for (const [x, z] of ring(0, 0, true)) expect(findPortalFrame(get, x, 64, z)).toBeNull();
  });
});

describe('the End on the server', () => {
  it('placing the last eye lights the portal; entering it builds the platform; the exit portal returns home with the credits once', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true });
    const a = client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    p.gameMode = 0;
    const bx = Math.floor(p.x) + 4, by = Math.floor(p.y) + 1, bz = Math.floor(p.z) + 4;
    const frames = ring(bx, bz);
    frames.forEach(([x, z, facing], i) => server.setBlock(x, by, z, stateOf('end_portal_frame', { facing, eye: i !== 5 })));
    a.send({ t: 'chat', message: '/give @s ender_eye 2' });
    const [lx, lz] = frames[5]!;
    p.x = lx + 0.5;
    p.z = lz + 2.5;
    a.send({ t: 'useOn', x: lx, y: by, z: lz, face: 1, cx: 0.5, cy: 1, cz: 0.5, hand: 0 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(blockNameOf(server.world.getState(bx + i, by, bz + j))).toBe('end_portal');
    expect(p.inventory.selectedStack?.count).toBe(1);

    // step into the portal (shape y 6/16–12/16)
    p.x = bx + 1.5;
    p.y = by + 0.5;
    p.z = bz + 1.5;
    server.tick();
    expect(p.dimension).toBe('the_end');
    expect([p.x, p.y, p.z]).toEqual([100.5, 50, 0.5]);
    const dim = a.received.filter((m) => m.t === 'dimension').pop() as Extract<S2C, { t: 'dimension' }>;
    expect(dim.dimension).toBe('the_end');
    const end = server.levels.get('the_end')!;
    for (let x = 98; x <= 102; x++)
      for (let z = -2; z <= 2; z++) {
        expect(blockNameOf(end.world.getState(x, 49, z))).toBe('obsidian');
        for (let y = 50; y <= 52; y++) expect(end.world.getState(x, y, z)).toBe(0);
      }
    // the exit fountain at 0, 0 (lit: there is no dragon to defeat yet)
    let top = -1;
    for (let y = 0; y < 128; y++) if (blockNameOf(end.world.getState(0, y, 0)) === 'bedrock') top = y;
    expect(top).toBeGreaterThan(0);
    const portalY = top - 3;
    expect(blockNameOf(end.world.getState(2, portalY, 0))).toBe('end_portal');

    // walk into the exit portal: back to the overworld spawn, credits shown
    p.x = 2.5;
    p.y = portalY + 0.5;
    p.z = 0.5;
    server.tick();
    expect(p.dimension).toBe('overworld');
    const win = a.received.filter((m) => m.t === 'winGame') as Extract<S2C, { t: 'winGame' }>[];
    expect(win.length).toBe(1);
    expect(win[0]!.showCredits).toBe(true);
    expect(p.seenCredits).toBe(true);

    // second trip: no credits
    p.x = bx + 1.5;
    p.y = by + 0.5;
    p.z = bz + 1.5;
    server.tick();
    expect(p.dimension).toBe('the_end');
    p.x = 2.5;
    p.y = portalY + 0.5;
    p.z = 0.5;
    server.tick();
    expect(p.dimension).toBe('overworld');
    const wins = a.received.filter((m) => m.t === 'winGame') as Extract<S2C, { t: 'winGame' }>[];
    expect(wins.length).toBe(2);
    expect(wins[1]!.showCredits).toBe(false);
  });
});

describe('items through end portals', () => {
  it('an item in an end portal lands on the 5×5 obsidian platform at y 48 in the End', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 200, devTerrain: true });
    client(server, 'A');
    for (let i = 0; i < 3; i++) server.tick();
    const p = server.players[0]!;
    const x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 3, z = Math.floor(p.z);
    server.setBlock(x, y, z, stateOf('end_portal'));
    server.spawnItem(x + 0.5, y + 0.5, z + 0.5, { id: 1, count: 1, damage: 0 }, 0, 0, 0);
    server.tick();
    const end = server.levels.get('the_end')!;
    const items = [...end.entities.values()];
    expect(items.length).toBe(1);
    expect([items[0]!.x, items[0]!.z]).toEqual([100.5, 0.5]);
    for (let bx = 98; bx <= 102; bx++) for (let bz = -2; bz <= 2; bz++) expect(blockNameOf(end.world.getState(bx, 48, bz))).toBe('obsidian');
  });
});

describe('eye of ender', () => {
  it('heads 12 blocks toward a far target, rising, then dies after 80 ticks', () => {
    const e = new EyeOfEnder(1, 0);
    e.x = 0.5;
    e.y = 70;
    e.z = 0.5;
    e.signalTo(1000, 32, 0, new JavaRandom(1n));
    expect(e.tx).toBeCloseTo(12.5, 4);
    expect(e.ty).toBe(78);
    let died = 0;
    e.onDeath = () => died++;
    for (let i = 0; i < 80; i++) e.tick(null as never);
    expect(died).toBe(0);
    expect(e.x).toBeGreaterThan(0.5);
    expect(e.y).toBeGreaterThan(70);
    e.tick(null as never);
    expect(died).toBe(1);
    expect(e.removed).toBe(true);
  });

  it('survives (drops) 4 times in 5', () => {
    const r = new JavaRandom(99n);
    let survive = 0;
    for (let i = 0; i < 5000; i++) {
      const e = new EyeOfEnder(1, 0);
      e.signalTo(5, 32, 5, r);
      if (e.surviveAfterDeath) survive++;
    }
    expect(survive / 5000).toBeGreaterThan(0.77);
    expect(survive / 5000).toBeLessThan(0.83);
  });
});
