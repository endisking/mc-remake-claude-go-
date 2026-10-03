import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Mesher, padIndex, PADDED_VOLUME, type MeshInput } from './mesher';
import { bakeBlockModels, type TextureManifest } from './blockmodels';
import { stateOf } from '@shared/world/blockstate';
import { DevGenerator } from '@shared/worldgen/devgen';
import { BlockWorld } from '@shared/world/world';
import { LightEngine } from '@shared/world/light';

const manifest = JSON.parse(readFileSync(new URL('../../public/textures/blocks.json', import.meta.url), 'utf8')) as TextureManifest;
const { bake, fluids } = bakeBlockModels(manifest, true);
const mesher = new Mesher(bake, fluids, { smoothLighting: true, fancy: true });

function emptyInput(): MeshInput {
  return { sx: 0, sy: 0, sz: 0, states: new Uint16Array(PADDED_VOLUME), light: new Uint8Array(PADDED_VOLUME).fill(0xf0), tints: new Uint32Array(768).fill(0x7fbf5f) };
}
const quads = (a: Uint32Array) => a.length / 12;

describe('mesher', () => {
  it('meshes a lone cube with 6 faces and culls shared faces', () => {
    const inp = emptyInput();
    const stone = stateOf('stone');
    inp.states[padIndex(5, 5, 5)] = stone;
    expect(quads(mesher.mesh(inp).passes[0])).toBe(6);
    inp.states[padIndex(6, 5, 5)] = stone;
    expect(quads(mesher.mesh(inp).passes[0])).toBe(10);
  });

  it('culls against neighbours in the border', () => {
    const inp = emptyInput();
    const stone = stateOf('stone');
    inp.states[padIndex(0, 0, 0)] = stone;
    inp.states[padIndex(-1, 0, 0)] = stone;
    inp.states[padIndex(0, -1, 0)] = stone;
    expect(quads(mesher.mesh(inp).passes[0])).toBe(4);
  });

  it('puts grass side overlays in the cutout pass and glass faces between glass are hidden', () => {
    const inp = emptyInput();
    inp.states[padIndex(2, 2, 2)] = stateOf('grass_block', { snowy: false });
    const out = mesher.mesh(inp);
    expect(quads(out.passes[0])).toBe(6);
    expect(quads(out.passes[1])).toBe(4);
    const g = emptyInput();
    g.states[padIndex(2, 2, 2)] = stateOf('glass');
    g.states[padIndex(3, 2, 2)] = stateOf('glass');
    expect(quads(mesher.mesh(g).passes[1])).toBe(10);
  });

  it('emits water surfaces into the translucent pass with centres for sorting', () => {
    const inp = emptyInput();
    inp.states[padIndex(4, 4, 4)] = stateOf('water');
    inp.states[padIndex(4, 3, 4)] = stateOf('stone');
    const out = mesher.mesh(inp);
    expect(quads(out.passes[2])).toBeGreaterThanOrEqual(2);
    expect(out.centers.length).toBe(quads(out.passes[2]) * 3);
  });

  it('applies ambient occlusion in corners', () => {
    const inp = emptyInput();
    const stone = stateOf('stone');
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) inp.states[padIndex(x, 0, z)] = stone;
    inp.states[padIndex(0, 1, 1)] = stone; // wall next to the centre's top face
    const out = mesher.mesh(inp).passes[0];
    let maxAo = 0;
    for (let i = 0; i < out.length; i += 3) maxAo = Math.max(maxAo, out[i]! >>> 30);
    expect(maxAo).toBeGreaterThan(0);
  });

  it('meshes generated terrain quickly', () => {
    const gen = new DevGenerator(1n);
    const world = new BlockWorld();
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(gen.generate(cx, cz));
    const le = new LightEngine(world);
    for (const c of world.chunks.values()) le.lightChunk(c);
    const inp = emptyInput();
    const sy = 4;
    for (let y = -1; y <= 16; y++) for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
      inp.states[padIndex(x, y, z)] = world.getState(x, sy * 16 + y, z);
      inp.light[padIndex(x, y, z)] = world.getLight(x, sy * 16 + y, z);
    }
    inp.sy = sy;
    const t0 = performance.now();
    let out;
    for (let i = 0; i < 10; i++) out = mesher.mesh(inp);
    const ms = (performance.now() - t0) / 10;
    expect(quads(out!.passes[0])).toBeGreaterThan(100);
    console.log(`terrain section: ${quads(out!.passes[0])} solid quads, ${quads(out!.passes[1])} cutout, ${quads(out!.passes[2])} translucent, ${ms.toFixed(2)} ms`);
  });
});
