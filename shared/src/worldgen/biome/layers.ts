/**
 * The 1.13–1.17 overworld biome layer stack (vanilla Layers.getDefaultLayer): continents zoomed and
 * eroded, climate zones, biome picks, edges, hills and mutations, shores, rivers and ocean
 * temperatures, ending at a 1:4 ("quart") resolution map. Each layer is evaluated per pixel the way
 * vanilla's AreaTransformers are, with a small cache. The pixel rules follow Cubitect's cubiomes
 * (MIT, licenses/cubiomes.txt), which is verified against vanilla output.
 */
import { H, L, step, stepInt, floorModShift24, splitBig } from './lcg';
import { ImprovedNoise } from '../../util/noise';
import { JavaRandom } from '../../util/random';
import { B, isOceanic, isShallowOcean, isDeepOcean, areSimilar, getMutated, category, isSnowy, isMesa } from './biomeids';

// climate values used before biomes are picked
const OCEANIC = 0, WARM = 1, LUSH = 2, COLD = 3, FREEZING = 4;

/** Per-layer seeds (cubiomes setLayerSeed): startSalt and startSeed from the world seed and salt. */
class Seeds {
  saltH = 0; saltL = 0; seedH = 0; seedL = 0;
  constructor(worldSeed: bigint, salt: number) {
    // layer salt = mix(salt, salt) three times
    stepInt(0, salt, salt); stepInt(H, L, salt); stepInt(H, L, salt);
    const lsH = H, lsL = L;
    const [wh, wl] = splitBig(worldSeed);
    step(wh, wl, lsH, lsL); step(H, L, lsH, lsL); step(H, L, lsH, lsL);
    this.saltH = H; this.saltL = L;
    step(H, L, 0, 0);
    this.seedH = H; this.seedL = L;
  }
}

/** The per-pixel random (vanilla LazyAreaContext.initRandom / nextRandom). */
class Rand {
  private h = 0;
  private l = 0;
  constructor(private s: Seeds) {}
  init(x: number, z: number): this {
    const s = this.s;
    // getChunkSeed: (startSeed + x), then mix z, x, z
    const lo = (s.seedL >>> 0) + (x >>> 0);
    let h = (s.seedH + (x < 0 ? -1 : 0) + (lo > 0xffffffff ? 1 : 0)) | 0;
    let l = lo >>> 0;
    stepInt(h, l, z); h = H; l = L;
    stepInt(h, l, x); h = H; l = L;
    stepInt(h, l, z);
    this.h = H; this.l = L;
    return this;
  }
  next(bound: number): number {
    const r = floorModShift24(this.h, this.l, bound);
    step(this.h, this.l, this.s.saltH, this.s.saltL);
    this.h = H; this.l = L;
    return r;
  }
}

/** A layer: an integer map sampled per pixel, with a direct-mapped cache. */
export abstract class Layer {
  private readonly cx = new Int32Array(4096);
  private readonly cz = new Int32Array(4096);
  private readonly cv = new Int32Array(4096).fill(-2147483648);
  get(x: number, z: number): number {
    const i = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) >>> 20;
    if (this.cv[i] !== -2147483648 && this.cx[i] === x && this.cz[i] === z) return this.cv[i]!;
    const v = this.compute(x, z);
    this.cx[i] = x; this.cz[i] = z; this.cv[i] = v;
    return v;
  }
  protected abstract compute(x: number, z: number): number;
}

abstract class Seeded extends Layer {
  protected readonly r: Rand;
  constructor(seed: bigint, salt: number, protected readonly p: Layer) {
    super();
    this.r = new Rand(new Seeds(seed, salt));
  }
}

class Continent extends Layer {
  private readonly r: Rand;
  constructor(seed: bigint, salt: number) {
    super();
    this.r = new Rand(new Seeds(seed, salt));
  }
  protected compute(x: number, z: number): number {
    if (x === 0 && z === 0) return 1;
    return this.r.init(x, z).next(10) === 0 ? 1 : 0;
  }
}

