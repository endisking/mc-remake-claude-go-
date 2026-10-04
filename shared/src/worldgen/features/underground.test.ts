import { describe, it, expect } from 'vitest';
import { JavaRandom } from '../../util/random';
import { OverworldGenerator } from '../overworld/generator';
import { BlockWorld } from '../../world/world';
import { Chunk } from '../../world/chunk';
import { blockNameOf, stateOf, getProp } from '../../world/blockstate';
import { WORLDGEN } from './data';
import { GenLevel } from './level';
import { fastInvSqrt, geode, monsterRoom, glowLichen, smallDripstone, dripstoneCluster, largeDripstone, replaceSingleBlock, fossil, fossilTemplate, takeGenBlockEntities, getDripstoneHeight } from './underground';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The innermost config of a decorated configured feature. */
function innerConfig(id: string): J {
  let j = WORLDGEN.configured_features[id];
  while (j.type === 'minecraft:decorated') j = typeof j.config.feature === 'string' ? WORLDGEN.configured_features[j.config.feature.replace('minecraft:', '')] : j.config.feature;
  return j.config;
}

const STONE = stateOf('stone');
const gen = new OverworldGenerator(20211n);
/** A 3×3-chunk world of solid stone (y 0–127) around chunk (0, 0), optional cave carved by `carve`. */
function stoneWorld(carve?: (set: (x: number, y: number, z: number, s: number) => void) => void): { world: BlockWorld; lv: GenLevel } {
  const world = new BlockWorld();
  for (let cz = -1; cz <= 1; cz++)
    for (let cx = -1; cx <= 1; cx++) {
      const c = new Chunk(cx, cz);
      for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.setState(x, y, z, STONE);
      world.addChunk(c);
    }
  carve?.((x, y, z, s) => world.setStateRaw(x, y, z, s));
  return { world, lv: new GenLevel(world, gen, 0, 0) };
}
function count(world: BlockWorld, name: string, r = 24): number {
  let n = 0;
  for (let x = -r; x < r; x++) for (let z = -r; z < r; z++) for (let y = 0; y < 256; y++) if (blockNameOf(world.getState(x, y, z)) === name) n++;
  return n;
}

describe('underground feature helpers', () => {
  it('Mth.fastInvSqrt matches the JVM bit for bit', () => {
    // values printed by the same code on a real JVM
    const java = [0.9983081427118145, 0.7069296507954639, 0.5344285060725907, 0.3118009224772889, 0.09984476108311885, 31.58509094193678, 0.16251851184782198];
    [1, 2, 3.5, 10.25, 100, 0.001, 37.75].forEach((d, i) => expect(fastInvSqrt(d)).toBe(java[i]));
  });

  it('dripstone height falls off from the centre to the rim', () => {
    expect(getDripstoneHeight(0, 8, 1, 0.5)).toBeGreaterThan(getDripstoneHeight(6, 8, 1, 0.5));
    expect(Math.trunc(getDripstoneHeight(8, 8, 1, 0.5))).toBe(0);
  });
});

describe('amethyst geode', () => {
  it('builds smooth basalt, calcite and amethyst layers around a hollow with budding amethyst', () => {
    const { world, lv } = stoneWorld();
    const place = geode(innerConfig('amethyst_geode'));
    let placed = false;
    for (let seed = 1; seed < 20 && !placed; seed++) placed = place(lv, new JavaRandom(seed), 8, 60, 8);
    expect(placed).toBe(true);
    expect(count(world, 'smooth_basalt')).toBeGreaterThan(100);
    expect(count(world, 'calcite')).toBeGreaterThan(100);
    expect(count(world, 'amethyst_block')).toBeGreaterThan(50);
    expect(count(world, 'budding_amethyst')).toBeGreaterThan(0);
    // the hollow inside (filling air) exists
    expect(count(world, 'air')).toBeGreaterThan(10);
    // buds/clusters only grow on budding amethyst positions' neighbours
    const buds = ['small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster'].reduce((a, n) => a + count(world, n), 0);
    expect(buds).toBeGreaterThan(0);
  });

  it('refuses to generate in open air', () => {
    const world = new BlockWorld();
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.addChunk(new Chunk(cx, cz));
    const lv = new GenLevel(world, gen, 0, 0);
    expect(geode(innerConfig('amethyst_geode'))(lv, new JavaRandom(5), 8, 60, 8)).toBe(false);
  });
});

describe('dungeon (monster_room)', () => {
  it('needs 1–5 wall openings, then builds cobblestone walls, a spawner and chests', () => {
    // a 7×5×7 room cavity with a 1-wide corridor through one wall
    const { world, lv } = stoneWorld((set) => {
      for (let x = 5; x <= 11; x++) for (let z = 5; z <= 11; z++) for (let y = 40; y <= 43; y++) set(x, y, z, 0);
      for (let x = 0; x < 5; x++) for (let y = 40; y <= 41; y++) set(x, y, 8, 0);
    });
    let ok = false;
    for (let seed = 1; seed < 40 && !ok; seed++) ok = monsterRoom(lv, new JavaRandom(seed), 8, 40, 8);
    expect(ok).toBe(true);
    expect(blockNameOf(world.getState(8, 40, 8))).toBe('spawner');
    expect(count(world, 'cobblestone') + count(world, 'mossy_cobblestone')).toBeGreaterThan(20);
    expect(count(world, 'mossy_cobblestone')).toBeGreaterThan(0);
    const bes = takeGenBlockEntities(world);
    const spawner = bes.find((b) => b.kind === 'spawner')!;
    expect(['zombie', 'skeleton', 'spider']).toContain(spawner.kind === 'spawner' && spawner.entity);
    for (const b of bes.filter((b) => b.kind === 'chest')) {
      expect(blockNameOf(world.getState(b.x, b.y, b.z))).toBe('chest');
      expect(b.kind === 'chest' && b.lootTable).toBe('chests/simple_dungeon');
    }
  });

  it('is not placed in solid rock (no openings)', () => {
    const { lv } = stoneWorld();
    expect(monsterRoom(lv, new JavaRandom(3), 8, 40, 8)).toBe(false);
  });
});

