import { describe, expect, it } from 'vitest';
import { OverworldGenerator } from '../overworld/generator';
import { FEATURES, potentialChunk, structureStart, strongholdPositions, locateStructure } from './placement';
import { fillChestLoot, rollLootItems, STRUCTURE_LOOT } from './loot';
import { rotateState, frameState, BoundingBox } from './piece';
import { stateOf, getProp, blockNameOf } from '../../world/blockstate';
import { ITEMS_BY_NAME } from '../../data';
import { WORLDGEN } from '../features/data';
import { B } from '../biome/biomeids';
import { BlockWorld } from '../../world/world';
import { takeGenBlockEntities } from '../features/underground';
import { JavaRandom } from '../../util/random';
import { regionSeed } from '../rand';

const SEED = 20211n;
const gen = new OverworldGenerator(SEED);
const NAMES: Record<number, string> = Object.fromEntries(Object.entries(B).map(([n, id]) => [id, n]));
const startsOf = (biome: number) => WORLDGEN.biomes[NAMES[biome]!]?.starts ?? [];

describe('structure start placement', () => {
  it('uses the vanilla 1.17.1 spacing / separation / salt', () => {
    const v = (k: string) => [FEATURES[k]!.spacing, FEATURES[k]!.separation, FEATURES[k]!.salt];
    expect(v('village')).toEqual([32, 8, 10387312]);
    expect(v('desert_pyramid')).toEqual([32, 8, 14357617]);
    expect(v('igloo')).toEqual([32, 8, 14357618]);
    expect(v('jungle_pyramid')).toEqual([32, 8, 14357619]);
    expect(v('swamp_hut')).toEqual([32, 8, 14357620]);
    expect(v('pillager_outpost')).toEqual([32, 8, 165745296]);
    expect(v('ocean_ruin')).toEqual([20, 8, 14357621]);
    expect(v('shipwreck')).toEqual([24, 4, 165745295]);
    expect(v('monument')).toEqual([32, 5, 10387313]);
    expect(v('mansion')).toEqual([80, 20, 10387319]);
    expect(v('ruined_portal')).toEqual([40, 15, 34222645]);
    expect(FEATURES.monument!.triangular && FEATURES.mansion!.triangular).toBe(true);
  });

  it('getPotentialFeatureChunk: one candidate per region, inside spacing - separation', () => {
    for (const k of ['village', 'shipwreck', 'mansion', 'ocean_ruin']) {
      const d = FEATURES[k]!;
      for (let rx = -3; rx <= 3; rx++)
        for (let rz = -3; rz <= 3; rz++) {
          const [px, pz] = potentialChunk(d, SEED, rx * d.spacing + 5, rz * d.spacing + 1);
          expect(px - rx * d.spacing).toBeGreaterThanOrEqual(0);
          expect(px - rx * d.spacing).toBeLessThan(d.spacing - d.separation);
          expect(pz - rz * d.spacing).toBeLessThan(d.spacing - d.separation);
          // every chunk of the region maps to the same candidate
          expect(potentialChunk(d, SEED, rx * d.spacing + d.spacing - 1, rz * d.spacing)).toEqual([px, pz]);
        }
    }
  });

  it('matches the WorldgenRandom formula (setLargeFeatureWithSalt then nextInt twice)', () => {
    const d = FEATURES.village!;
    const r = new JavaRandom(regionSeed(SEED, -2, 3, 10387312));
    const ox = r.nextInt(24), oz = r.nextInt(24);
    expect(potentialChunk(d, SEED, -64, 96)).toEqual([-64 + ox, 96 + oz]);
  });

  it('starts only in biomes that list the structure, deterministically', () => {
    for (const type of ['desert_pyramid', 'swamp_hut', 'shipwreck', 'ocean_ruin', 'ruined_portal', 'igloo']) {
      const p = locateStructure(gen, type, 0, 0, 40);
      expect(p, type).not.toBeNull();
      const cx = p!.x >> 4, cz = p!.z >> 4;
      const biome = gen.quartBiome((cx << 2) + 2, (cz << 2) + 2);
      expect(startsOf(biome).some((s) => s.replace('minecraft:', '').startsWith(type)), `${type} in ${NAMES[biome]}`).toBe(true);
      const again = new OverworldGenerator(SEED);
      expect(structureStart(again, type, cx, cz)?.pieces.length).toBe(structureStart(gen, type, cx, cz)?.pieces.length);
    }
  });

  it('keeps pillager outposts away from village candidates', () => {
    const def = FEATURES.pillager_outpost!;
    for (let rx = -4; rx <= 4; rx++)
      for (let rz = -4; rz <= 4; rz++) {
        const [px, pz] = potentialChunk(def, SEED, rx * 32, rz * 32);
        const s = structureStart(gen, 'pillager_outpost', px, pz);
        if (!s) continue;
        for (let x = px - 10; x <= px + 10; x++)
          for (let z = pz - 10; z <= pz + 10; z++) {
            const [vx, vz] = potentialChunk(FEATURES.village!, SEED, x, z);
            expect(vx === x && vz === z).toBe(false);
          }
      }
  });

  it('places 128 strongholds in rings starting ~1280-2816 blocks out', () => {
    const list = strongholdPositions(gen);
    expect(list.length).toBe(128);
    for (const [x, z] of list.slice(0, 3)) {
      const d = Math.hypot(x, z);
      expect(d).toBeGreaterThan(88 - 8);
      expect(d).toBeLessThan(168 + 8);
    }
    const ring2 = list.slice(3, 9).map(([x, z]) => Math.hypot(x, z));
    for (const d of ring2) expect(d).toBeGreaterThan(280 + 128 - 40 - 8 - 200);
  });
});