/** ZoomLayer (NORMAL picks the mode of four, FUZZY a random one). */
class Zoom extends Seeded {
  constructor(seed: bigint, salt: number, p: Layer, private readonly fuzzy = false) {
    super(seed, salt, p);
  }
  protected compute(x: number, z: number): number {
    const px = x >> 1, pz = z >> 1;
    const v00 = this.p.get(px, pz);
    const ix = x & 1, iz = z & 1;
    if (ix === 0 && iz === 0) return v00;
    const r = this.r.init(px << 1, pz << 1);
    const v01 = this.p.get(px, pz + 1);
    const a = r.next(2) === 0 ? v00 : v01;
    if (ix === 0) return a;
    const v10 = this.p.get(px + 1, pz);
    const b = r.next(2) === 0 ? v00 : v10;
    if (iz === 0) return b;
    const v11 = this.p.get(px + 1, pz + 1);
    if (this.fuzzy) return pick4(r.next(4), v00, v10, v01, v11);
    return modeOrRandom(r, v00, v10, v01, v11);
  }
}

function pick4(i: number, a: number, b: number, c: number, d: number): number {
  return i === 0 ? a : i === 1 ? b : i === 2 ? c : d;
}

function modeOrRandom(r: Rand, a: number, b: number, c: number, d: number): number {
  if (b === c && c === d) return b;
  if (a === b && a === c) return a;
  if (a === b && a === d) return a;
  if (a === c && a === d) return a;
  if (a === b && c !== d) return a;
  if (a === c && b !== d) return a;
  if (a === d && b !== c) return a;
  if (b === c && a !== d) return b;
  if (b === d && a !== c) return b;
  if (c === d && a !== b) return c;
  return pick4(r.next(4), a, b, c, d);
}

/** AddIslandLayer (cubiomes mapLand): coasts grow and erode using the diagonal neighbours. */
class AddIsland extends Seeded {
  protected compute(x: number, z: number): number {
    const p = this.p;
    const v00 = p.get(x - 1, z - 1), v20 = p.get(x + 1, z - 1), v02 = p.get(x - 1, z + 1), v22 = p.get(x + 1, z + 1);
    const v11 = p.get(x, z);
    if (v11 === 0) {
      if (!(v00 || v20 || v02 || v22)) return 0;
      const r = this.r.init(x, z);
      let inc = 0, v = 1;
      for (const n of [v00, v20, v02, v22]) {
        if (n === 0) continue;
        inc++;
        if (r.next(inc) === 0) v = n;
      }
      if (r.next(3) === 0) return v;
      return v === 4 ? 4 : 0;
    }
    if (v11 === 4) return 4;
    if (v00 === 0 || v20 === 0 || v02 === 0 || v22 === 0) {
      if (this.r.init(x, z).next(5) === 0) return 0;
    }
    return v11;
  }
}

/** RemoveTooMuchOceanLayer (mapIsland). */
class RemoveTooMuchOcean extends Seeded {
  protected compute(x: number, z: number): number {
    const p = this.p, v = p.get(x, z);
    if (v !== OCEANIC) return v;
    if (p.get(x, z - 1) !== 0 || p.get(x + 1, z) !== 0 || p.get(x - 1, z) !== 0 || p.get(x, z + 1) !== 0) return v;
    return this.r.init(x, z).next(2) === 0 ? 1 : v;
  }
}

/** AddSnowLayer (mapSnow): land becomes warm (4/6), cold (1/6) or freezing (1/6). */
class AddSnow extends Seeded {
  protected compute(x: number, z: number): number {
    const v = this.p.get(x, z);
    if (isShallowOcean(v)) return v;
    const r = this.r.init(x, z).next(6);
    return r === 0 ? FREEZING : r <= 1 ? COLD : WARM;
  }
}

function any4(id: number, a: number, b: number, c: number, d: number): boolean {
  return a === id || b === id || c === id || d === id;
}