describe('cave decoration', () => {
  /** a 12-tall cave hall 9..20 (x, z -6..6) */
  const hall = () => stoneWorld((set) => {
    for (let x = -6; x <= 22; x++) for (let z = -6; z <= 22; z++) for (let y = 30; y <= 41; y++) set(x, y, z, 0);
  });

  it('glow lichen attaches to cave ceilings and walls', () => {
    const { world, lv } = hall();
    const place = glowLichen(innerConfig('glow_lichen'));
    let n = 0;
    const r = new JavaRandom(7);
    for (let i = 0; i < 200; i++) if (place(lv, r, r.nextInt(16), 30 + r.nextInt(12), r.nextInt(16))) n++;
    expect(n).toBeGreaterThan(0);
    let faces = 0;
    for (let x = -8; x < 24; x++) for (let z = -8; z < 24; z++) for (let y = 30; y <= 41; y++) {
      const s = world.getState(x, y, z);
      if (blockNameOf(s) !== 'glow_lichen') continue;
      expect(getProp(s, 'down')).toBe(false); // can_place_on_floor: false (spreading may still not add floors)
      if (getProp(s, 'up')) faces++;
    }
    expect(faces).toBeGreaterThan(0);
  });

  it('small dripstone grows pointed dripstone from dripstone patches', () => {
    const { world, lv } = hall();
    const place = smallDripstone(innerConfig('small_dripstone'));
    const r = new JavaRandom(11);
    for (let i = 0; i < 100; i++) place(lv, r, r.nextInt(16), 30 + r.nextInt(12), r.nextInt(16));
    expect(count(world, 'pointed_dripstone')).toBeGreaterThan(10);
    expect(count(world, 'dripstone_block')).toBeGreaterThan(10);
    // every pointed dripstone hangs from / stands on dripstone or another pointed dripstone
    for (let x = -8; x < 24; x++) for (let z = -8; z < 24; z++) for (let y = 30; y <= 41; y++) {
      const s = world.getState(x, y, z);
      if (blockNameOf(s) !== 'pointed_dripstone') continue;
      const base = world.getState(x, y + (getProp(s, 'vertical_direction') === 'down' ? 1 : -1), z);
      expect(['dripstone_block', 'pointed_dripstone']).toContain(blockNameOf(base));
    }
  });

  it('dripstone clusters and large dripstone fill a cave', () => {
    const { world, lv } = hall();
    const r = new JavaRandom(3);
    const cluster = dripstoneCluster(innerConfig('dripstone_cluster'));
    for (let i = 0; i < 5; i++) cluster(lv, r, r.nextInt(16), 35, r.nextInt(16));
    const tips = count(world, 'pointed_dripstone');
    expect(tips).toBeGreaterThan(10);
    const large = largeDripstone(innerConfig('large_dripstone'));
    const before = count(world, 'dripstone_block');
    for (let i = 0; i < 10; i++) large(lv, r, r.nextInt(16), 35, r.nextInt(16));
    expect(count(world, 'dripstone_block')).toBeGreaterThan(before);
  });
});

describe('ores and fossils', () => {
  it('replace_single_block puts emerald ore into stone only', () => {
    const { world, lv } = stoneWorld();
    const place = replaceSingleBlock(innerConfig('ore_emerald'));
    place(lv, new JavaRandom(1), 3, 20, 3);
    expect(blockNameOf(world.getState(3, 20, 3))).toBe('emerald_ore');
    place(lv, new JavaRandom(1), 3, 200, 3);
    expect(blockNameOf(world.getState(3, 200, 3))).toBe('air');
  });

  it('fossils of bone blocks (own shapes) sit buried within their chunk', () => {
    for (const n of ['spine_1', 'spine_2', 'spine_3', 'spine_4', 'skull_1', 'skull_2', 'skull_3', 'skull_4']) {
      const t = fossilTemplate(`minecraft:fossil/${n}`)!;
      expect(t.blocks.length).toBeGreaterThan(10);
      expect(Math.max(t.sx, t.sz)).toBeLessThan(16);
    }
    const { world, lv } = stoneWorld();
    const place = fossil(innerConfig('fossil'));
    let ok = 0;
    for (let seed = 1; seed < 10; seed++) if (place(lv, new JavaRandom(seed), 0, 0, 0)) ok++;
    expect(ok).toBeGreaterThan(0);
    expect(count(world, 'bone_block')).toBeGreaterThan(20);
    // only inside chunk (0, 0)
    for (let x = -16; x < 32; x++) for (let z = -16; z < 32; z++) for (let y = 0; y < 128; y++)
      if (blockNameOf(world.getState(x, y, z)) === 'bone_block') expect(x >= 0 && x < 16 && z >= 0 && z < 16).toBe(true);
  });
});

describe('carving mask', () => {
  it('generated chunks keep their carver masks until decorated', () => {
    const g = new OverworldGenerator(20211n);
    const c = g.generate(0, 0);
    expect(c.carvingMasks).toHaveLength(2);
    expect(c.carvingMasks![0]).toBeInstanceOf(Uint8Array);
    const world = new BlockWorld();
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.addChunk(cx === 0 && cz === 0 ? c : g.generate(cx, cz));
    g.decorate(world, 0, 0);
    expect(c.carvingMasks).toBeNull();
  });
});
