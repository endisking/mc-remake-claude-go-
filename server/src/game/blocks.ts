/**
 * Server-side block behaviours (vanilla 1.17.1 Block subclasses): scheduled block ticks, random
 * ticks (ServerLevel.tickChunk), gravity blocks, grass/mycelium, leaf decay, farming (farmland,
 * crops, stems, sugar cane, cactus, saplings), bone meal, hoe/shovel/axe use, and doors,
 * trapdoors and fence gates opening by hand.
 *
 * The GameServer calls in through a handful of hooks: tick(), afterSetBlock(), use(),
 * useItemOn() and fallOn().
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { ItemEntity } from './entity';
import { FallingBlockEntity } from './fallingblock';
import { TickScheduler } from './ticks';
import { BLOCK_STATE_COUNT, BIOMES, ITEMS_BY_ID } from '@shared/data';
import { blockIdOf, blockNameOf, getProp, withProp, defaultState, stateOf } from '@shared/world/blockstate';
import { FLUID, FLUID_LEVEL, FULL_COLLISION, IS_AIR, LIGHT_FILTER } from '@shared/world/blockinfo';
import { sectionIndex } from '@shared/world/chunk';
import { skyDarkenLevel } from '@shared/world/daylight';
import { getTemperature } from '@shared/world/climate';
import { canSurvive } from '@shared/game/support';
import { isReplaceable, DIRS, DX, DY, DZ } from '@shared/game/placement';
import { useOpenable } from '@shared/game/openable';
import { blockDrops, itemForBlock } from '@shared/game/loot';
import {
  CROP_MAX_AGE, growthSpeed, growthChanceDenominator, bonemealAgeIncrease, canBeGrass, canPropagateGrass, distanceAt, leavesDistance,
  leavesDecaying, farmlandNearWater, maintainsFarmland, farmlandSurvives, isGravityBlock, fallingIsFree, touchesWater, concreteOf,
  treeForSapling, MEGA_SAPLINGS, hasFlowersNear, megaOffset,
} from '@shared/game/growth';
import { GenLevel } from '@shared/worldgen/features/level';
import { configuredFeature } from '@shared/worldgen/features/engine';
import { stateProvider, type StateProvider } from '@shared/worldgen/features/providers';
import { WORLDGEN } from '@shared/worldgen/features/data';
import type { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import type { BlockWorld } from '@shared/world/world';
import type { ItemStack } from '@shared/item/stack';

// ------------------------------------------------------------------ static tables
const STEM_FRUIT: Record<string, [string, string]> = { pumpkin_stem: ['pumpkin', 'attached_pumpkin_stem'], melon_stem: ['melon', 'attached_melon_stem'] };
const ATTACHED_STEM: Record<string, [string, string]> = { attached_pumpkin_stem: ['pumpkin', 'pumpkin_stem'], attached_melon_stem: ['melon', 'melon_stem'] };
const TALL_FLOWERS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony']);
const DOUBLE_PLANTS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'tall_seagrass', 'small_dripleaf']);
const STRIPPABLE: Record<string, string> = {};
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
  STRIPPABLE[`${w}_log`] = `stripped_${w}_log`;
  STRIPPABLE[`${w}_wood`] = `stripped_${w}_wood`;
}
for (const w of ['crimson', 'warped']) {
  STRIPPABLE[`${w}_stem`] = `stripped_${w}_stem`;
  STRIPPABLE[`${w}_hyphae`] = `stripped_${w}_hyphae`;
}
/** GrowingPlantHeadBlock subclasses: grow direction (1 up, −1 down), chance per random tick, body block. */
const GROWING_HEADS: Record<string, { dir: number; chance: number; body: string }> = {
  kelp: { dir: 1, chance: 0.14, body: 'kelp_plant' },
  weeping_vines: { dir: -1, chance: 0.1, body: 'weeping_vines_plant' },
  twisting_vines: { dir: 1, chance: 0.1, body: 'twisting_vines_plant' },
  cave_vines: { dir: -1, chance: 0.11, body: 'cave_vines_plant' },
};
const GROWING_BODIES: Record<string, string> = { kelp_plant: 'kelp', weeping_vines_plant: 'weeping_vines', twisting_vines_plant: 'twisting_vines', cave_vines_plant: 'cave_vines' };
const FLATTENABLE = new Set(['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'mycelium', 'rooted_dirt']);

/** BlockState.isRandomlyTicking for the behaviours implemented here. */
const RANDOM_TICKING = new Uint8Array(BLOCK_STATE_COUNT);
for (let s = 0; s < BLOCK_STATE_COUNT; s++) {
  const n = blockNameOf(s);
  let t = false;
  if (n === 'grass_block' || n === 'mycelium' || n === 'farmland' || n === 'sugar_cane' || n === 'cactus' || n === 'vine' || n in STEM_FRUIT) t = true;
  else if (isTreeSapling(n)) t = true;
  else if (n in CROP_MAX_AGE) t = (getProp(s, 'age') as number) < CROP_MAX_AGE[n]!;
  else if (n.endsWith('_leaves')) t = leavesDecaying(s);
  else if (n === 'snow' || n === 'ice') t = true;
  else if (n === 'nether_wart' || n === 'sweet_berry_bush') t = (getProp(s, 'age') as number) < 3;
  else if (n === 'cocoa') t = (getProp(s, 'age') as number) < 2;
  else if (n in GROWING_HEADS) t = (getProp(s, 'age') as number) < 25;
  else if (n === 'bamboo') t = getProp(s, 'stage') === 0;
  else if (n === 'bamboo_sapling' || n === 'brown_mushroom' || n === 'red_mushroom') t = true;
  RANDOM_TICKING[s] = t ? 1 : 0;
}

/** Feature-placing level that writes through the server (block updates, light, clients). */
class ServerGenLevel extends GenLevel {
  constructor(private readonly server: GameServer) {
    super(server.world, (server.generator as unknown as OverworldGenerator), 0, 0);
  }
  override canWrite(): boolean {
    return true;
  }
  override setState(x: number, y: number, z: number, state: number): boolean {
    if (y < 0 || y >= 256) return false;
    this.server.setBlock(x, y, z, state);
    return true;
  }
}

export class BlockBehaviors {
  /** Scheduled block ticks (type = block id). */
  readonly blockTicks = new TickScheduler<number>();
  /** gamerule randomTickSpeed */
  randomTickSpeed = 3;
  /** ServerLevel.randValue (block position LCG) */
  private randValue = (Math.random() * 0x100000000) | 0;
  private hookDepth = 0;
  private skyDarken = 0;
  private readonly flowerProviders = new Map<number, StateProvider | null>();

  constructor(private readonly s: GameServer) {}

  private get w(): BlockWorld {
    return this.s.world;
  }

  scheduleTick(x: number, y: number, z: number, state: number, delay: number, priority = 0): void {
    this.blockTicks.schedule(this.s.gameTime, x, y, z, blockIdOf(state), delay, priority);
  }

  // ---------------------------------------------------------------- ticking
  tick(): void {
    const s = this.s;
    this.skyDarken = skyDarkenLevel(s.dayTime, s.rainLevel, s.thunderLevel * s.rainLevel);
    this.blockTicks.tick(s.gameTime, (x, z) => this.w.isLoaded(x, z) && s.isTickingChunk(x >> 4, z >> 4), (t) => {
      const st = this.w.getState(t.x, t.y, t.z);
      if (blockIdOf(st) === t.type) this.safely(() => this.tickBlock(t.x, t.y, t.z, st), st);
    });
    this.randomTicks();
  }

  /** ServerLevel.tickChunk random ticks: randomTickSpeed positions per non-empty section. */
  private randomTicks(): void {
    const speed = this.randomTickSpeed;
    if (speed <= 0) return;
    const s = this.s;
    const seen = new Set<number>();
    const d = Math.min(s.simulationDistanceFor(), 8);
    for (const p of s.players) {
      if (p.gameMode === 3) continue;
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      for (let cx = pcx - d; cx <= pcx + d; cx++)
        for (let cz = pcz - d; cz <= pcz + d; cz++) {
          const key = (cx + 0x8000) * 0x10000 + (cz + 0x8000);
          if (seen.has(key)) continue;
          // ChunkMap.noPlayersCloseForSpawning: a non-spectator within 128 blocks of the chunk centre
          const dx = cx * 16 + 8 - p.x, dz = cz * 16 + 8 - p.z;
          if (dx * dx + dz * dz >= 16384) continue;
          const c = this.w.getChunk(cx, cz);
          if (!c) continue;
          seen.add(key);
          this.precipitationTick(cx, cz);
          for (let sy = 0; sy < 16; sy++) {
            const sec = c.sections[sy]!;
            if (!sec.blocks || sec.nonAir === 0) continue;
            for (let k = 0; k < speed; k++) {
              this.randValue = (Math.imul(this.randValue, 3) + 1013904223) | 0;
              const l = this.randValue >> 2;
              const lx = l & 15, ly = (l >> 16) & 15, lz = (l >> 8) & 15;
              const st = sec.getState(sectionIndex(lx, ly, lz));
              if (RANDOM_TICKING[st]) this.safely(() => this.randomTick(cx * 16 + lx, sy * 16 + ly, cz * 16 + lz, st), st);
            }
          }
        }
    }
  }

  /**
   * ServerLevel.tickChunk precipitation: 1 in 16 chunks per tick, at the top block of a random
   * column, still water freezes in cold biomes and snow layers settle while it rains.
   */
  private precipitationTick(cx: number, cz: number): void {
    const s = this.s;
    if (s.rand.nextInt(16) !== 0) return;
    this.randValue = (Math.imul(this.randValue, 3) + 1013904223) | 0;
    const l = this.randValue >> 2;
    const x = cx * 16 + (l & 15), z = cz * 16 + ((l >> 8) & 15);
    const c = this.w.getChunk(cx, cz)!;
    const y = c.motionBlocking[(z & 15) * 16 + (x & 15)]!;
    const w = this.w;
    const biome = w.getBiome(x, y, z);
    // Biome.shouldFreeze (with the neighbour check): a cold still water source at the edge of open water
    if (y - 1 >= 0 && y - 1 < 256 && getTemperature(biome, x, y - 1, z) < 0.15 && (w.getLight(x, y - 1, z) & 15) < 10) {
      const below = w.getState(x, y - 1, z);
      if (blockNameOf(below) === 'water' && getProp(below, 'level') === 0) {
        const isWater = (dx: number, dz: number) => FLUID[w.getState(x + dx, y - 1, z + dz)] === 1;
        if (!(isWater(-1, 0) && isWater(1, 0) && isWater(0, -1) && isWater(0, 1))) {
          s.setBlock(x, y - 1, z, defaultState('ice'));
          s.updateNeighbors(x, y - 1, z);
        }
      }
    }
    if (s.isRaining() && y < 256 && getTemperature(biome, x, y, z) < 0.15 && (w.getLight(x, y, z) & 15) < 10) {
      // Biome.shouldSnow
      const snow = defaultState('snow');
      if (IS_AIR[w.getState(x, y, z)] && canSurvive(w, x, y, z, snow)) {
        s.setBlock(x, y, z, snow);
        s.updateNeighbors(x, y, z);
      }
    }
  }

  /** One misbehaving block must not stop the server loop: log and carry on. */
  private safely(f: () => void, st: number): void {
    try {
      f();
    } catch (e) {
      console.error(`block tick failed for ${blockNameOf(st)}`, e);
    }
  }

  /** Level.getRawBrightness(pos, 0): max(sky, block) ignoring time of day. */
  private rawBrightness(x: number, y: number, z: number): number {
    const l = this.w.getLight(x, y, z);
    return Math.max(l >> 4, l & 15);
  }

  /** LevelReader.getMaxLocalRawBrightness: sky light reduced by the current sky darkening. */
  private localBrightness(x: number, y: number, z: number): number {
    const l = this.w.getLight(x, y, z);
    return Math.max((l >> 4) - this.skyDarken, l & 15);
  }

  randomTick(x: number, y: number, z: number, st: number): void {
    const n = blockNameOf(st);
    const r = this.s.rand;
    if (n === 'grass_block' || n === 'mycelium') return this.spreadGrass(x, y, z, n);
    if (n.endsWith('_leaves')) {
      if (leavesDecaying(st)) this.breakNaturally(x, y, z, false);
      return;
    }
    if (n in CROP_MAX_AGE) {
      if (n === 'beetroots' && r.nextInt(3) === 0) return;
      return this.growCrop(x, y, z, st, n);
    }
    if (isTreeSapling(n)) {
      if (this.localBrightness(x, y + 1, z) >= 9 && r.nextInt(7) === 0) this.advanceTree(x, y, z, st);
      return;
    }
    if (n === 'sugar_cane' || n === 'cactus') return this.growColumn(x, y, z, st, n);
    if (n in STEM_FRUIT) return this.growStem(x, y, z, st, n);
    if (n === 'farmland') return this.farmlandTick(x, y, z, st);
    if (n === 'nether_wart') {
      // NetherWartBlock: 1 in 10
      if ((getProp(st, 'age') as number) < 3 && r.nextInt(10) === 0) this.s.setBlock(x, y, z, withProp(st, 'age', (getProp(st, 'age') as number) + 1));
      return;
    }
    if (n === 'sweet_berry_bush') {
      const age = getProp(st, 'age') as number;
      if (age < 3 && r.nextInt(5) === 0 && this.rawBrightness(x, y + 1, z) >= 9) this.s.setBlock(x, y, z, withProp(st, 'age', age + 1));
      return;
    }
    if (n === 'cocoa') {
      const age = getProp(st, 'age') as number;
      if (r.nextInt(5) === 0 && age < 2) this.s.setBlock(x, y, z, withProp(st, 'age', age + 1));
      return;
    }
    if (n in GROWING_HEADS) return this.growHead(x, y, z, st, n);
    if (n === 'vine') return this.growVine(x, y, z, st);
    if (n === 'bamboo_sapling') {
      // BambooSaplingBlock: the first stalk
      if (r.nextInt(3) === 0 && IS_AIR[this.w.getState(x, y + 1, z)] && this.rawBrightness(x, y + 1, z) >= 9) this.bambooSaplingGrow(x, y, z);
      return;
    }
    if (n === 'bamboo') {
      if (getProp(st, 'stage') !== 0) return;
      if (r.nextInt(3) === 0 && IS_AIR[this.w.getState(x, y + 1, z)] && this.rawBrightness(x, y + 1, z) >= 9) {
        const i = this.bambooBelow(x, y, z) + 1;
        if (i < 16) this.growBamboo(x, y, z, st, i);
      }
      return;
    }
    if (n === 'brown_mushroom' || n === 'red_mushroom') return this.spreadMushroom(x, y, z, st, n);
    if (n === 'snow') {
      // SnowLayerBlock: melts under block light > 11
      if ((this.w.getLight(x, y, z) & 15) > 11) this.breakNaturally(x, y, z, false);
      return;
    }
    if (n === 'ice') {
      // IceBlock.melt (overworld): becomes water
      if ((this.w.getLight(x, y, z) & 15) > 11 - LIGHT_FILTER[st]!) {
        this.s.setBlock(x, y, z, defaultState('water'));
        this.s.updateNeighbors(x, y, z);
      }
    }
  }

  /** Block.tick for scheduled ticks. */
  private tickBlock(x: number, y: number, z: number, st: number): void {
    const n = blockNameOf(st);
    if (isGravityBlock(n)) {
      // FallingBlock.tick
      if (fallingIsFree(this.w.getState(x, y - 1, z)) && y >= 0) this.startFalling(x, y, z, st);
      return;
    }
    if (n.endsWith('_leaves')) {
      const d = leavesDistance(this.w, x, y, z);
      if (d !== getProp(st, 'distance')) this.s.setBlock(x, y, z, withProp(st, 'distance', d));
      return;
    }
    if (n === 'farmland') {
      if (!farmlandSurvives(this.w, x, y, z)) this.turnToDirt(x, y, z);
      return;
    }
    if (n === 'cactus' || n === 'sugar_cane') {
      if (!canSurvive(this.w, x, y, z, st)) this.breakNaturally(x, y, z, true);
    }
  }

  /** Block.dropResources + removeBlock (no tool). */
  breakNaturally(x: number, y: number, z: number, particles: boolean): void {
    const st = this.w.getState(x, y, z);
    this.s.setBlock(x, y, z, 0);
    if (particles) for (const o of this.s.players) this.s.send(o, { t: 'levelEvent', event: 2001, x, y, z, data: st });
    for (const it of blockDrops(st, { silkTouch: false, canHarvest: true, random: () => this.s.rand.nextFloat() })) this.s.popResource(x, y, z, it);
    this.s.updateNeighbors(x, y, z);
  }

  // ---------------------------------------------------------------- block change hook
  /** Called by GameServer.setBlock after every change: onPlace and neighbours' updateShape. */
  afterSetBlock(x: number, y: number, z: number, old: number, st: number): void {
    if (this.hookDepth > 16) return;
    this.hookDepth++;
    try {
      const w = this.w;
      const n = blockNameOf(st);
      if (blockIdOf(old) !== blockIdOf(st)) {
        // onPlace
        if (isGravityBlock(n)) this.scheduleTick(x, y, z, st, 2);
        if (n.endsWith('_concrete_powder') && touchesWater(w, x, y, z)) return this.s.setBlock(x, y, z, defaultState(concreteOf(n)));
        if ((n === 'cactus' || n === 'sugar_cane') && !canSurvive(w, x, y, z, st)) this.scheduleTick(x, y, z, st, 1);
      }
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d]!, ny = y + DY[d]!, nz = z + DZ[d]!;
        if (ny < 0 || ny > 255) continue;
        const ns = w.getState(nx, ny, nz);
        if (IS_AIR[ns]) continue;
        const nn = blockNameOf(ns);
        if (isGravityBlock(nn)) {
          if (nn.endsWith('_concrete_powder') && touchesWater(w, nx, ny, nz)) this.s.setBlock(nx, ny, nz, defaultState(concreteOf(nn)));
          else this.scheduleTick(nx, ny, nz, ns, 2);
        } else if (nn.endsWith('_leaves')) {
          // LeavesBlock.updateShape
          const i = distanceAt(st) + 1;
          if (i !== 1 || getProp(ns, 'distance') !== i) this.scheduleTick(nx, ny, nz, ns, 1);
        } else if (nn === 'farmland') {
          if (d === 0 && !farmlandSurvives(w, nx, ny, nz)) this.scheduleTick(nx, ny, nz, ns, 1);
        } else if (nn === 'cactus' || nn === 'sugar_cane') {
          if (!canSurvive(w, nx, ny, nz, ns)) this.scheduleTick(nx, ny, nz, ns, 1);
        } else if ((d === 0 || d === 1) && getProp(ns, 'half') !== undefined && (nn.endsWith('_door') || DOUBLE_PLANTS.has(nn))) {
          // DoorBlock / DoublePlantBlock.updateShape: a half whose partner is gone disappears
          const partnerHere = (d === 0) === (getProp(ns, 'half') === 'lower');
          if (partnerHere && n !== nn) this.s.setBlock(nx, ny, nz, getProp(ns, 'waterlogged') === true ? defaultState('water') : 0);
        } else if (nn in ATTACHED_STEM) {
          // AttachedStemBlock.updateShape: losing its fruit turns it back into a grown stem
          const f = DIRS.indexOf(getProp(ns, 'facing') as (typeof DIRS)[number]);
          if (nx + DX[f]! === x && nz + DZ[f]! === z && ny === y && n !== ATTACHED_STEM[nn]![0]) {
            this.s.setBlock(nx, ny, nz, stateOf(ATTACHED_STEM[nn]![1], { age: 7 }));
          }
        }
      }
    } finally {
      this.hookDepth--;
    }
  }

  // ---------------------------------------------------------------- falling blocks
  private startFalling(x: number, y: number, z: number, st: number): void {
    const e = new FallingBlockEntity(this.s.newEntityId(), st, (en, world, phase) => this.fallingTick(en, world, phase));
    e.x = x + 0.5;
    e.y = y;
    e.z = z + 0.5;
    const n = blockNameOf(st);
    if (n.endsWith('anvil')) {
      // AnvilBlock.falling: setHurtsEntities(2, 40)
      e.hurtsEntities = true;
      e.fallDamagePerDistance = 2;
      e.fallDamageMax = 40;
    }
    this.s.spawnEntity(e);
  }

  /** FallingBlockEntity.tick server side: first-tick block removal, then landing. */
  private fallingTick(e: FallingBlockEntity, world: BlockWorld, phase: 'start' | 'moved'): boolean {
    const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    if (phase === 'start') {
      if (blockIdOf(world.getState(bx, by, bz)) === blockIdOf(e.state)) {
        this.s.setBlock(bx, by, bz, 0);
        this.s.updateNeighbors(bx, by, bz);
        return true;
      }
      e.removed = true;
      return false;
    }
    const name = blockNameOf(e.state);
    const concrete = name.endsWith('_concrete_powder');
    let px = bx, py = by, pz = bz;
    let inWater = concrete && FLUID[world.getState(bx, by, bz)] === 1;
    if (concrete && !inWater && e.vy * e.vy > 1) {
      // fast powder: clip from the previous position for a water source (ClipContext.Fluid.SOURCE_ONLY)
      for (let yy = Math.floor(e.yo); yy >= by; yy--) {
        const ws = world.getState(bx, yy, bz);
        if (FLUID[ws] === 1 && FLUID_LEVEL[ws] === 0) {
          py = yy;
          inWater = true;
          break;
        }
      }
    }
    if (!e.onGround && !inWater) {
      if ((e.time > 100 && (py < 1 || py > 256)) || e.time > 600) {
        if (e.dropItem) this.spawnAtLocation(e);
        e.removed = true;
      }
      return true;
    }
    if (e.onGround && e.hurtsEntities) this.anvilFallDamage(e);
    const here = world.getState(px, py, pz);
    e.vx *= 0.7;
    e.vy *= -0.5;
    e.vz *= 0.7;
    if (blockNameOf(here) === 'moving_piston') return true;
    e.removed = true;
    if (!e.dropItem && e.state === 0) return true;
    const canReplace = isReplaceable(here);
    const freeBelow = fallingIsFree(world.getState(px, py - 1, pz)) && (!concrete || !inWater);
    const survives = canSurvive(world, px, py, pz, e.state) && !freeBelow;
    if (canReplace && survives) {
      let st = e.state;
      if (getProp(st, 'waterlogged') !== undefined && FLUID[here] === 1 && FLUID_LEVEL[here] === 0) st = withProp(st, 'waterlogged', true);
      this.s.setBlock(px, py, pz, st);
      this.s.updateNeighbors(px, py, pz);
      // FallingBlock.onLand
      if (concrete && (FLUID[here] === 1 || touchesWater(world, px, py, pz))) this.s.setBlock(px, py, pz, defaultState(concreteOf(name)));
      if (name.endsWith('anvil')) this.s.playSound(null, 'block.anvil.land', 'block', px + 0.5, py + 0.5, pz + 0.5, 0.3, this.s.rand.nextFloat() * 0.1 + 0.9);
    } else if (e.dropItem) this.spawnAtLocation(e);
    return true;
  }

  /** FallingBlockEntity.causeFallDamage for anvils: hurt players inside, maybe chip the anvil. */
  private anvilFallDamage(e: FallingBlockEntity): void {
    const i = Math.ceil(e.fallDistance - 1);
    if (i < 0) return;
    const dmg = Math.min(Math.floor(i * e.fallDamagePerDistance), e.fallDamageMax);
    const bb = e.bb();
    for (const p of this.s.players) {
      if (p.gameMode === 3 || p.living.dead) continue;
      const pb = { minX: p.x - 0.3, maxX: p.x + 0.3, minY: p.y, maxY: p.y + 1.8, minZ: p.z - 0.3, maxZ: p.z + 0.3 };
      if (pb.maxX > bb.minX && pb.minX < bb.maxX && pb.maxY > bb.minY && pb.minY < bb.maxY && pb.maxZ > bb.minZ && pb.minZ < bb.maxZ) {
        this.s.survival.hurt(p, { id: 'anvil' }, dmg);
      }
    }
    if (dmg > 0 && this.s.rand.nextFloat() < 0.05 + i * 0.05) {
      // AnvilBlock.damage
      const n = blockNameOf(e.state);
      const next = n === 'anvil' ? 'chipped_anvil' : n === 'chipped_anvil' ? 'damaged_anvil' : null;
      if (next) e.state = stateOf(next, { facing: getProp(e.state, 'facing') as string });
      else {
        e.dropItem = false;
        e.state = 0;
        this.s.playSound(null, 'block.anvil.destroy', 'block', e.x, e.y, e.z, 1, this.s.rand.nextFloat() * 0.1 + 0.9);
      }
    }
  }

  /** Entity.spawnAtLocation(block item) */
  private spawnAtLocation(e: FallingBlockEntity): void {
    const id = itemForBlock(e.state);
    if (!id) return;
    this.spawnItem(e.x, e.y, e.z, { id, count: 1, damage: 0 });
  }

  private spawnItem(x: number, y: number, z: number, stack: ItemStack): void {
    const r = this.s.rand;
    const it = new ItemEntity(this.s.newEntityId(), stack);
    it.x = x;
    it.y = y;
    it.z = z;
    it.vx = r.nextDouble() * 0.2 - 0.1;
    it.vy = 0.2;
    it.vz = r.nextDouble() * 0.2 - 0.1;
    this.s.spawnEntity(it);
  }

  // ---------------------------------------------------------------- grass, crops, plants
  /** SpreadingSnowyDirtBlock.randomTick */
  private spreadGrass(x: number, y: number, z: number, name: string): void {
    const w = this.w;
    if (!canBeGrass(w, x, y, z)) {
      this.s.setBlock(x, y, z, defaultState('dirt'));
      return;
    }
    if (this.localBrightness(x, y + 1, z) < 9) return;
    const r = this.s.rand;
    const def = defaultState(name);
    for (let i = 0; i < 4; i++) {
      const px = x + r.nextInt(3) - 1, py = y + r.nextInt(5) - 3, pz = z + r.nextInt(3) - 1;
      if (blockNameOf(w.getState(px, py, pz)) === 'dirt' && canPropagateGrass(w, px, py, pz)) {
        this.s.setBlock(px, py, pz, withProp(def, 'snowy', blockNameOf(w.getState(px, py + 1, pz)) === 'snow'));
      }
    }
  }

  /** CropBlock.randomTick */
  private growCrop(x: number, y: number, z: number, st: number, n: string): void {
    if (this.rawBrightness(x, y, z) < 9) return;
    const age = getProp(st, 'age') as number;
    if (age >= CROP_MAX_AGE[n]!) return;
    const f = growthSpeed(this.w, x, y, z, n);
    if (this.s.rand.nextInt(growthChanceDenominator(f)) === 0) this.s.setBlock(x, y, z, withProp(st, 'age', age + 1));
  }

  private bambooSaplingGrow(x: number, y: number, z: number): void {
    this.s.setBlock(x, y + 1, z, stateOf('bamboo', { leaves: 'small' }));
    // BambooSaplingBlock.updateShape: a stalk above turns the shoot into bamboo
    this.s.setBlock(x, y, z, defaultState('bamboo'));
  }

  /** BambooBlock.getHeightBelowUpToMax */
  private bambooBelow(x: number, y: number, z: number): number {
    let i = 0;
    while (i < 16 && blockNameOf(this.w.getState(x, y - i - 1, z)) === 'bamboo') i++;
    return i;
  }
  private bambooAbove(x: number, y: number, z: number): number {
    let i = 0;
    while (i < 16 && blockNameOf(this.w.getState(x, y + i + 1, z)) === 'bamboo') i++;
    return i;
  }

  /** BambooBlock.growBamboo: a new top piece with leaves that shift down the stalk. */
  private growBamboo(x: number, y: number, z: number, st: number, height: number): void {
    const w = this.w;
    const below = w.getState(x, y - 1, z), below2 = w.getState(x, y - 2, z);
    const isB = (s0: number) => blockNameOf(s0) === 'bamboo';
    let leaves = 'none';
    if (height >= 1) {
      if (!isB(below) || getProp(below, 'leaves') === 'none') leaves = 'small';
      else {
        leaves = 'large';
        if (isB(below2)) {
          this.s.setBlock(x, y - 1, z, withProp(below, 'leaves', 'small'));
          this.s.setBlock(x, y - 2, z, withProp(below2, 'leaves', 'none'));
        }
      }
    }
    const age = getProp(st, 'age') !== 1 && !isB(below2) ? 0 : 1;
    const stage = (height < 11 || !(this.s.rand.nextFloat() < 0.25)) && height !== 15 ? 0 : 1;
    this.s.setBlock(x, y + 1, z, stateOf('bamboo', { age, leaves, stage }));
  }

  /** MushroomBlock.randomTick: creeps to a nearby dark spot (at most 5 within 4 blocks). */
  private spreadMushroom(x: number, y: number, z: number, st: number, n: string): void {
    const w = this.w, r = this.s.rand;
    if (r.nextInt(25) !== 0) return;
    let i = 5;
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -1; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) if (blockNameOf(w.getState(x + dx, y + dy, z + dz)) === n && --i <= 0) return;
    const ok = (px: number, py: number, pz: number) => {
      if (!IS_AIR[w.getState(px, py, pz)]) return false;
      // MushroomBlock.canSurvive: grow blocks always, otherwise dark and on a solid block
      const below = w.getState(px, py - 1, pz);
      const bn = blockNameOf(below);
      if (bn === 'mycelium' || bn === 'podzol' || bn === 'crimson_nylium' || bn === 'warped_nylium') return true;
      return this.rawBrightness(px, py, pz) < 13 && FULL_COLLISION[below] === 1;
    };
    let px = x, py = y, pz = z;
    let tx = px + r.nextInt(3) - 1, ty = py + r.nextInt(2) - r.nextInt(2), tz = pz + r.nextInt(3) - 1;
    for (let k = 0; k < 4; k++) {
      if (ok(tx, ty, tz)) [px, py, pz] = [tx, ty, tz];
      tx = px + r.nextInt(3) - 1;
      ty = py + r.nextInt(2) - r.nextInt(2);
      tz = pz + r.nextInt(3) - 1;
    }
    if (ok(tx, ty, tz)) this.s.setBlock(tx, ty, tz, st);
  }

  /** VineBlock.randomTick: spread sideways, up and down (1 in 4 ticks, at most 5 vines nearby). */
  private growVine(x: number, y: number, z: number, st: number): void {
    const w = this.w, r = this.s.rand;
    if (r.nextInt(4) !== 0) return;
    const d = r.nextInt(6);
    const dir = DIRS[d]!;
    const CW: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
    const CCW: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };
    const OPP: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
    const off = (name: string) => DIRS.indexOf(name as (typeof DIRS)[number]);
    const at = (px: number, py: number, pz: number) => w.getState(px, py, pz);
    // isAcceptableNeighbour: the block's face toward the vine is full
    const acceptable = (px: number, py: number, pz: number) => FULL_COLLISION[at(px, py, pz)] === 1;
    const vine = defaultState('vine');
    const setFace = (s0: number, face: string, v: boolean) => withProp(s0, face, v);
    const canSpread = () => {
      let i = 5;
      for (let dx = -4; dx <= 4; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -4; dz <= 4; dz++)
            if (blockNameOf(at(x + dx, y + dy, z + dz)) === 'vine' && --i <= 0) return false;
      return true;
    };
    const horizontal = (s0: number) => ['north', 'east', 'south', 'west'].some((f) => getProp(s0, f) === true);
    const step = (name: string): [number, number, number] => {
      const i = off(name);
      return [DX[i]!, DY[i]!, DZ[i]!];
    };
    if (d >= 2 && getProp(st, dir) !== true) {
      if (!canSpread()) return;
      const [ox, , oz] = step(dir);
      const sx = x + ox, sz = z + oz;
      const side = at(sx, y, sz);
      if (IS_AIR[side]) {
        const cw = CW[dir]!, ccw = CCW[dir]!;
        const cwOn = getProp(st, cw) === true, ccwOn = getProp(st, ccw) === true;
        const [cx2, , cz2] = step(cw), [qx, , qz] = step(ccw);
        if (cwOn && acceptable(sx + cx2, y, sz + cz2)) this.s.setBlock(sx, y, sz, setFace(vine, cw, true));
        else if (ccwOn && acceptable(sx + qx, y, sz + qz)) this.s.setBlock(sx, y, sz, setFace(vine, ccw, true));
        else {
          const opp = OPP[dir]!;
          if (cwOn && IS_AIR[at(sx + cx2, y, sz + cz2)] && acceptable(x + cx2, y, z + cz2)) this.s.setBlock(sx + cx2, y, sz + cz2, setFace(vine, opp, true));
          else if (ccwOn && IS_AIR[at(sx + qx, y, sz + qz)] && acceptable(x + qx, y, z + qz)) this.s.setBlock(sx + qx, y, sz + qz, setFace(vine, opp, true));
          else if (r.nextFloat() < 0.05 && acceptable(sx, y + 1, sz)) this.s.setBlock(sx, y, sz, setFace(vine, 'up', true));
        }
      } else if (acceptable(sx, y, sz)) this.s.setBlock(x, y, z, setFace(st, dir, true));
      return;
    }
    if (dir === 'up' && y < 255) {
      // canSupportAtFace(up)
      if (acceptable(x, y + 1, z)) {
        this.s.setBlock(x, y, z, setFace(st, 'up', true));
        return;
      }
      if (IS_AIR[at(x, y + 1, z)]) {
        if (!canSpread()) return;
        let ns = st;
        for (const f of ['north', 'east', 'south', 'west']) {
          const [ox, , oz] = step(f);
          if (r.nextBoolean() || !acceptable(x + ox, y + 1, z + oz)) ns = setFace(ns, f, false);
        }
        if (horizontal(ns)) this.s.setBlock(x, y + 1, z, ns);
        return;
      }
    }
    if (y > 0) {
      const below = at(x, y - 1, z);
      if (IS_AIR[below] || blockNameOf(below) === 'vine') {
        const start = IS_AIR[below] ? vine : below;
        let next = start;
        // copyRandomFaces
        for (const f of ['north', 'east', 'south', 'west']) if (r.nextBoolean() && getProp(st, f) === true) next = setFace(next, f, true);
        if (next !== start && horizontal(next)) this.s.setBlock(x, y - 1, z, next);
      }
    }
  }

  /** GrowingPlantHeadBlock.randomTick: kelp, weeping/twisting vines and cave vines extend by one. */
  private growHead(x: number, y: number, z: number, st: number, n: string): void {
    const h = GROWING_HEADS[n]!;
    const r = this.s.rand;
    const age = getProp(st, 'age') as number;
    if (age >= 25 || r.nextDouble() >= h.chance) return;
    const ty = y + h.dir;
    const target = this.w.getState(x, ty, z);
    const ok = n === 'kelp' ? FLUID[target] === 1 && FLUID_LEVEL[target] === 0 && blockNameOf(target) === 'water' : IS_AIR[target] === 1;
    if (!ok) return;
    let grown = withProp(st, 'age', Math.min(25, age + 1));
    if (n === 'cave_vines') grown = withProp(grown, 'berries', r.nextFloat() < 0.11);
    this.s.setBlock(x, ty, z, grown);
    // the old head becomes a body piece (GrowingPlantHeadBlock.updateShape)
    let body = defaultState(h.body);
    if (n === 'cave_vines') body = withProp(body, 'berries', getProp(st, 'berries') as boolean);
    this.s.setBlock(x, y, z, body);
  }

  /**
   * GrowingPlantHeadBlock.performBonemeal (a body piece forwards to its head): kelp grows 1, nether
   * vines a geometric number of pieces (×0.826 per extra).
   */
  private boneMealHead(x: number, y: number, z: number, n: string): boolean {
    const w = this.w, r = this.s.rand;
    const headName = GROWING_BODIES[n] ?? n;
    const h = GROWING_HEADS[headName]!;
    let hy = y;
    if (n in GROWING_BODIES) {
      // GrowingPlantBodyBlock.getHeadPos: follow the stem to its head
      while (blockNameOf(w.getState(x, hy, z)) === n) hy += h.dir;
      if (blockNameOf(w.getState(x, hy, z)) !== headName) return false;
    }
    const head = w.getState(x, hy, z);
    const canGrow = (s0: number) => (headName === 'kelp' ? blockNameOf(s0) === 'water' && getProp(s0, 'level') === 0 : IS_AIR[s0] === 1);
    if (!canGrow(w.getState(x, hy + h.dir, z))) return false;
    let count = 1;
    if (headName !== 'kelp') {
      count = 0;
      for (let d = 1; r.nextDouble() < d; d *= 0.826) count++;
    }
    let age = Math.min((getProp(head, 'age') as number) + 1, 25);
    let py = hy + h.dir;
    for (let k = 0; k < count && canGrow(w.getState(x, py, z)); k++) {
      this.s.setBlock(x, py - h.dir, z, defaultState(h.body));
      this.s.setBlock(x, py, z, withProp(head, 'age', age));
      py += h.dir;
      age = Math.min(age + 1, 25);
    }
    return true;
  }

  /** SugarCaneBlock / CactusBlock.randomTick: age 0–15, up to 3 tall. */
  private growColumn(x: number, y: number, z: number, st: number, n: string): void {
    const w = this.w;
    if (!IS_AIR[w.getState(x, y + 1, z)]) return;
    let i = 1;
    while (blockNameOf(w.getState(x, y - i, z)) === n) i++;
    if (i >= 3) return;
    const age = getProp(st, 'age') as number;
    if (age === 15) {
      this.s.setBlock(x, y + 1, z, defaultState(n));
      this.s.setBlock(x, y, z, withProp(st, 'age', 0));
      // the new piece checks its survival (CactusBlock: neighborChanged)
      const top = w.getState(x, y + 1, z);
      if (!canSurvive(w, x, y + 1, z, top)) this.breakNaturally(x, y + 1, z, true);
    } else this.s.setBlock(x, y, z, withProp(st, 'age', age + 1));
  }

  /** StemBlock.randomTick: grow to age 7, then place the fruit on a random side. */
  private growStem(x: number, y: number, z: number, st: number, n: string): void {
    const w = this.w;
    if (this.rawBrightness(x, y, z) < 9) return;
    const r = this.s.rand;
    const f = growthSpeed(w, x, y, z, n);
    if (r.nextInt(growthChanceDenominator(f)) !== 0) return;
    const age = getProp(st, 'age') as number;
    if (age < 7) {
      this.s.setBlock(x, y, z, withProp(st, 'age', age + 1));
      return;
    }
    // Direction.Plane.HORIZONTAL.getRandomDirection: north, east, south, west
    const dir = (['north', 'east', 'south', 'west'] as const)[r.nextInt(4)]!;
    const d = DIRS.indexOf(dir);
    const px = x + DX[d]!, pz = z + DZ[d]!;
    const below = blockNameOf(w.getState(px, y - 1, pz));
    const soil = below === 'farmland' || ['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'mycelium', 'rooted_dirt', 'moss_block'].includes(below);
    if (IS_AIR[w.getState(px, y, pz)] && soil) {
      const [fruit, attached] = STEM_FRUIT[n]!;
      this.s.setBlock(px, y, pz, defaultState(fruit));
      this.s.setBlock(x, y, z, stateOf(attached, { facing: dir }));
    }
  }

  /** FarmBlock.randomTick: moisture 7 near water or in rain, otherwise dries out, then reverts to dirt. */
  private farmlandTick(x: number, y: number, z: number, st: number): void {
    const m = getProp(st, 'moisture') as number;
    const rain = this.s.isRaining() && this.w.getSkyLight(x, y + 1, z) === 15 && this.isRainingAt(x, y + 1, z);
    if (!farmlandNearWater(this.w, x, y, z) && !rain) {
      if (m > 0) this.s.setBlock(x, y, z, withProp(st, 'moisture', m - 1));
      else if (!maintainsFarmland(this.w.getState(x, y + 1, z))) this.turnToDirt(x, y, z);
    } else if (m < 7) this.s.setBlock(x, y, z, withProp(st, 'moisture', 7));
  }

  private isRainingAt(x: number, y: number, z: number): boolean {
    const c = this.w.getChunk(x >> 4, z >> 4);
    return !!c && c.motionBlocking[(z & 15) * 16 + (x & 15)]! <= y;
  }

  /** FarmBlock.turnToDirt (pushing standing players up onto the full block). */
  turnToDirt(x: number, y: number, z: number): void {
    this.s.setBlock(x, y, z, defaultState('dirt'));
    this.s.updateNeighbors(x, y, z);
    for (const p of this.s.players) {
      if (Math.abs(p.x - (x + 0.5)) < 0.8 && Math.abs(p.z - (z + 0.5)) < 0.8 && p.y >= y + 0.5 && p.y < y + 1) {
        p.y = y + 1;
        this.s.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
      }
    }
  }

  /** Block.fallOn for the block under a landing player (farmland trampling). */
  fallOn(p: ServerPlayer, fallDistance: number): void {
    const x = Math.floor(p.x), y = Math.floor(p.y - 0.2), z = Math.floor(p.z);
    const st = this.w.getState(x, y, z);
    if (blockNameOf(st) !== 'farmland') return;
    // FarmBlock.fallOn: random < distance − 0.5, living entity with width²·height > 0.512 (players 0.648)
    if (this.s.rand.nextFloat() < fallDistance - 0.5) this.turnToDirt(x, y, z);
  }

  // ---------------------------------------------------------------- saplings and trees
  /** SaplingBlock.advanceTree */
  advanceTree(x: number, y: number, z: number, st: number): void {
    if (getProp(st, 'stage') === 0) this.s.setBlock(x, y, z, withProp(st, 'stage', 1));
    else this.growTree(x, y, z, st);
  }

  /** AbstractTreeGrower.growTree / AbstractMegaTreeGrower.growTree */
  growTree(x: number, y: number, z: number, st: number): boolean {
    const w = this.w;
    const n = blockNameOf(st);
    const r = this.s.rand;
    if (MEGA_SAPLINGS.has(n)) {
      const off = megaOffset(w, x, y, z, n);
      if (off) {
        const feat = treeForSapling(n, r, false, true);
        if (!feat) return false;
        const [i, j] = off;
        const cells: [number, number][] = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
        const saved = cells.map(([a, b]) => w.getState(x + a, y, z + b));
        for (const [a, b] of cells) this.s.setBlock(x + a, y, z + b, 0);
        if (this.placeFeature(feat, x + i, y, z + j)) return true;
        cells.forEach(([a, b], k) => this.s.setBlock(x + a, y, z + b, saved[k]!));
        return false;
      }
    }
    const feat = treeForSapling(n, r, hasFlowersNear(w, x, y, z), false);
    if (!feat) return false;
    this.s.setBlock(x, y, z, 0);
    if (this.placeFeature(feat, x, y, z)) return true;
    this.s.setBlock(x, y, z, st);
    return false;
  }

  placeFeature(id: string, x: number, y: number, z: number): boolean {
    let place;
    try {
      place = configuredFeature(id);
    } catch {
      // feature parts not built yet (e.g. the azalea tree's bending trunk): nothing grows
      return false;
    }
    return place(new ServerGenLevel(this.s), this.s.rand, x, y, z);
  }

  // ---------------------------------------------------------------- bone meal
  /** BoneMealItem.growCrop for the clicked block; true when it was a valid target (item used). */
  boneMeal(x: number, y: number, z: number): boolean {
    const w = this.w;
    const st = w.getState(x, y, z);
    const n = blockNameOf(st);
    const r = this.s.rand;
    if (n in CROP_MAX_AGE) {
      const age = getProp(st, 'age') as number, max = CROP_MAX_AGE[n]!;
      if (age >= max) return false;
      this.s.setBlock(x, y, z, withProp(st, 'age', Math.min(max, age + bonemealAgeIncrease(n, r))));
    } else if (n in STEM_FRUIT) {
      const age = getProp(st, 'age') as number;
      if (age === 7) return false;
      const na = Math.min(7, age + 2 + r.nextInt(4));
      const ns = withProp(st, 'age', na);
      this.s.setBlock(x, y, z, ns);
      if (na === 7) this.growStem(x, y, z, ns, n);
    } else if (isTreeSapling(n)) {
      // SaplingBlock.isBonemealSuccess: 45%
      if (r.nextFloat() < 0.45) this.advanceTree(x, y, z, st);
    } else if (n === 'grass_block') {
      if (!IS_AIR[w.getState(x, y + 1, z)]) return false;
      this.boneMealGrass(x, y, z, st);
    } else if (n === 'grass' || n === 'fern') {
      // TallGrassBlock: grows into the double plant when there's room
      const tall = defaultState(n === 'fern' ? 'large_fern' : 'tall_grass');
      if (!IS_AIR[w.getState(x, y + 1, z)] || !canSurvive(w, x, y, z, withProp(tall, 'half', 'lower'))) return false;
      this.placeDouble(x, y, z, tall);
    } else if (n === 'azalea' || n === 'flowering_azalea') {
      // AzaleaBlock: 45%, grows an azalea tree
      if (r.nextFloat() < 0.45) this.growTree(x, y, z, st);
    } else if (n === 'bamboo' || n === 'bamboo_sapling') {
      if (n === 'bamboo_sapling') {
        if (!IS_AIR[w.getState(x, y + 1, z)]) return false;
        this.bambooSaplingGrow(x, y, z);
      } else {
        // BambooBlock.performBonemeal: 1–2 pieces on top
        let j = this.bambooAbove(x, y, z);
        let l = j + this.bambooBelow(x, y, z) + 1;
        const topNow = w.getState(x, y + j, z);
        if (l >= 16 || getProp(topNow, 'stage') === 1 || !IS_AIR[w.getState(x, y + j + 1, z)]) return false;
        const m = 1 + r.nextInt(2);
        for (let k = 0; k < m; k++) {
          const top = w.getState(x, y + j, z);
          if (l >= 16 || getProp(top, 'stage') === 1 || !IS_AIR[w.getState(x, y + j + 1, z)]) break;
          this.growBamboo(x, y + j, z, top, l);
          j++;
          l++;
        }
      }
    } else if (n === 'seagrass') {
      // SeagrassBlock: grows tall when water is above
      const above = w.getState(x, y + 1, z);
      if (!(blockNameOf(above) === 'water' && getProp(above, 'level') === 0)) return false;
      this.s.setBlock(x, y, z, stateOf('tall_seagrass', { half: 'lower' }));
      this.s.setBlock(x, y + 1, z, stateOf('tall_seagrass', { half: 'upper' }));
    } else if (n === 'rooted_dirt') {
      // RootedDirtBlock: hanging roots underneath
      const below = w.getState(x, y - 1, z);
      if (!IS_AIR[below]) return false;
      this.s.setBlock(x, y - 1, z, defaultState('hanging_roots'));
    } else if ((n in GROWING_HEADS || n in GROWING_BODIES) && n !== 'cave_vines' && n !== 'cave_vines_plant') {
      if (!this.boneMealHead(x, y, z, n)) return false;
    } else if (n === 'sweet_berry_bush' || n === 'cocoa') {
      const age = getProp(st, 'age') as number;
      if (age >= (n === 'cocoa' ? 2 : 3)) return false;
      this.s.setBlock(x, y, z, withProp(st, 'age', age + 1));
    } else if (n === 'cave_vines' || n === 'cave_vines_plant') {
      if (getProp(st, 'berries') === true) return false;
      this.s.setBlock(x, y, z, withProp(st, 'berries', true));
    } else if (TALL_FLOWERS.has(n)) {
      // TallFlowerBlock: pops a copy of itself
      this.s.popResource(x, y, z, { id: itemForBlock(st), count: 1, damage: 0 });
    } else return false;
    for (const o of this.s.players) this.s.send(o, { t: 'levelEvent', event: 1505, x, y, z, data: 0 });
    return true;
  }

  private placeDouble(x: number, y: number, z: number, tall: number): void {
    this.s.setBlock(x, y, z, withProp(tall, 'half', 'lower'));
    this.s.setBlock(x, y + 1, z, withProp(tall, 'half', 'upper'));
  }

  /** GrassBlock.performBonemeal: 128 random walks scattering grass and the biome's flowers. */
  private boneMealGrass(x: number, y: number, z: number, self: number): void {
    const w = this.w;
    const r = this.s.rand;
    const grass = defaultState('grass');
    const selfId = blockIdOf(self);
    outer: for (let i = 0; i < 128; i++) {
      let px = x, py = y + 1, pz = z;
      for (let j = 0; j < i / 16; j++) {
        px += r.nextInt(3) - 1;
        py += Math.trunc(((r.nextInt(3) - 1) * r.nextInt(3)) / 2);
        pz += r.nextInt(3) - 1;
        if (blockIdOf(w.getState(px, py - 1, pz)) !== selfId || FULL_COLLISION[w.getState(px, py, pz)] === 1) continue outer;
      }
      const s = w.getState(px, py, pz);
      if (blockNameOf(s) === 'grass' && r.nextInt(10) === 0) {
        if (IS_AIR[w.getState(px, py + 1, pz)]) this.placeDouble(px, py, pz, defaultState('tall_grass'));
      }
      if (IS_AIR[s]) {
        let place: number;
        if (r.nextInt(8) === 0) {
          const prov = this.flowerProvider(w.getBiome(px, py, pz));
          if (!prov) continue;
          place = prov(r, px, py, pz);
        } else place = grass;
        if (canSurvive(w, px, py, pz, place)) this.s.setBlock(px, py, pz, place);
      }
    }
  }

  /** BiomeGenerationSettings.getFlowerFeatures().get(0)'s state provider. */
  private flowerProvider(biome: number): StateProvider | null {
    if (this.flowerProviders.has(biome)) return this.flowerProviders.get(biome)!;
    const name = BIOMES.find((b) => b.id === biome)?.name;
    const bw = name ? WORLDGEN.biomes[name] : undefined;
    let found: StateProvider | null = null;
    type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const resolve = (f: J): J => (typeof f === 'string' ? WORLDGEN.configured_features[f.replace('minecraft:', '')] : f);
    const search = (f: J): J => {
      const j = resolve(f);
      if (!j) return null;
      if (j.type === 'minecraft:flower') return j;
      const c = j.config ?? {};
      for (const sub of [c.feature, c.default, c.feature_true, c.feature_false, ...(c.features ?? []).map((e: J) => e.feature ?? e)]) {
        if (!sub) continue;
        const hit = search(sub);
        if (hit) return hit;
      }
      return null;
    };
    if (bw) {
      for (const step of bw.features) {
        for (const f of step) {
          const hit = search(f);
          if (hit) {
            found = stateProvider(hit.config.state_provider);
            break;
          }
        }
        if (found) break;
      }
    }
    this.flowerProviders.set(biome, found);
    return found;
  }

  // ---------------------------------------------------------------- using items and blocks
  /** Item.useOn for tools and bone meal; true when the item did something. */
  useItemOn(p: ServerPlayer, slot: number, held: ItemStack, x: number, y: number, z: number, face: number): boolean {
    const item = ITEMS_BY_ID[held.id]?.name ?? '';
    const w = this.w;
    const st = w.getState(x, y, z);
    const n = blockNameOf(st);
    const r = this.s.rand;
    if (item === 'bone_meal') {
      if (!this.boneMeal(x, y, z)) return false;
      if (p.gameMode !== 1) this.shrink(p, slot, held);
      return true;
    }
    if (item.endsWith('_hoe')) {
      // HoeItem.TILLABLES
      const airAbove = face !== 0 && IS_AIR[w.getState(x, y + 1, z)] === 1;
      let to: number | null = null;
      if ((n === 'grass_block' || n === 'dirt_path' || n === 'dirt') && airAbove) to = defaultState('farmland');
      else if (n === 'coarse_dirt' && airAbove) to = defaultState('dirt');
      else if (n === 'rooted_dirt') to = defaultState('dirt');
      if (to === null) return false;
      this.s.playSound(null, 'item.hoe.till', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      this.s.setBlock(x, y, z, to);
      this.s.updateNeighbors(x, y, z);
      if (n === 'rooted_dirt') {
        // popResourceFromFace
        const ox = DX[face]!, oy = DY[face]!, oz = DZ[face]!;
        this.spawnItem(x + 0.5 + (ox === 0 ? r.nextDouble() * 0.5 - 0.25 : ox * 0.625), y + 0.5 + (oy === 0 ? r.nextDouble() * 0.5 - 0.25 : oy * 0.625) - 0.125, z + 0.5 + (oz === 0 ? r.nextDouble() * 0.5 - 0.25 : oz * 0.625), { id: itemForBlock(defaultState('hanging_roots')), count: 1, damage: 0 });
      }
      this.hurtTool(p, slot, held);
      return true;
    }
    if (item.endsWith('_shovel')) {
      // ShovelItem: flatten to a path
      if (face === 0 || !FLATTENABLE.has(n) || !IS_AIR[w.getState(x, y + 1, z)]) return false;
      this.s.playSound(null, 'item.shovel.flatten', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      this.s.setBlock(x, y, z, defaultState('dirt_path'));
      this.s.updateNeighbors(x, y, z);
      this.hurtTool(p, slot, held);
      return true;
    }
    if (item.endsWith('_axe')) {
      const to = STRIPPABLE[n];
      if (!to) return false;
      this.s.playSound(null, 'item.axe.strip', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      this.s.setBlock(x, y, z, stateOf(to, { axis: getProp(st, 'axis') as string }));
      this.hurtTool(p, slot, held);
      return true;
    }
    return false;
  }

  private shrink(p: ServerPlayer, slot: number, held: ItemStack): void {
    held.count--;
    if (held.count <= 0) p.inventory.set(slot, null);
    this.s.syncSlot(p, slot);
  }

  /** ItemStack.hurtAndBreak(1): survival only. */
  private hurtTool(p: ServerPlayer, slot: number, held: ItemStack): void {
    if (p.gameMode === 1) return;
    const max = ITEMS_BY_ID[held.id]?.maxDurability ?? 0;
    if (max > 0) {
      held.damage++;
      if (held.damage >= max) {
        p.inventory.set(slot, null);
        this.s.playSound(null, 'entity.item.break', 'player', p.x, p.y, p.z, 0.8, 0.8 + this.s.rand.nextFloat() * 0.4);
      }
    }
    this.s.syncSlot(p, slot);
  }

  /** BlockState.use for doors, trapdoors and fence gates; true when the click was consumed. */
  use(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const w = this.w;
    const st = w.getState(x, y, z);
    const n = blockNameOf(st);
    const r = this.s.rand;
    if (n === 'dragon_egg') return this.teleportEgg(x, y, z, st);
    if (n === 'sweet_berry_bush') {
      // SweetBerryBushBlock.use: bone meal on an unripe bush passes through to the item
      const age = getProp(st, 'age') as number;
      const held = p.inventory.selectedStack;
      if (age !== 3 && held && ITEMS_BY_ID[held.id]?.name === 'bone_meal') return false;
      if (age <= 1) return false;
      const j = 1 + r.nextInt(2);
      this.s.popResource(x, y, z, { id: itemForBlock(st), count: j + (age === 3 ? 1 : 0), damage: 0 });
      this.s.playSound(null, 'block.sweet_berry_bush.pick_berries', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 0.8 + r.nextFloat() * 0.4);
      this.s.setBlock(x, y, z, withProp(st, 'age', 1));
      return true;
    }
    if ((n === 'cave_vines' || n === 'cave_vines_plant') && getProp(st, 'berries') === true) {
      // CaveVines.use
      this.s.popResource(x, y, z, { id: itemForBlock(st), count: 1, damage: 0 });
      this.s.playSound(null, 'block.cave_vines.pick_berries', 'block', x + 0.5, y + 0.5, z + 0.5, 1, 0.8 + r.nextFloat() * 0.4);
      this.s.setBlock(x, y, z, withProp(st, 'berries', false));
      return true;
    }
    // doors, trapdoors, fence gates (the clicking client predicts the change; everyone hears it)
    const o = useOpenable(w, x, y, z, p.yaw);
    if (o) {
      for (const c of o.changes) this.s.setBlock(c.x, c.y, c.z, c.state);
      this.s.playSound(null, o.sound, 'block', x + 0.5, y + 0.5, z + 0.5, 1, r.nextFloat() * 0.1 + 0.9);
      return true;
    }
    return false;
  }

  /** Block.attack (left click in survival/adventure): the dragon egg teleports away. */
  attack(x: number, y: number, z: number): boolean {
    const st = this.w.getState(x, y, z);
    return blockNameOf(st) === 'dragon_egg' && this.teleportEgg(x, y, z, st);
  }

  /** DragonEggBlock.teleport: up to 1000 tries for an air block within ±15 / ±7. */
  private teleportEgg(x: number, y: number, z: number, st: number): boolean {
    const r = this.s.rand;
    for (let i = 0; i < 1000; i++) {
      const px = x + r.nextInt(16) - r.nextInt(16), py = y + r.nextInt(8) - r.nextInt(8), pz = z + r.nextInt(16) - r.nextInt(16);
      // (vanilla also accepts positions outside the build height and loses the egg; we keep it)
      if (py < 0 || py > 255 || !IS_AIR[this.w.getState(px, py, pz)] || !this.w.isLoaded(px, pz)) continue;
      this.s.setBlock(px, py, pz, st);
      this.s.setBlock(x, y, z, 0);
      this.s.updateNeighbors(x, y, z);
      return true;
    }
    return true;
  }

  /** /gamerule randomTickSpeed <n>; true when handled. */
  command(args: string[]): boolean {
    if (args[0] === 'gamerule' && args[1] === 'randomTickSpeed' && args[2] !== undefined && Number.isFinite(Number(args[2]))) {
      this.randomTickSpeed = Math.max(0, Math.floor(Number(args[2])));
      return true;
    }
    return false;
  }
}

function isTreeSapling(n: string): boolean {
  return n.endsWith('_sapling') && n !== 'bamboo_sapling';
}