/** AddEdgeLayer.CoolWarm (mapCool) and HeatIce (mapHeat): no randomness. */
class ClimateEdge extends Layer {
  constructor(private readonly p: Layer, private readonly heat: boolean) {
    super();
  }
  protected compute(x: number, z: number): number {
    const p = this.p, v = p.get(x, z);
    const a = p.get(x, z - 1), b = p.get(x + 1, z), c = p.get(x - 1, z), d = p.get(x, z + 1);
    if (!this.heat && v === WARM && (any4(COLD, a, b, c, d) || any4(FREEZING, a, b, c, d))) return LUSH;
    if (this.heat && v === FREEZING && (any4(WARM, a, b, c, d) || any4(LUSH, a, b, c, d))) return COLD;
    return v;
  }
}

/** AddEdgeLayer.IntroduceSpecial (mapSpecial): marks 1/13 of land as a special variant. */
class IntroduceSpecial extends Seeded {
  protected compute(x: number, z: number): number {
    let v = this.p.get(x, z);
    if (v === OCEANIC) return v;
    const r = this.r.init(x, z);
    if (r.next(13) === 0) v |= ((1 + r.next(15)) << 8) & 0xf00;
    return v;
  }
}

/** AddMushroomIslandLayer: 1% of ocean pixels whose diagonals are ocean. */
class AddMushroomIsland extends Seeded {
  protected compute(x: number, z: number): number {
    const p = this.p, v = p.get(x, z);
    if (v === 0 && !p.get(x - 1, z - 1) && !p.get(x + 1, z - 1) && !p.get(x - 1, z + 1) && !p.get(x + 1, z + 1)) {
      if (this.r.init(x, z).next(100) === 0) return B.mushroom_fields;
    }
    return v;
  }
}

/** AddDeepOceanLayer (mapDeepOcean): shallow ocean surrounded by shallow ocean deepens. */
class AddDeepOcean extends Layer {
  constructor(private readonly p: Layer) {
    super();
  }
  protected compute(x: number, z: number): number {
    const p = this.p, v = p.get(x, z);
    if (!isShallowOcean(v)) return v;
    let n = 0;
    if (isShallowOcean(p.get(x, z - 1))) n++;
    if (isShallowOcean(p.get(x + 1, z))) n++;
    if (isShallowOcean(p.get(x - 1, z))) n++;
    if (isShallowOcean(p.get(x, z + 1))) n++;
    if (n < 4) return v;
    switch (v) {
      case B.warm_ocean: return B.deep_warm_ocean;
      case B.lukewarm_ocean: return B.deep_lukewarm_ocean;
      case B.cold_ocean: return B.deep_cold_ocean;
      case B.frozen_ocean: return B.deep_frozen_ocean;
      default: return B.deep_ocean;
    }
  }
}

const WARM_BIOMES = [B.desert, B.desert, B.desert, B.savanna, B.savanna, B.plains];
const LUSH_BIOMES = [B.forest, B.dark_forest, B.mountains, B.plains, B.birch_forest, B.swamp];
const COLD_BIOMES = [B.forest, B.mountains, B.taiga, B.plains];
const SNOW_BIOMES = [B.snowy_tundra, B.snowy_tundra, B.snowy_tundra, B.snowy_taiga];

/** BiomeInitLayer (mapBiome): climate → biome, special variants → plateaus/jungle/giant taiga. */
class BiomeInit extends Seeded {
  protected compute(x: number, z: number): number {
    const raw = this.p.get(x, z);
    const special = (raw & 0xf00) !== 0;
    const id = raw & ~0xf00;
    if (isOceanic(id) || id === B.mushroom_fields) return id;
    const r = this.r.init(x, z);
    switch (id) {
      case WARM: return special ? (r.next(3) === 0 ? B.badlands_plateau : B.wooded_badlands_plateau) : WARM_BIOMES[r.next(6)]!;
      case LUSH: return special ? B.jungle : LUSH_BIOMES[r.next(6)]!;
      case COLD: return special ? B.giant_tree_taiga : COLD_BIOMES[r.next(4)]!;
      case FREEZING: return SNOW_BIOMES[r.next(4)]!;
      default: return B.mushroom_fields;
    }
  }
}

/** AddBambooForestLayer: 10% of jungle becomes bamboo jungle. */
class AddBamboo extends Seeded {
  protected compute(x: number, z: number): number {
    const v = this.p.get(x, z);
    if (v !== B.jungle) return v;
    return this.r.init(x, z).next(10) === 0 ? B.bamboo_jungle : v;
  }
}