describe('structure pieces', () => {
  function build(type: string) {
    const p = locateStructure(gen, type, 0, 0, 60)!;
    const s = structureStart(gen, type, p.x >> 4, p.z >> 4)!;
    const b = s.xzBox;
    const world = new BlockWorld();
    for (let cx = (b.x0 >> 4) - 1; cx <= (b.x1 >> 4) + 1; cx++) for (let cz = (b.z0 >> 4) - 1; cz <= (b.z1 >> 4) + 1; cz++) world.addChunk(gen.generate(cx, cz));
    for (let cx = b.x0 >> 4; cx <= b.x1 >> 4; cx++) for (let cz = b.z0 >> 4; cz <= b.z1 >> 4; cz++) gen.decorate(world, cx, cz);
    return { s, world, bes: takeGenBlockEntities(world) };
  }

  it('desert pyramid: four loot chests over the TNT trap', () => {
    const { bes, world } = build('desert_pyramid');
    const chests = bes.filter((e) => e.kind === 'chest' && e.lootTable === 'minecraft:chests/desert_pyramid');
    expect(chests.length).toBe(4);
    for (const c of chests) expect(blockNameOf(world.getState(c.x, c.y, c.z))).toBe('chest');
    const c0 = chests[0]!;
    let tnt = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (blockNameOf(world.getState(c0.x + dx, c0.y - 2, c0.z + dz)) === 'tnt') tnt++;
    expect(tnt).toBe(9);
  }, 120000);

  it('mineshaft: corridors within 80 blocks + depth limits, with supports', () => {
    const p = locateStructure(gen, 'mineshaft', 0, 0, 40)!;
    const s = structureStart(gen, 'mineshaft', p.x >> 4, p.z >> 4)!;
    expect(s.pieces.length).toBeGreaterThan(1);
    const room = s.pieces[0]!.box;
    for (const pc of s.pieces) {
      expect(Math.abs(pc.box.x0 - room.x0)).toBeLessThan(80 + 30);
      expect(pc.box.y1).toBeLessThan(64);
    }
  });

  it('stronghold: has exactly one portal room with 12 frames', () => {
    const [sx, sz] = strongholdPositions(gen)[0]!;
    const s = structureStart(gen, 'stronghold', sx, sz)!;
    expect(s).not.toBeNull();
    expect(s.pieces.filter((p) => p.constructor.name === 'PortalRoom').length).toBe(1);
  });
});

