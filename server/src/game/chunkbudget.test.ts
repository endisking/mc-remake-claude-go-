import { describe, it, expect } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';

function join(server: GameServer, viewDistance: number) {
  const chunks: [number, number][] = [];
  let login: S2C | null = null;
  const conn: Connection = {
    send: (d) => {
      const p = decodeS2C(d);
      if (p.t === 'chunk') chunks.push([p.chunk.x, p.chunk.z]);
      if (p.t === 'login') login = p;
    },
    close: () => {},
  };
  const recv = server.connect(conn, true);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'P', viewDistance, skin: '' }));
  return { chunks, login: () => login as Extract<S2C, { t: 'login' }> | null };
}

describe('time-budgeted chunk generation', () => {
  it('streams nearest chunks first, spread over ticks, until the view area is complete', () => {
    // a tiny budget forces generation to be spread over many ticks
    const server = new GameServer({ seed: 7n, devTerrain: true, chunkGenTimeMs: 0.001 });
    const c = join(server, 2);
    server.tick();
    const firstTick = c.chunks.length;
    for (let i = 0; i < 400 && c.chunks.length < 49; i++) server.tick();
    expect(c.chunks.length).toBe(49); // view distance 2 + 1 ring
    expect(firstTick).toBeLessThan(49);
    const l = c.login()!;
    const pcx = Math.floor(l.x) >> 4, pcz = Math.floor(l.z) >> 4;
    const d = c.chunks.map(([x, z]) => (x - pcx) ** 2 + (z - pcz) ** 2);
    expect(d[0]).toBe(0);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThanOrEqual(d[i - 1]!);
  });

  it('an uploaded skin (PNG data URL) is kept; other long strings are cut to a skin name', () => {
    const server = new GameServer({ seed: 7n, devTerrain: true, chunkGenBudget: 100 });
    const url = 'data:image/png;base64,' + 'A'.repeat(4000);
    const conn: Connection = { send: () => {}, close: () => {} };
    server.connect(conn)(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'S', viewDistance: 2, skin: url }));
    expect(server.players[0]!.skin).toBe(url);
    server.connect({ send: () => {}, close: () => {} })(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'T', viewDistance: 2, skin: 'x'.repeat(200) }));
    expect(server.players[1]!.skin.length).toBe(64);
  });
});
