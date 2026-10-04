import { describe, it, expect } from 'vitest';
import { JavaRandom } from '../../util/random';
import { BlockWorld } from '../../world/world';
import { Chunk } from '../../world/chunk';
import { stateOf, blockNameOf, getProp, stateToString } from '../../world/blockstate';
import { GenLevel } from './level';
import { configuredFeature } from './engine';
import { OverworldGenerator } from '../overworld/generator';

/** A 3×3-chunk test level around chunk (0, 0): `ground` up to y 62, `fill` (air or water) from 63 down to `floor`. */
function level(ground: string, opts: { water?: boolean; floor?: number } = {}): GenLevel {
  const world = new BlockWorld();
  const g = stateOf(ground), stone = stateOf('stone'), water = stateOf('water');
  const floor = opts.floor ?? 63;
  for (let cx = -1; cx <= 1; cx++)
    for (let cz = -1; cz <= 1; cz++) {
      const c = new Chunk(cx, cz);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          for (let y = 0; y < floor - 4; y++) c.setState(x, y, z, stone);
          for (let y = floor - 4; y < floor; y++) c.setState(x, y, z, g);
          if (opts.water) for (let y = floor; y < 63; y++) c.setState(x, y, z, water);
        }
      world.addChunk(c);
    }
  return new GenLevel(world, {} as OverworldGenerator, 0, 0);
}

const inline = (type: string, config: object = {}) => configuredFeature({ type: `minecraft:${type}`, config });

function count(lv: GenLevel, pred: (n: string) => boolean): number {
  let n = 0;
  for (let x = -8; x < 24; x++) for (let z = -8; z < 24; z++) for (let y = 30; y < 110; y++) if (pred(blockNameOf(lv.getState(x, y, z)))) n++;
  return n;
}