/** BiomeEdgeLayer (mapBiomeEdge). */
class BiomeEdge extends Layer {
  constructor(private readonly p: Layer) {
    super();
  }
  protected compute(x: number, z: number): number {
    const p = this.p, v = p.get(x, z);
    const a = p.get(x, z - 1), b = p.get(x + 1, z), c = p.get(x - 1, z), d = p.get(x, z + 1);
    const edge = (base: number, edgeId: number): number | null => {
      if (v !== base) return null;
      return areSimilar(a, base) && areSimilar(b, base) && areSimilar(c, base) && areSimilar(d, base) ? v : edgeId;
    };
    const e = edge(B.wooded_badlands_plateau, B.badlands) ?? edge(B.badlands_plateau, B.badlands) ?? edge(B.giant_tree_taiga, B.taiga);
    if (e !== null) return e;
    if (v === B.desert) return any4(B.snowy_tundra, a, b, c, d) ? B.wooded_mountains : v;
    if (v === B.swamp) {
      if (any4(B.desert, a, b, c, d) || any4(B.snowy_taiga, a, b, c, d) || any4(B.snowy_tundra, a, b, c, d)) return B.plains;
      if (any4(B.jungle, a, b, c, d) || any4(B.bamboo_jungle, a, b, c, d)) return B.jungle_edge;
    }
    return v;
  }
}

/** RiverInitLayer (mapNoise): random values for land, the source of rivers and hill variants. */
class RiverInit extends Seeded {
  protected compute(x: number, z: number): number {
    return this.p.get(x, z) > 0 ? this.r.init(x, z).next(299999) + 2 : 0;
  }
}

/** RegionHillsLayer (mapHills): hills and mutated variants from the river-noise branch. */
class Hills extends Seeded {
  constructor(seed: bigint, salt: number, p: Layer, private readonly noise: Layer) {
    super(seed, salt, p);
  }
  protected compute(x: number, z: number): number {
    const p = this.p;
    const a11 = p.get(x, z), b11 = this.noise.get(x, z);
    const bn = (b11 - 2) % 29;
    if (bn === 1 && b11 >= 2 && !isShallowOcean(a11)) {
      const m = getMutated(a11);
      return m > 0 ? m : a11;
    }
    // vanilla: nextRandom(3) == 0 || k == 0 — the random is always drawn first
    const r = this.r.init(x, z);
    if (r.next(3) !== 0 && bn !== 0) return a11;
    let hill = a11;
    switch (a11) {
      case B.desert: hill = B.desert_hills; break;
      case B.forest: hill = B.wooded_hills; break;
      case B.birch_forest: hill = B.birch_forest_hills; break;
      case B.dark_forest: hill = B.plains; break;
      case B.taiga: hill = B.taiga_hills; break;
      case B.giant_tree_taiga: hill = B.giant_tree_taiga_hills; break;
      case B.snowy_taiga: hill = B.snowy_taiga_hills; break;
      case B.plains: hill = r.next(3) === 0 ? B.wooded_hills : B.forest; break;
      case B.snowy_tundra: hill = B.snowy_mountains; break;
      case B.jungle: hill = B.jungle_hills; break;
      case B.bamboo_jungle: hill = B.bamboo_jungle_hills; break;
      case B.ocean: hill = B.deep_ocean; break;
      case B.mountains: hill = B.wooded_mountains; break;
      case B.savanna: hill = B.savanna_plateau; break;
      default:
        if (areSimilar(a11, B.wooded_badlands_plateau)) hill = B.badlands;
        else if (isDeepOcean(a11) && r.next(3) === 0) hill = r.next(2) === 0 ? B.plains : B.forest;
    }
    if (bn === 0 && hill !== a11) {
      hill = getMutated(hill);
      if (hill < 0) hill = a11;
    }
    if (hill === a11) return a11;
    let eq = 0;
    if (areSimilar(p.get(x, z - 1), a11)) eq++;
    if (areSimilar(p.get(x + 1, z), a11)) eq++;
    if (areSimilar(p.get(x - 1, z), a11)) eq++;
    if (areSimilar(p.get(x, z + 1), a11)) eq++;
    return eq >= 3 ? hill : a11;
  }
}

