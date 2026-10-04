/**
 * Integrated-server chunk streaming with real 1.17 terrain: time until the spawn area (25
 * chunks) is sent, then tick times (mean / max) while a player flies at sprint-flying speed
 * over fresh terrain. Usage: pnpm tsx --tsconfig server/tsconfig.json tools/bench/servertick.ts [viewDistance] [genTimeMs|inf]
 */
import { GameServer, type Connection } from '../../server/src/game/server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION } from '@shared/protocol/packets';

const vd = Number(process.argv[2] ?? 6);
const budgetArg = process.argv[3];
const server = new GameServer({ seed: 20211n, randomSeed: 1n, chunkGenTimeMs: budgetArg === 'inf' ? Infinity : budgetArg ? Number(budgetArg) : undefined });
let chunks = 0;
const conn: Connection = { send: (d) => { if (decodeS2C(d).t === 'chunk') chunks++; }, close: () => {} };
const recv = server.connect(conn, true);
recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'P', viewDistance: vd, skin: '' }));
recv(encodeC2S({ t: 'settings', viewDistance: vd, simulationDistance: vd }));
const p = server.players[0]!;
// per-phase maxima (ms) to find what spikes a tick
const phaseMax: Record<string, number> = {};
const wrap = (obj: any, name: string, label = name) => {
  const f = obj[name].bind(obj);
  obj[name] = (...a: unknown[]) => {
    const s = performance.now();
    const r = f(...a);
    const d = performance.now() - s;
    if (d > (phaseMax[label] ?? 0)) phaseMax[label] = d;
    return r;
  };
};
const sv = server as any;
for (const m of ['updateChunks', 'tickEntities', 'flushLight', 'updateTracking', 'trackEntities', 'prepareChunk', 'storeChunk']) wrap(sv, m);
wrap(sv.fluids, 'tick', 'fluids');
wrap(sv.generator, 'generate');
wrap(sv.generator, 'decorate');
wrap(sv.light, 'lightChunk');
const t0 = performance.now();
let ticks = 0;
while (chunks < 25 && ticks < 2000) {
  server.tick();
  ticks++;
}
const spawnMs = performance.now() - t0;
// fly east at 10.9 m/s (creative sprint-flying) for 15 s of game time
const times: number[] = [];
for (let i = 0; i < 300; i++) {
  p.x += 10.9 / 20;
  const s = performance.now();
  server.tick();
  times.push(performance.now() - s);
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(JSON.stringify({ vd, budget: budgetArg ?? 'default', spawnMs: Math.round(spawnMs), spawnTicks: ticks, flyMeanTickMs: +mean.toFixed(1), flyP95TickMs: +times[Math.floor(times.length * 0.95)]!.toFixed(1), flyMaxTickMs: +times[times.length - 1]!.toFixed(1), chunksSent: chunks, ticksOver50: times.filter((t) => t > 50).length }));
console.log('phase max ms', JSON.stringify(Object.fromEntries(Object.entries(phaseMax).map(([k, v]) => [k, +v.toFixed(1)]))));