describe('surface features', () => {
  it('builds the desert well layout on sand', () => {
    const lv = level('sand');
    expect(inline('desert_well')(lv, new JavaRandom(1n), 8, 63, 8)).toBe(true);
    const at = (dx: number, dy: number, dz: number) => stateToString(lv.getState(8 + dx, 62 + dy, 8 + dz)).replace('minecraft:', '');
    // the basin: water in a plus, sandstone below and around
    expect(at(0, 0, 0)).toMatch(/^water/);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(at(dx!, 0, dz!)).toMatch(/^water/);
    expect(at(1, 0, 1)).toBe('sandstone');
    expect(at(0, -1, 0)).toBe('sandstone');
    expect(at(2, 0, 2)).toBe('sandstone');
    // rim: sandstone with slabs mid-side, four pillars and a slab roof with a sandstone centre
    expect(at(2, 1, 2)).toBe('sandstone');
    expect(at(2, 1, 0)).toMatch(/^sandstone_slab\[type=bottom/);
    expect(at(0, 1, 0)).toBe('air');
    for (let y = 1; y <= 3; y++) expect(at(1, y, -1)).toBe('sandstone');
    expect(at(0, 4, 0)).toBe('sandstone');
    expect(at(1, 4, 1)).toMatch(/^sandstone_slab/);
    expect(at(0, 5, 0)).toBe('air');
  });

  it('needs sand under a desert well', () => {
    expect(inline('desert_well')(level('grass_block'), new JavaRandom(1n), 8, 63, 8)).toBe(false);
  });

  it('grows huge mushrooms on mycelium with vanilla cap shapes', () => {
    const cfg = (cap: string, radius: number) => ({
      cap_provider: { type: 'minecraft:simple_state_provider', state: { Name: `minecraft:${cap}`, Properties: { west: 'true', up: 'true', south: 'true', north: 'true', east: 'true', down: 'false' } } },
      stem_provider: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:mushroom_stem', Properties: { west: 'true', up: 'false', south: 'true', north: 'true', east: 'true', down: 'false' } } },
      foliage_radius: radius,
    });
    for (let seed = 0n; seed < 8n; seed++) {
      const lv = level('mycelium');
      expect(inline('huge_brown_mushroom', cfg('brown_mushroom_block', 3))(lv, new JavaRandom(seed), 8, 63, 8)).toBe(true);
      // the flat brown cap is a 7×7 square without its corners: 45 blocks
      expect(count(lv, (n) => n === 'brown_mushroom_block')).toBe(45);
      const stem = count(lv, (n) => n === 'mushroom_stem');
      expect([4, 5, 6, 8, 10, 12]).toContain(stem);
      expect(blockNameOf(lv.getState(8, 63 + stem, 8))).toBe('brown_mushroom_block');
      // the corner-adjacent edge blocks show the cap's outside on both sides
      expect(getProp(lv.getState(8 - 3, 63 + stem, 8 - 2), 'north')).toBe(true);
      expect(getProp(lv.getState(8, 63 + stem, 8), 'west')).toBe(false);

      const lr = level('mycelium');
      inline('huge_red_mushroom', cfg('red_mushroom_block', 2))(lr, new JavaRandom(seed), 8, 63, 8);
      // three rings of 12 (5×5 outline without corners) plus a 3×3 top
      expect(count(lr, (n) => n === 'red_mushroom_block')).toBe(3 * 12 + 9);
    }
  });

  it('refuses huge mushrooms on stone', () => {
    const cfg = { cap_provider: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:red_mushroom_block' } }, stem_provider: { type: 'minecraft:simple_state_provider', state: { Name: 'minecraft:mushroom_stem' } }, foliage_radius: 2 };
    expect(inline('huge_red_mushroom', cfg)(level('stone'), new JavaRandom(3n), 8, 63, 8)).toBe(false);
  });

  it('grows bamboo with leafy tops and podzol', () => {
    let podzol = 0;
    for (let seed = 0n; seed < 12n; seed++) {
      const lv = level('grass_block');
      inline('bamboo', { probability: 1 })(lv, new JavaRandom(seed), 8, 63, 8);
      let h = 0;
      while (blockNameOf(lv.getState(8, 63 + h, 8)) === 'bamboo') h++;
      expect(h).toBeGreaterThanOrEqual(5);
      expect(h).toBeLessThanOrEqual(17);
      expect(getProp(lv.getState(8, 63 + h - 1, 8), 'leaves')).toBe('large');
      expect(getProp(lv.getState(8, 63 + h - 1, 8), 'stage')).toBe(1);
      expect(getProp(lv.getState(8, 63 + h - 3, 8), 'leaves')).toBe('small');
      expect(getProp(lv.getState(8, 63, 8), 'leaves')).toBe('none');
      podzol += count(lv, (n) => n === 'podzol');
    }
    expect(podzol).toBeGreaterThan(12);
  });

  it('hangs vines on full faces only', () => {
    const lv = level('grass_block');
    // a stone wall at x = 9
    for (let y = 63; y < 120; y++) for (let z = -8; z < 24; z++) lv.setState(9, y, z, stateOf('stone'));
    inline('vines')(lv, new JavaRandom(5n), 8, 0, 8);
    let vines = 0;
    for (let x = -16; x < 32; x++)
      for (let z = -16; z < 32; z++)
        for (let y = 0; y < 256; y++) {
          const s = lv.getState(x, y, z);
          if (blockNameOf(s) !== 'vine') continue;
          vines++;
          expect(y).toBeGreaterThanOrEqual(64);
          // west of the wall: attached east; east of it: attached west
          if (x === 8) expect(getProp(s, 'east')).toBe(true);
          else expect(x).toBe(10);
        }
    expect(vines).toBeGreaterThan(20);
  });

  it('builds coral reefs from valid coral states', () => {
    const lv = level('sand', { water: true, floor: 50 });
    let placed = 0;
    for (let i = 0; i < 30; i++) {
      const r = new JavaRandom(BigInt(i));
      const kind = ['coral_tree', 'coral_claw', 'coral_mushroom'][i % 3]!;
      if (inline(kind)(lv, r, (i % 5) * 3 + 1, 50, Math.trunc(i / 5) * 2 + 1)) placed++;
    }
    expect(placed).toBeGreaterThan(15); // a claw whose origin is already a coral block fails
    expect(count(lv, (n) => n.endsWith('_coral_block'))).toBeGreaterThan(150);
    expect(count(lv, (n) => n.endsWith('_coral_wall_fan'))).toBeGreaterThan(20);
    // corals only grow in water: nothing above the surface
    for (let x = -16; x < 32; x++) for (let z = -16; z < 32; z++) expect(blockNameOf(lv.getState(x, 63, z))).toBe('air');
  });

  it('floats icebergs at sea level and grows blue ice under packed ice', () => {
    const lv = level('gravel', { water: true, floor: 40 });
    inline('iceberg', { state: { Name: 'minecraft:packed_ice' } })(lv, new JavaRandom(42n), 8, 0, 8);
    expect(count(lv, (n) => n === 'packed_ice')).toBeGreaterThan(50);
    expect(inline('blue_ice')(lv, new JavaRandom(7n), 8, 61, 8)).toBe(false); // inside the berg, not water
  });

  it('raises ice spikes from snow', () => {
    const lv = level('snow_block');
    expect(inline('ice_spike')(lv, new JavaRandom(9n), 8, 63, 8)).toBe(true);
    expect(blockNameOf(lv.getState(8, 64, 8))).toBe('packed_ice');
    expect(count(lv, (n) => n === 'packed_ice')).toBeGreaterThan(10);
    expect(inline('ice_spike')(level('grass_block'), new JavaRandom(9n), 8, 63, 8)).toBe(false);
  });

  it('drops mossy cobblestone forest rocks onto the ground', () => {
    const lv = level('podzol');
    expect(inline('forest_rock', { state: { Name: 'minecraft:mossy_cobblestone' } })(lv, new JavaRandom(11n), 8, 70, 8)).toBe(true);
    const n = count(lv, (b) => b === 'mossy_cobblestone');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3 * 27);
    expect(blockNameOf(lv.getState(8, 63, 8))).toBe('mossy_cobblestone');
  });
});

describe('surface features in decorated biomes (seed 20211)', () => {
  function decorated(bx: number, bz: number): Map<string, number> {
    const gen = new OverworldGenerator(20211n);
    const world = new BlockWorld();
    const cx0 = bx >> 4, cz0 = bz >> 4;
    for (let cz = -1; cz <= 3; cz++) for (let cx = -1; cx <= 3; cx++) world.addChunk(gen.generate(cx0 + cx, cz0 + cz));
    for (let cz = 0; cz < 3; cz++) for (let cx = 0; cx < 3; cx++) gen.decorate(world, cx0 + cx, cz0 + cz);
    const counts = new Map<string, number>();
    for (let x = cx0 * 16; x < cx0 * 16 + 48; x++)
      for (let z = cz0 * 16; z < cz0 * 16 + 48; z++)
        for (let y = 30; y < 160; y++) {
          const n = blockNameOf(world.getState(x, y, z));
          counts.set(n, (counts.get(n) ?? 0) + 1);
        }
    return counts;
  }
  it('bamboo jungle: bamboo on podzol, vines, melons or tall plants', () => {
    const c = decorated(-1856, -1920);
    expect(c.get('bamboo') ?? 0).toBeGreaterThan(500);
    expect(c.get('podzol') ?? 0).toBeGreaterThan(100);
    expect(c.get('vine') ?? 0).toBeGreaterThan(100);
  }, 60000);
  it('mushroom fields: huge mushrooms', () => {
    const c = decorated(1024, -10752);
    expect((c.get('red_mushroom_block') ?? 0) + (c.get('brown_mushroom_block') ?? 0)).toBeGreaterThan(100);
    expect(c.get('mushroom_stem') ?? 0).toBeGreaterThan(10);
  }, 60000);
  it('sunflower plains: double plants', () => {
    const c = decorated(-768, -1024);
    expect(c.get('sunflower') ?? 0).toBeGreaterThan(20);
    expect(c.get('tall_grass') ?? 0).toBeGreaterThan(10);
  }, 60000);
});

/**
 * Bit-exactness against the 1.17.1 Java code (IcebergFeature / IceSpikeFeature run in a JVM on the
 * same simple levels, with Math.sin/cos as fdlibm like V8): per seed, the number of changed blocks
 * and a Java hash of the sorted "x,y,z=block" list.
 */
describe('surface features match Java', () => {
  const JAVA_ICEBERG = '0 714 1148433614;1 1194 1999911730;2 664 -1024441224;3 872 749064400;4 1147 1239520841;5 270 -1057444797;6 1108 33439835;7 1370 -1299945562;8 2343 1857706904;9 1259 -1424075261;10 289 -1186384008;11 219 -414228566;12 1230 -1541601907;13 1636 -1718656876;14 754 -1165928798;15 1354 2137803008;16 1744 1807458166;17 1291 2018848091;18 847 1853870265;19 1795 848494921';
  const JAVA_ICE_SPIKE = '0 113 -1288510585;1 19 197960387;2 185 -435554839;3 105 1362936053;4 224 1324915123;5 18 -2110912129;6 184 1820669243;7 207 737417574;8 226 -1394332049;9 185 1501718001;10 91 430894472;11 109 629117473;12 18 -1377900449;13 91 -1757273860;14 207 -1367231194;15 114 531940236;16 204 1710030408;17 224 592588851;18 118 2082728748;19 87 -1185326975';
  const javaHash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  };
  function run(base: (y: number) => string, place: (lv: GenLevel, r: JavaRandom) => void): string {
    const out: string[] = [];
    for (let seed = 0; seed < 20; seed++) {
      const blocks = new Map<string, number>(), changed = new Map<string, string>();
      const get = (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? stateOf(base(y));
      const lv = {
        minY: 0, height: 256, seaLevel: 63, getState: get,
        isEmpty: (x: number, y: number, z: number) => blockNameOf(get(x, y, z)) === 'air',
        isAir: (x: number, y: number, z: number) => blockNameOf(get(x, y, z)) === 'air',
        setState: (x: number, y: number, z: number, s: number) => (blocks.set(`${x},${y},${z}`, s), changed.set(`${x},${y},${z}`, blockNameOf(s)), true),
      } as unknown as GenLevel;
      place(lv, new JavaRandom(BigInt(seed)));
      let h = 0;
      for (const k of [...changed.keys()].sort()) h = (Math.imul(h, 31) + javaHash(`${k}=${changed.get(k)}`)) | 0;
      out.push(`${seed} ${changed.size} ${h}`);
    }
    return out.join(';');
  }
  it('iceberg', () => {
    const p = inline('iceberg', { state: { Name: 'minecraft:packed_ice' } });
    expect(run((y) => (y < 40 ? 'gravel' : y < 63 ? 'water' : 'air'), (lv, r) => p(lv, r, 8, 0, 8))).toBe(JAVA_ICEBERG);
  });
  it('ice spike', () => {
    const p = inline('ice_spike');
    expect(run((y) => (y < 59 ? 'stone' : y < 63 ? 'snow_block' : 'air'), (lv, r) => p(lv, r, 8, 70, 8))).toBe(JAVA_ICE_SPIKE);
  });
});