/** RareBiomeLayer (mapSunflower): 1/57 of plains → sunflower plains. */
class RareBiome extends Seeded {
  protected compute(x: number, z: number): number {
    const v = this.p.get(x, z);
    if (v !== B.plains) return v;
    return this.r.init(x, z).next(57) === 0 ? B.sunflower_plains : v;
  }
}

/** ShoreLayer (mapShore): beaches, stone shores, jungle edges, badlands edges. */
class Shore extends Layer {
  constructor(private readonly p: Layer) {
    super();
  }
  protected compute(x: number, z: number): number {
    const p = this.p, v = p.get(x, z);
    const a = p.get(x, z - 1), b = p.get(x + 1, z), c = p.get(x - 1, z), d = p.get(x, z + 1);
    const anyOcean = isOceanic(a) || isOceanic(b) || isOceanic(c) || isOceanic(d);
    if (v === B.mushroom_fields) return any4(B.ocean, a, b, c, d) ? B.mushroom_field_shore : v;
    if (category(v) === B.jungle) {
      const jfto = (n: number) => category(n) === B.jungle || n === B.forest || n === B.taiga || isOceanic(n);
      if (jfto(a) && jfto(b) && jfto(c) && jfto(d)) return anyOcean ? B.beach : v;
      return B.jungle_edge;
    }
    if (v === B.mountains || v === B.wooded_mountains) return isOceanic(v) ? v : anyOcean ? B.stone_shore : v;
    if (isSnowy(v)) return isOceanic(v) ? v : anyOcean ? B.snowy_beach : v;
    if (v === B.badlands || v === B.wooded_badlands_plateau) {
      if (anyOcean) return v;
      return isMesa(a) && isMesa(b) && isMesa(c) && isMesa(d) ? v : B.desert;
    }
    if (v !== B.ocean && v !== B.deep_ocean && v !== B.river && v !== B.swamp) return anyOcean ? B.beach : v;
    return v;
  }
}

/** SmoothLayer (mapSmooth). */
class Smooth extends Seeded {
  protected compute(x: number, z: number): number {
    const p = this.p;
    let v = p.get(x, z);
    const c = p.get(x - 1, z), a = p.get(x, z - 1);
    if (v === c && v === a) return v;
    const b = p.get(x + 1, z), d = p.get(x, z + 1);
    if (c === b && a === d) return this.r.init(x, z).next(2) === 0 ? c : a;
    if (c === b) v = c;
    if (a === d) v = a;
    return v;
  }
}

/** RiverLayer (mapRiver): edges of the river-noise regions become river. */
class River extends Layer {
  constructor(private readonly p: Layer) {
    super();
  }
  protected compute(x: number, z: number): number {
    const p = this.p, red = (id: number) => (id >= 2 ? 2 + (id & 1) : id);
    const v = red(p.get(x, z));
    return v === red(p.get(x - 1, z)) && v === red(p.get(x, z - 1)) && v === red(p.get(x, z + 1)) && v === red(p.get(x + 1, z)) ? -1 : B.river;
  }
}

/** RiverMixerLayer (mapRiverMix). */
class RiverMix extends Layer {
  constructor(private readonly biomes: Layer, private readonly rivers: Layer) {
    super();
  }
  protected compute(x: number, z: number): number {
    const v = this.biomes.get(x, z);
    if (this.rivers.get(x, z) === B.river && v !== B.ocean && !isOceanic(v)) {
      if (v === B.snowy_tundra) return B.frozen_river;
      if (v === B.mushroom_fields || v === B.mushroom_field_shore) return B.mushroom_field_shore;
      return B.river;
    }
    return v;
  }
}

