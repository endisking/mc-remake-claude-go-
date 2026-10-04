import { describe, it, expect, vi } from 'vitest';
import { GameServer, type Connection } from './server';
import { encodeC2S, decodeS2C, PROTOCOL_VERSION, type S2C } from '@shared/protocol/packets';
import { blockNameOf } from '@shared/world/blockstate';

function client(server: GameServer, name: string) {
  const received: S2C[] = [];
  const conn: Connection = { send: (d) => received.push(decodeS2C(d)), close: () => {} };
  const recv = server.connect(conn);
  recv(encodeC2S({ t: 'hello', protocol: PROTOCOL_VERSION, name, viewDistance: 2, skin: '' }));
  return { received, recv, send: (p: Parameters<typeof encodeC2S>[0]) => recv(encodeC2S(p)), conn };
}

describe('server robustness (release)', () => {
  it('a malformed packet is logged, not thrown, and the player keeps playing', () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    const a = client(server, 'A');
    server.tick();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => a.recv(new Uint8Array([250, 1, 2, 3]).buffer)).not.toThrow();
    err.mockRestore();
    a.send({ t: 'chat', message: 'still here' });
    expect(a.received.some((p) => p.t === 'chat' && JSON.stringify(p).includes('still here'))).toBe(true);
  });

  it('the tick loop keeps running after a tick throws', async () => {
    const server = new GameServer({ seed: 7n, chunkGenBudget: 100, devTerrain: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const orig = server.sleep.tick.bind(server.sleep);
    let thrown = 0;
    server.sleep.tick = () => {
      if (thrown++ === 0) throw new Error('boom');
      orig();
    };
    server.start();
    await new Promise((r) => setTimeout(r, 400));
    server.stop();
    err.mockRestore();
    expect(thrown).toBeGreaterThan(2);
  });

  it('a new 1.17 world spawns players on grass, not in water', () => {
    const server = new GameServer({ seed: 12345n });
    const [x, y, z] = server.spawnPosition();
    const below = blockNameOf(server.world.getState(Math.floor(x), y - 1, Math.floor(z)));
    expect(['grass_block', 'podzol']).toContain(below);
    expect(blockNameOf(server.world.getState(Math.floor(x), y, Math.floor(z)))).not.toBe('water');
  }, 120000);
});
