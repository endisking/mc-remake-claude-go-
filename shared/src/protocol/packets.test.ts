import { describe, it, expect } from 'vitest';
import { encodeS2C, decodeS2C, encodeC2S, decodeC2S, encodeStacks, decodeStacks } from './packets';
import { blockEntityKey } from '../world/chunk';
import { DevGenerator } from '../worldgen/devgen';
import { BlockWorld } from '../world/world';
import { LightEngine } from '../world/light';

describe('protocol', () => {
  it('round-trips a lit chunk', () => {
    const gen = new DevGenerator(42n);
    const world = new BlockWorld();
    const c = gen.generate(0, 0);
    world.addChunk(c);
    new LightEngine(world).lightChunk(c);
    const buf = encodeS2C({ t: 'chunk', chunk: c });
    const p = decodeS2C(buf);
    if (p.t !== 'chunk') throw new Error('wrong packet');
    for (let y = 0; y < 256; y += 3)
      for (let x = 0; x < 16; x += 5)
        for (let z = 0; z < 16; z += 2) {
          expect(p.chunk.getState(x, y, z)).toBe(c.getState(x, y, z));
          expect(p.chunk.getLight(x, y, z)).toBe(c.getLight(x, y, z));
        }
    expect(buf.byteLength).toBeLessThan(120000);
  });
  it('round-trips block entities with the chunk and window item lists', () => {
    const c = new DevGenerator(42n).generate(0, 0);
    c.blockEntities.set(blockEntityKey(3, 70, 9), { id: 'chest', items: [{ id: 5, count: 12, damage: 0 }, null] });
    const p = decodeS2C(encodeS2C({ t: 'chunk', chunk: c }));
    if (p.t !== 'chunk') throw new Error('wrong packet');
    expect(p.chunk.blockEntities.get(blockEntityKey(3, 70, 9))).toEqual({ id: 'chest', items: [{ id: 5, count: 12, damage: 0 }, null] });
    const list = [{ id: 7, count: 64, damage: 0 }, null, { id: 800, count: 1, damage: 31 }];
    const w = decodeS2C(encodeS2C({ t: 'windowItems', windowId: 3, items: encodeStacks(list) }));
    if (w.t !== 'windowItems') throw new Error('wrong packet');
    expect(decodeStacks(w.items)).toEqual(list);
  });
  it('round-trips small packets', () => {
    const m = decodeC2S(encodeC2S({ t: 'move', x: 1.5, y: 70, z: -3.25, yaw: 90, pitch: -10, onGround: true }));
    expect(m).toEqual({ t: 'move', x: 1.5, y: 70, z: -3.25, yaw: 90, pitch: -10, onGround: true });
    const l = decodeS2C(encodeS2C({ t: 'login', entityId: 7, gameMode: 1, dimension: 'overworld', seed: -5n, x: 0, y: 64, z: 0, yaw: 0, pitch: 0, simulationDistance: 10 }));
    expect(l).toMatchObject({ t: 'login', seed: -5n, dimension: 'overworld' });
  });
});