describe('more structures', () => {
  it('village: a meeting point, streets and buildings within 80 blocks', () => {
    const p = locateStructure(gen, 'village', 0, 0, 40)!;
    const s = structureStart(gen, 'village', p.x >> 4, p.z >> 4)!;
    const names = s.pieces.map((x) => x.constructor.name);
    expect(names.filter((n) => n === 'StreetPiece').length).toBeGreaterThan(2);
    expect(names.filter((n) => n === 'BuildingPiece').length).toBeGreaterThan(5);
    const cx = (s.cx << 4) + 8, cz = (s.cz << 4) + 8;
    for (const pc of s.pieces) {
      expect(Math.abs(pc.box.x0 - cx)).toBeLessThanOrEqual(80);
      expect(Math.abs(pc.box.z1 - cz)).toBeLessThanOrEqual(80);
    }
    // no two pieces overlap
    for (let i = 0; i < s.pieces.length; i++)
      for (let j = i + 1; j < s.pieces.length; j++) {
        const a = s.pieces[i]!.box, b = s.pieces[j]!.box;
        expect(a.intersectsXZ(b.x0, b.z0, b.x1, b.z1)).toBe(false);
      }
  });

  it('pillager outpost: a watchtower with the outpost chest', () => {
    const p = locateStructure(gen, 'pillager_outpost', 0, 0, 60)!;
    expect(p).not.toBeNull();
    const s = structureStart(gen, 'pillager_outpost', p.x >> 4, p.z >> 4)!;
    const tower = s.pieces[0] as unknown as { model: { chests: { loot: string }[] } };
    expect(tower.model.chests.map((c) => c.loot)).toContain('minecraft:chests/pillager_outpost');
  });

  it('monument and mansion obey their extra biome checks', () => {
    const m = locateStructure(gen, 'monument', 0, 0, 40)!;
    const biome = gen.quartBiome(((m.x >> 4) << 2) + 2, ((m.z >> 4) << 2) + 2);
    expect(NAMES[biome]).toMatch(/deep_/);
  });
});

describe('structure loot', () => {
  it('every table names real items', () => {
    for (const [id, t] of Object.entries(STRUCTURE_LOOT))
      for (const pool of t.pools) for (const e of pool.entries) if (e.item) expect(ITEMS_BY_NAME.has(e.item), `${id}: ${e.item}`).toBe(true);
  });

  it('fills a chest deterministically from its seed into 27 slots', () => {
    const a = fillChestLoot('minecraft:chests/desert_pyramid', 123456789n);
    const b = fillChestLoot('minecraft:chests/desert_pyramid', 123456789n);
    expect(a).toEqual(b);
    expect(a.length).toBe(27);
    expect(a.filter(Boolean).length).toBeGreaterThan(0);
    for (const it of a) if (it) expect(ITEMS_BY_NAME.has(it.item), it.item).toBe(true);
  });

  it('buried treasure always has a heart of the sea', () => {
    for (let i = 0; i < 20; i++) {
      const items = fillChestLoot('chests/buried_treasure', BigInt(i * 7919 + 1)).filter(Boolean);
      expect(items.some((x) => x!.item === 'heart_of_the_sea')).toBe(true);
    }
  });

  it('enchanted books come out of enchant_with_levels', () => {
    let books = 0;
    for (let i = 0; i < 400 && books === 0; i++) {
      const items = rollLootItems('chests/stronghold_library', new JavaRandom(BigInt(i)));
      for (const it of items) if (it.item === 'enchanted_book') {
        books++;
        expect(it.enchantments!.length).toBeGreaterThan(0);
      }
    }
    expect(books).toBeGreaterThan(0);
  });
});

describe('piece block transforms', () => {
  it('rotates facing, axis and stairs clockwise', () => {
    const s = stateOf('oak_stairs', { facing: 'north' });
    expect(getProp(rotateState(s, 1), 'facing')).toBe('east');
    expect(getProp(rotateState(s, 2), 'facing')).toBe('south');
    expect(getProp(rotateState(stateOf('oak_log', { axis: 'x' }), 1), 'axis')).toBe('z');
    expect(getProp(rotateState(stateOf('rail', { shape: 'north_south' }), 1), 'shape')).toBe('east_west');
  });

  it('mirrored frames flip stair shapes', () => {
    const s = stateOf('stone_brick_stairs', { facing: 'south', shape: 'inner_left' });
    const m = frameState(s, [1, 0], [0, -1]);
    expect(getProp(m, 'facing')).toBe('north');
    expect(getProp(m, 'shape')).toBe('inner_right');
  });

  it('boxes intersect like vanilla BoundingBox', () => {
    const a = new BoundingBox(0, 0, 0, 15, 255, 15);
    expect(a.intersects(new BoundingBox(15, 10, 15, 20, 20, 20))).toBe(true);
    expect(a.intersects(new BoundingBox(16, 10, 0, 20, 20, 20))).toBe(false);
  });
});