/** OceanLayer (mapOceanTemp): ocean temperature from Perlin noise. */
class OceanTemp extends Layer {
  private readonly noise: ImprovedNoise;
  constructor(seed: bigint) {
    super();
    this.noise = new ImprovedNoise(new JavaRandom(seed));
  }
  protected compute(x: number, z: number): number {
    const t = this.noise.noise(x / 8, z / 8, 0, 0, 0);
    if (t > 0.4) return B.warm_ocean;
    if (t > 0.2) return B.lukewarm_ocean;
    if (t < -0.4) return B.frozen_ocean;
    if (t < -0.2) return B.cold_ocean;
    return B.ocean;
  }
}

/** OceanMixerLayer (mapOceanMix): land from the biome branch, ocean temperatures elsewhere. */
class OceanMix extends Layer {
  constructor(private readonly land: Layer, private readonly ocean: Layer) {
    super();
  }
  protected compute(x: number, z: number): number {
    const landId = this.land.get(x, z);
    if (!isOceanic(landId)) return landId;
    let oceanId = this.ocean.get(x, z);
    const replace = oceanId === B.warm_ocean ? B.lukewarm_ocean : oceanId === B.frozen_ocean ? B.cold_ocean : 0;
    if (replace) {
      for (let i = -8; i <= 8; i += 4) for (let j = -8; j <= 8; j += 4) if (!isOceanic(this.land.get(x + i, z + j))) return replace;
    }
    if (landId === B.deep_ocean) {
      if (oceanId === B.lukewarm_ocean) oceanId = B.deep_lukewarm_ocean;
      else if (oceanId === B.ocean) oceanId = B.deep_ocean;
      else if (oceanId === B.cold_ocean) oceanId = B.deep_cold_ocean;
      else if (oceanId === B.frozen_ocean) oceanId = B.deep_frozen_ocean;
    }
    return oceanId;
  }
}

/** The full stack; `quart` gives biomes at 1:4 (vanilla OverworldBiomeSource.getNoiseBiome). */
export class OverworldLayers {
  readonly quart: Layer;
  /** 1:256 biome map before edges (for tests/debugging) */
  readonly biome256: Layer;

  constructor(seed: bigint, largeBiomes = false) {
    const z = (salt: number, p: Layer) => new Zoom(seed, salt, p);
    let p: Layer = new Continent(seed, 1);
    p = new Zoom(seed, 2000, p, true);
    p = new AddIsland(seed, 1, p);
    p = z(2001, p);
    p = new AddIsland(seed, 2, p);
    p = new AddIsland(seed, 50, p);
    p = new AddIsland(seed, 70, p);
    p = new RemoveTooMuchOcean(seed, 2, p);
    p = new AddSnow(seed, 2, p);
    p = new AddIsland(seed, 3, p);
    p = new ClimateEdge(p, false);
    p = new ClimateEdge(p, true);
    p = new IntroduceSpecial(seed, 3, p);
    p = z(2002, p);
    p = z(2003, p);
    p = new AddIsland(seed, 4, p);
    p = new AddMushroomIsland(seed, 5, p);
    const deep = (p = new AddDeepOcean(p));
    let b: Layer = new BiomeInit(seed, 200, p);
    b = new AddBamboo(seed, 1001, b);
    this.biome256 = b;
    b = z(1000, b);
    b = z(1001, b);
    b = new BiomeEdge(b);
    const riverInit = new RiverInit(seed, 100, deep);
    let hillsNoise: Layer = z(1000, riverInit);
    hillsNoise = z(1001, hillsNoise);
    b = new Hills(seed, 1000, b, hillsNoise);
    b = new RareBiome(seed, 1001, b);
    b = z(1000, b);
    b = new AddIsland(seed, 3, b);
    b = z(1001, b);
    b = new Shore(b);
    b = z(1002, b);
    b = z(1003, b);
    if (largeBiomes) {
      b = z(1004, b);
      b = z(1005, b);
    }
    b = new Smooth(seed, 1000, b);
    let r: Layer = riverInit;
    for (const salt of [1000, 1001, 1000, 1001, 1002, 1003]) r = z(salt, r);
    r = new River(r);
    r = new Smooth(seed, 1000, r);
    const mixed = new RiverMix(b, r);
    let o: Layer = new OceanTemp(seed);
    for (let salt = 2001; salt <= 2006; salt++) o = z(salt, o);
    this.quart = new OceanMix(mixed, o);
  }
}
