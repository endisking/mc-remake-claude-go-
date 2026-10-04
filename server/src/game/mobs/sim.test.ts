import { it } from 'vitest';
import { GameServer, type Connection } from '../server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { Mob } from './mob';

it('sim', { timeout: 600000 }, async () => {
  const server = new GameServer({ seed: 12345n, chunkGenBudget: 400, defaultGameMode: 0, randomSeed: 1n });
  const conn: Connection = { send: (d) => void decodeS2C(d), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'A', viewDistance: 6, skin: '' }));
  server.doDaylightCycle = false;
  server.dayTime = 18000;
  let t0 = performance.now();
  for (let i = 0; i < 40; i++) server.tick();
  console.log('gen ms', performance.now() - t0, 'chunks', server.world.chunks.size, 'mobs', server.mobs.mobs().length);
  const { Session } = await import('node:inspector');
  const sess = new Session(); sess.connect();
  const post = (m: string, p?: any) => new Promise<any>((res, rej) => sess.post(m, p, (e: any, r: any) => e ? rej(e) : res(r)));
  await post('Profiler.enable'); await post('Profiler.start');
  t0 = performance.now();
  let worst = 0;
  for (let i = 0; i < 600; i++) {
    const a = performance.now();
    server.tick();
    worst = Math.max(worst, performance.now() - a);
  }
  const { profile } = await post('Profiler.stop');
  const self = new Map<string, number>();
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
  profile.samples.forEach((id: number, i: number) => { const n: any = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
  console.log('PROF', [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => k + ' ' + (v / 1000).toFixed(0)).join('\nPROF '));
  const mobs = server.mobs.mobs();
  const by = new Map<string, number>();
  for (const m of mobs) by.set(m.type, (by.get(m.type) ?? 0) + 1);
  console.log('600 ticks ms/tick', (performance.now() - t0) / 600, 'worst', worst, 'mobs', mobs.length, JSON.stringify([...by]));
  const p = server.players[0]!;
  console.log('player', p.x, p.y, p.z, 'health', p.living.health, 'dead', p.living.dead);
  const mons = mobs.filter((m) => m.category === 'monster');
  console.log('targets', mons.filter((m) => m.target).length, 'dists', mons.map((m) => Math.round(Math.hypot(m.x - p.x, m.z - p.z)) + (m.target ? '*' : '') + '/' + Math.round(m.y)).join(' '));
  void Mob;
});
