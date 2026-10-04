/**
 * Blockstate definitions for blocks placed by world generation: plants, flowers, corals,
 * mushrooms, cave blocks (amethyst, dripstone, glow lichen, lush caves), sandstone, chests,
 * fire, Nether terrain and more. Geometry follows the vanilla block shapes (game facts);
 * all textures are our own.
 */
import type { BlockModel, BlockStateDef, FaceName, ModelElement, ModelRef } from './format';
import { MODELS } from './library';

type Rot = 0 | 90 | 180 | 270;
type V3 = [number, number, number];
type UV = [number, number, number, number];

/** Rotation that turns a north-facing base model to face `facing`. */
const Y_OF: Record<string, Rot> = { north: 0, east: 90, south: 180, west: 270 };
const HORIZONTAL = ['north', 'east', 'south', 'west'] as const;

function reg(name: string, m: BlockModel): string {
  const id = `block/${name}`;
  MODELS[id] = m;
  return id;
}
function model(name: string, parent: string, textures: Record<string, string>): string {
  return reg(name, { parent, textures });
}
function single(ref: ModelRef, offset?: 'xz' | 'xyz'): BlockStateDef {
  return { variants: { '': ref }, ...(offset ? { offset } : {}) };
}
const cross = (name: string, tex = name, offset?: 'xz' | 'xyz') => single({ model: model(name, 'cross', { cross: tex }) }, offset);
const tintedCross = (name: string, tex = name, offset?: 'xz' | 'xyz') => single({ model: model(name, 'tinted_cross', { cross: tex }) }, offset);
const cubeAll = (name: string, tex: string) => single({ model: model(name, 'cube_all', { all: tex }) });
const bottomTop = (name: string, side: string, top: string, bottom: string) => single({ model: model(name, 'cube_bottom_top', { side, top, bottom }) });
function column(name: string, side: string, end: string): BlockStateDef {
  const id = model(name, 'cube_column', { side, end });
  return { variants: { 'axis=y': { model: id }, 'axis=z': { model: id, x: 90 }, 'axis=x': { model: id, x: 90, y: 90 }, '': { model: id } } };
}
/** Cube with a front face on north; `facing` rotates it. */
function orientable(name: string, tex: { front: string; side: string; top: string; bottom: string }, prop = 'facing'): Record<string, ModelRef> {
  const id = reg(name, { parent: 'cube', textures: { north: tex.front, south: tex.side, west: tex.side, east: tex.side, up: tex.top, down: tex.bottom } });
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) v[`${prop}=${f}`] = { model: id, y: Y_OF[f]! };
  return v;
}
/** Two-sided vertical plane element. */
function plane(from: V3, to: V3, tex: string, a: FaceName, b: FaceName, uv?: UV, tint?: boolean, rotation?: ModelElement['rotation']): ModelElement {
  const f = { texture: tex, ...(uv ? { uv } : {}), ...(tint ? { tint: 0 } : {}) };
  return { from, to, shade: false, ...(rotation ? { rotation } : {}), faces: { [a]: { ...f }, [b]: { ...f } } };
}
function crossElements(tex: string, y0 = 0, y1 = 16, uv: UV = [0, 0, 16, 16], tint = false): ModelElement[] {
  const rot = { origin: [8, 8, 8] as V3, axis: 'y' as const, angle: 45, rescale: true };
  return [
    plane([0.8, y0, 8], [15.2, y1, 8], tex, 'north', 'south', uv, tint, rot),
    plane([8, y0, 0.8], [8, y1, 15.2], tex, 'west', 'east', uv, tint, rot),
  ];
}

// ------------------------------------------------------------------ base models
MODELS.seagrass_planes = {
  ao: false,
  elements: [
    plane([0, 0, 4], [16, 16, 4], '#texture', 'north', 'south', [0, 0, 16, 16]),
    plane([0, 0, 12], [16, 16, 12], '#texture', 'north', 'south', [0, 0, 16, 16]),
    plane([4, 0, 0], [4, 16, 16], '#texture', 'west', 'east', [0, 0, 16, 16]),
    plane([12, 0, 0], [12, 16, 16], '#texture', 'west', 'east', [0, 0, 16, 16]),
  ],
};
MODELS.single_face = { elements: [{ from: [0, 0, 0], to: [16, 16, 0], faces: { north: { texture: '#texture', cull: 'north' } } }] };
MODELS.multiface_plane = { ao: false, elements: [plane([0, 0, 0.1], [16, 16, 0.1], '#texture', 'north', 'south', [0, 0, 16, 16])] };
MODELS.lily_pad = {
  ao: false,
  elements: [{ from: [0, 0.25, 0], to: [16, 0.25, 16], faces: { up: { texture: '#texture', uv: [0, 0, 16, 16], tint: 0 }, down: { texture: '#texture', uv: [0, 16, 16, 0], tint: 0 } } }],
};
/**
 * Faces for a horizontal frond plane: the fan texture's base (bottom rows) sits at the
 * attached edge and its tips at the free edge; the rotations orient the texture per face.
 */
function frond(up: Rot, down: Rot): ModelElement['faces'] {
  return { up: { texture: '#fan', uv: [0, 0, 16, 16], rotation: up }, down: { texture: '#fan', uv: [0, 0, 16, 16], rotation: down } };
}
/** Coral fan: four fronds rising 22.5° outward from the centre. */
MODELS.coral_fan = {
  ao: false,
  elements: [
    { from: [8, 0, 0], to: [16, 0, 16], shade: false, rotation: { origin: [8, 0, 8], axis: 'z', angle: 22.5 }, faces: frond(90, 90) },
    { from: [0, 0, 0], to: [8, 0, 16], shade: false, rotation: { origin: [8, 0, 8], axis: 'z', angle: -22.5 }, faces: frond(270, 270) },
    { from: [0, 0, 8], to: [16, 0, 16], shade: false, rotation: { origin: [8, 0, 8], axis: 'x', angle: -22.5 }, faces: frond(180, 0) },
    { from: [0, 0, 0], to: [16, 0, 8], shade: false, rotation: { origin: [8, 0, 8], axis: 'x', angle: 22.5 }, faces: frond(0, 180) },
  ],
};
/** Wall fan: attached to the south wall, fronds spreading north and tilting up. */
MODELS.coral_wall_fan = {
  ao: false,
  elements: [
    { from: [0, 8, 5], to: [16, 8, 16], shade: false, rotation: { origin: [8, 8, 16], axis: 'x', angle: 22.5 }, faces: frond(0, 180) },
    { from: [0, 6, 7], to: [16, 6, 16], shade: false, rotation: { origin: [8, 6, 16], axis: 'x', angle: -22.5 }, faces: frond(0, 180) },
  ],
};
/** Floor fire: four crossing flame sheets near the centre flaring outward 22.5° (22.4 px tall). */
MODELS.fire_floor = {
  ao: false,
  elements: [
    plane([0, 0, 8.8], [16, 22.4, 8.8], '#fire', 'north', 'south', [0, 0, 16, 16], false, { origin: [8, 8, 8], axis: 'x', angle: 22.5, rescale: true }),
    plane([0, 0, 7.2], [16, 22.4, 7.2], '#fire', 'north', 'south', [0, 0, 16, 16], false, { origin: [8, 8, 8], axis: 'x', angle: -22.5, rescale: true }),
    plane([8.8, 0, 0], [8.8, 22.4, 16], '#fire', 'west', 'east', [0, 0, 16, 16], false, { origin: [8, 8, 8], axis: 'z', angle: -22.5, rescale: true }),
    plane([7.2, 0, 0], [7.2, 22.4, 16], '#fire', 'west', 'east', [0, 0, 16, 16], false, { origin: [8, 8, 8], axis: 'z', angle: 22.5, rescale: true }),
  ],
};
/** Fire burning on the side of the neighbour to the north. */
MODELS.fire_side = { ao: false, elements: [plane([0, 0, 0.01], [16, 22.4, 0.01], '#fire', 'north', 'south', [0, 0, 16, 16])] };

// ------------------------------------------------------------------ block-specific helpers
function doublePlant(name: string, tinted: boolean): BlockStateDef {
  const parent = tinted ? 'tinted_cross' : 'cross';
  return {
    variants: { 'half=lower': { model: model(`${name}_bottom`, parent, { cross: `${name}_bottom` }) }, 'half=upper': { model: model(`${name}_top`, parent, { cross: `${name}_top` }) } },
    offset: 'xz',
  };
}

function sunflowerDef(): BlockStateDef {
  const bottom = model('sunflower_bottom', 'cross', { cross: 'sunflower_bottom' });
  const top = reg('sunflower_top', {
    ao: false,
    elements: [
      ...crossElements('sunflower_top'),
      { from: [9.6, -1, 1], to: [9.6, 15, 15], shade: false, rotation: { origin: [8, 8, 8], axis: 'z', angle: 22.5, rescale: true }, faces: { west: { texture: 'sunflower_back' }, east: { texture: 'sunflower_front' } } },
    ],
  });
  return { variants: { 'half=lower': { model: bottom }, 'half=upper': { model: top } }, offset: 'xz' };
}

function mushroomBlock(name: string, cap: string): BlockStateDef {
  const outside = model(`${name}_face`, 'single_face', { texture: cap });
  const inside = model('mushroom_block_inside', 'single_face', { texture: 'mushroom_block_inside' });
  const rot: Record<string, { x?: Rot; y?: Rot }> = { north: {}, east: { y: 90 }, south: { y: 180 }, west: { y: 270 }, up: { x: 270 }, down: { x: 90 } };
  return {
    multipart: Object.entries(rot).flatMap(([d, r]) => [
      { when: { [d]: 'true' }, apply: { model: outside, ...r } },
      { when: { [d]: 'false' }, apply: { model: inside, ...r, uvlock: true } },
    ]),
  };
}

function multiface(name: string, tex: string): BlockStateDef {
  const id = model(name, 'multiface_plane', { texture: tex });
  const rot: Record<string, { x?: Rot; y?: Rot }> = { north: {}, east: { y: 90 }, south: { y: 180 }, west: { y: 270 }, up: { x: 270 }, down: { x: 90 } };
  return { multipart: Object.entries(rot).map(([d, r]) => ({ when: { [d]: 'true' }, apply: { model: id, ...r } })) };
}

function directional6(id: string): Record<string, ModelRef> {
  return {
    'facing=up': { model: id },
    'facing=down': { model: id, x: 180 },
    'facing=north': { model: id, x: 90 },
    'facing=south': { model: id, x: 90, y: 180 },
    'facing=east': { model: id, x: 90, y: 90 },
    'facing=west': { model: id, x: 90, y: 270 },
  };
}

function seaPickleDef(): BlockStateDef {
  // pickle footprints (x, z, height) per count, like the vanilla shapes
  const layouts: [number, number, number][][] = [
    [[6, 6, 6]],
    [[3, 3, 6], [8, 8, 4]],
    [[6, 9, 6], [2, 2, 4], [8, 2, 6]],
    [[2, 8, 6], [9, 10, 4], [9, 2, 6], [2, 1, 7]],
  ];
  const variants: Record<string, ModelRef> = {};
  layouts.forEach((pickles, i) => {
    for (const alive of [true, false]) {
      const tex = alive ? 'sea_pickle' : 'dead_sea_pickle';
      const elements: ModelElement[] = [];
      for (const [x, z, h] of pickles) {
        elements.push({
          from: [x, 0, z], to: [x + 4, h, z + 4],
          faces: {
            down: { texture: tex, uv: [4, 0, 8, 4], cull: 'down' }, up: { texture: tex, uv: [4, 0, 8, 4] },
            north: { texture: tex, uv: [0, 0, 4, h] }, south: { texture: tex, uv: [0, 0, 4, h] }, west: { texture: tex, uv: [0, 0, 4, h] }, east: { texture: tex, uv: [0, 0, 4, h] },
          },
        });
        if (alive) {
          elements.push(plane([x, h, z + 2], [x + 4, h + 3, z + 2], tex, 'north', 'south', [8, 1, 12, 4]));
          elements.push(plane([x + 2, h, z], [x + 2, h + 3, z + 4], tex, 'west', 'east', [8, 1, 12, 4]));
        }
      }
      const id = reg(`${alive ? '' : 'dead_'}sea_pickle_${i + 1}`, { elements });
      variants[`pickles=${i + 1},waterlogged=${alive}`] = { model: id };
    }
  });
  return { variants };
}

function cocoaDef(): BlockStateDef {
  const boxes: [V3, V3][] = [[[6, 7, 11], [10, 12, 15]], [[5, 5, 9], [11, 12, 15]], [[4, 3, 7], [12, 12, 15]]];
  const variants: Record<string, ModelRef> = {};
  // base model hangs from a log to the south; FACING points at the log
  const yOf: Record<string, Rot> = { south: 0, west: 90, north: 180, east: 270 };
  boxes.forEach(([from, to], age) => {
    const tex = `cocoa_stage${age}`;
    const w = to[0] - from[0], h = to[1] - from[1];
    const side: UV = [0, 0, w, h];
    const id = reg(`cocoa_stage${age}`, {
      ao: false,
      elements: [
        { from, to, faces: { up: { texture: tex, uv: [16 - w, 0, 16, w] }, down: { texture: tex, uv: [16 - w, 0, 16, w] }, north: { texture: tex, uv: side }, south: { texture: tex, uv: side }, west: { texture: tex, uv: side }, east: { texture: tex, uv: side } } },
        plane([8, 12, 12], [8, 16, 16], tex, 'west', 'east', [12, 12, 16, 16]),
      ],
    });
    for (const f of HORIZONTAL) variants[`age=${age},facing=${f}`] = { model: id, y: yOf[f]! };
  });
  return { variants };
}

function bambooDef(): BlockStateDef {
  const stalk = (age: number) => {
    const a = age === 0 ? 7 : 6.5, b = age === 0 ? 9 : 9.5, w = b - a;
    const side: UV = [0, 0, w, 16];
    return reg(`bamboo_age${age}`, {
      elements: [{
        from: [a, 0, a], to: [b, 16, b],
        faces: {
          down: { texture: 'bamboo_stalk', uv: [13, 0, 13 + w, w], cull: 'down' }, up: { texture: 'bamboo_stalk', uv: [13, 0, 13 + w, w], cull: 'up' },
          north: { texture: 'bamboo_stalk', uv: side }, south: { texture: 'bamboo_stalk', uv: side }, west: { texture: 'bamboo_stalk', uv: side }, east: { texture: 'bamboo_stalk', uv: side },
        },
      }],
    });
  };
  const small = model('bamboo_small_leaves', 'cross', { cross: 'bamboo_small_leaves' });
  const large = model('bamboo_large_leaves', 'cross', { cross: 'bamboo_large_leaves' });
  return {
    multipart: [
      { when: { age: '0' }, apply: { model: stalk(0) } },
      { when: { age: '1' }, apply: { model: stalk(1) } },
      { when: { leaves: 'small' }, apply: { model: small } },
      { when: { leaves: 'large' }, apply: { model: large } },
    ],
    offset: 'xz',
  };
}

function chestDef(name: string, front: string): BlockStateDef {
  const T = { top: 'chest_top', side: 'chest_side', front };
  const mk = (suffix: string, x0: number, x1: number, latch: [number, number] | null) => {
    const faces: ModelElement['faces'] = { up: { texture: T.top }, down: { texture: T.top, cull: 'down' }, north: { texture: T.front }, south: { texture: T.side } };
    if (x0 > 0) faces.west = { texture: T.side };
    if (x1 < 16) faces.east = { texture: T.side };
    const elements: ModelElement[] = [{ from: [x0, 0, 1], to: [x1, 14, 15], faces }];
    if (latch) {
      const m = { texture: T.front, uv: [7, 4, 9, 8] as UV };
      elements.push({ from: [latch[0], 7, 0], to: [latch[1], 11, 1], faces: { north: m, west: m, east: m, up: m, down: m } });
    }
    return reg(`${name}${suffix}`, { elements });
  };
  const single = mk('', 1, 15, [7, 9]);
  // type=left: the other half is clockwise of FACING (east of a north-facing chest)
  const left = mk('_left', 1, 16, [15, 16]);
  const right = mk('_right', 0, 15, [0, 1]);
  const variants: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) {
    variants[`facing=${f},type=single`] = { model: single, y: Y_OF[f]! };
    variants[`facing=${f},type=left`] = { model: left, y: Y_OF[f]! };
    variants[`facing=${f},type=right`] = { model: right, y: Y_OF[f]! };
  }
  return { variants };
}

function fireDef(name: string, tex0: string, tex1: string, sides: boolean): BlockStateDef {
  const floors: ModelRef[] = [
    { model: model(`${name}_floor0`, 'fire_floor', { fire: tex0 }) },
    { model: model(`${name}_floor1`, 'fire_floor', { fire: tex1 }) },
  ];
  if (!sides) return { variants: { '': floors } };
  const side = model(`${name}_side0`, 'fire_side', { fire: tex0 });
  return {
    multipart: [
      { when: { north: 'false', east: 'false', south: 'false', west: 'false', up: 'false' }, apply: floors[0]! },
      ...HORIZONTAL.map((d) => ({ when: { [d]: 'true' } as Record<string, string>, apply: { model: side, y: Y_OF[d]! } })),
      { when: { up: 'true' }, apply: { model: side, x: 270 as Rot } },
    ],
  };
}

function azaleaDef(name: string): BlockStateDef {
  return single({
    model: reg(name, {
      elements: [
        {
          from: [0, 0, 0], to: [16, 16, 16],
          faces: { up: { texture: `${name}_top`, cull: 'up' }, north: { texture: `${name}_side`, cull: 'north' }, south: { texture: `${name}_side`, cull: 'south' }, west: { texture: `${name}_side`, cull: 'west' }, east: { texture: `${name}_side`, cull: 'east' } },
        },
        { from: [0, 15.9, 0], to: [16, 15.9, 16], faces: { down: { texture: `${name}_top` } } },
        ...crossElements('azalea_plant'),
      ],
    }),
  });
}

function bigDripleafDef(): BlockStateDef {
  const leaf = (suffix: string, angle: number) => reg(`big_dripleaf${suffix}`, {
    elements: [
      {
        from: [0, 15, 0], to: [16, 15, 16], ...(angle ? { rotation: { origin: [8, 15, 16] as V3, axis: 'x' as const, angle } } : {}),
        faces: { up: { texture: 'big_dripleaf_top', uv: [0, 0, 16, 16] }, down: { texture: 'big_dripleaf_top', uv: [0, 16, 16, 0] } },
      },
      ...crossElements('big_dripleaf_stem', 0, 15, [0, 1, 16, 16]),
    ],
  });
  const flat = leaf('', 0), partial = leaf('_partial_tilt', -22.5), full = leaf('_full_tilt', -45);
  const variants: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) {
    // the leaf droops toward FACING
    const y = Y_OF[f]!;
    variants[`facing=${f},tilt=none`] = { model: flat, y };
    variants[`facing=${f},tilt=unstable`] = { model: flat, y };
    variants[`facing=${f},tilt=partial`] = { model: partial, y };
    variants[`facing=${f},tilt=full`] = { model: full, y };
  }
  return { variants };
}

function smallDripleafDef(): BlockStateDef {
  const lower = reg('small_dripleaf_bottom', { ao: false, elements: crossElements('small_dripleaf_stem') });
  const upper = reg('small_dripleaf_top', {
    ao: false,
    elements: [
      ...crossElements('small_dripleaf_stem', 0, 8, [0, 8, 16, 16]),
      { from: [3, 8, 3], to: [13, 8, 13], faces: { up: { texture: 'small_dripleaf_top' }, down: { texture: 'small_dripleaf_top' } } },
      { from: [1, 12, 6], to: [7, 12, 12], faces: { up: { texture: 'small_dripleaf_top' }, down: { texture: 'small_dripleaf_top' } } },
    ],
  });
  const variants: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) {
    variants[`facing=${f},half=lower`] = { model: lower, y: Y_OF[f]! };
    variants[`facing=${f},half=upper`] = { model: upper, y: Y_OF[f]! };
  }
  return { variants };
}

function sporeBlossomDef(): BlockStateDef {
  return single({
    model: reg('spore_blossom', {
      ao: false,
      elements: [
        { from: [1, 15.9, 1], to: [15, 15.9, 15], shade: false, faces: { down: { texture: 'spore_blossom_base' } } },
        { from: [0, 14, 0], to: [16, 14, 16], shade: false, faces: { down: { texture: 'spore_blossom' }, up: { texture: 'spore_blossom' } } },
      ],
    }),
  });
}

function portalDef(): BlockStateDef {
  const id = reg('nether_portal_ns', {
    ao: false,
    elements: [{ from: [0, 0, 6], to: [16, 16, 10], faces: { north: { texture: 'nether_portal' }, south: { texture: 'nether_portal' } } }],
  });
  return { variants: { 'axis=x': { model: id }, 'axis=z': { model: id, y: 90 } } };
}

function candleDef(name: string, tex: string): BlockStateDef {
  // candle footprints [x, z, height] for 1–4 candles, like the vanilla shapes
  const layouts: [number, number, number][][] = [
    [[7, 7, 6]],
    [[5, 7, 6], [9, 6, 5]],
    [[7, 9, 6], [5, 6, 5], [9, 7, 3]],
    [[6, 8, 6], [9, 8, 5], [5, 5, 5], [8, 5, 3]],
  ];
  const variants: Record<string, ModelRef> = {};
  layouts.forEach((cs, i) => {
    const elements: ModelElement[] = [];
    for (const [x, z, h] of cs) {
      const side: UV = [0, 14 - h, 2, 14];
      elements.push({
        from: [x, 0, z], to: [x + 2, h, z + 2],
        faces: { up: { texture: tex, uv: [2, 8, 4, 10] }, down: { texture: tex, uv: [2, 8, 4, 10], cull: 'down' }, north: { texture: tex, uv: side }, south: { texture: tex, uv: side }, west: { texture: tex, uv: side }, east: { texture: tex, uv: side } },
      });
      elements.push(plane([x + 1, h, z + 0.5], [x + 1, h + 1, z + 1.5], tex, 'west', 'east', [0, 7, 1, 8]));
    }
    const id = reg(`${name}_${i + 1}`, { ao: false, elements });
    variants[`candles=${i + 1}`] = { model: id };
  });
  return { variants };
}

// ------------------------------------------------------------------ registry
const FLOWERS = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose'];
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
const CORALS = ['tube', 'brain', 'bubble', 'fire', 'horn'];

export const NATURAL: Record<string, () => BlockStateDef> = {
  fern: () => tintedCross('fern', 'fern', 'xyz'),
  tall_grass: () => doublePlant('tall_grass', true),
  large_fern: () => doublePlant('large_fern', true),
  lilac: () => doublePlant('lilac', false),
  rose_bush: () => doublePlant('rose_bush', false),
  peony: () => doublePlant('peony', false),
  sunflower: sunflowerDef,
  sugar_cane: () => tintedCross('sugar_cane'),
  dead_bush: () => cross('dead_bush'),
  sweet_berry_bush: () => {
    const variants: Record<string, ModelRef> = {};
    for (let a = 0; a < 4; a++) variants[`age=${a}`] = { model: model(`sweet_berry_bush_stage${a}`, 'cross', { cross: `sweet_berry_bush_stage${a}` }) };
    return { variants };
  },
  lily_pad: () => {
    const id = model('lily_pad', 'lily_pad', { texture: 'lily_pad' });
    return { variants: { '': ([0, 90, 180, 270] as Rot[]).map((y) => ({ model: id, y })) } };
  },
  brown_mushroom: () => cross('brown_mushroom'),
  red_mushroom: () => cross('red_mushroom'),
  brown_mushroom_block: () => mushroomBlock('brown_mushroom_block', 'brown_mushroom_block'),
  red_mushroom_block: () => mushroomBlock('red_mushroom_block', 'red_mushroom_block'),
  mushroom_stem: () => mushroomBlock('mushroom_stem', 'mushroom_stem'),
  seagrass: () => single({ model: model('seagrass', 'seagrass_planes', { texture: 'seagrass' }) }),
  tall_seagrass: () => ({
    variants: {
      'half=lower': { model: model('tall_seagrass_bottom', 'seagrass_planes', { texture: 'tall_seagrass_bottom' }) },
      'half=upper': { model: model('tall_seagrass_top', 'seagrass_planes', { texture: 'tall_seagrass_top' }) },
    },
  }),
  kelp: () => cross('kelp'),
  kelp_plant: () => cross('kelp_plant'),
  sea_pickle: seaPickleDef,
  cocoa: cocoaDef,
  bamboo: bambooDef,
  bamboo_sapling: () => cross('bamboo_sapling', 'bamboo_stage0'),
  pumpkin: () => single({ model: model('pumpkin', 'cube_column', { side: 'pumpkin_side', end: 'pumpkin_top' }) }),
  carved_pumpkin: () => ({ variants: orientable('carved_pumpkin', { front: 'carved_pumpkin', side: 'pumpkin_side', top: 'pumpkin_top', bottom: 'pumpkin_top' }) }),
  jack_o_lantern: () => ({ variants: orientable('jack_o_lantern', { front: 'jack_o_lantern', side: 'pumpkin_side', top: 'pumpkin_top', bottom: 'pumpkin_top' }) }),
  melon: () => single({ model: model('melon', 'cube_column', { side: 'melon_side', end: 'melon_top' }) }),
  bee_nest: () => {
    const plain = orientable('bee_nest', { front: 'bee_nest_front', side: 'bee_nest_side', top: 'bee_nest_top', bottom: 'bee_nest_bottom' });
    const honey = orientable('bee_nest_honey', { front: 'bee_nest_front_honey', side: 'bee_nest_side', top: 'bee_nest_top', bottom: 'bee_nest_bottom' });
    const variants: Record<string, ModelRef> = {};
    for (const f of HORIZONTAL) {
      variants[`facing=${f},honey_level=5`] = honey[`facing=${f}`]!;
      variants[`facing=${f}`] = plain[`facing=${f}`]!;
    }
    return { variants };
  },
  podzol: () => ({
    variants: {
      'snowy=true': { model: model('podzol_snow', 'cube_bottom_top', { side: 'grass_block_snow', top: 'podzol_top', bottom: 'dirt' }) },
      'snowy=false': { model: model('podzol', 'cube_bottom_top', { side: 'podzol_side', top: 'podzol_top', bottom: 'dirt' }) },
    },
  }),
  mycelium: () => ({
    variants: {
      'snowy=true': { model: model('mycelium_snow', 'cube_bottom_top', { side: 'grass_block_snow', top: 'mycelium_top', bottom: 'dirt' }) },
      'snowy=false': { model: model('mycelium', 'cube_bottom_top', { side: 'mycelium_side', top: 'mycelium_top', bottom: 'dirt' }) },
    },
  }),
  snow_block: () => cubeAll('snow_block', 'snow'),
  magma_block: () => cubeAll('magma_block', 'magma'),
  sandstone: () => bottomTop('sandstone', 'sandstone', 'sandstone_top', 'sandstone_bottom'),
  red_sandstone: () => bottomTop('red_sandstone', 'red_sandstone', 'red_sandstone_top', 'red_sandstone_bottom'),
  cut_sandstone: () => single({ model: model('cut_sandstone', 'cube_column', { side: 'cut_sandstone', end: 'sandstone_top' }) }),
  cut_red_sandstone: () => single({ model: model('cut_red_sandstone', 'cube_column', { side: 'cut_red_sandstone', end: 'red_sandstone_top' }) }),
  chiseled_sandstone: () => single({ model: model('chiseled_sandstone', 'cube_column', { side: 'chiseled_sandstone', end: 'sandstone_top' }) }),
  chiseled_red_sandstone: () => single({ model: model('chiseled_red_sandstone', 'cube_column', { side: 'chiseled_red_sandstone', end: 'red_sandstone_top' }) }),
  smooth_sandstone: () => cubeAll('smooth_sandstone', 'sandstone_top'),
  smooth_red_sandstone: () => cubeAll('smooth_red_sandstone', 'red_sandstone_top'),
  pointed_dripstone: () => {
    const variants: Record<string, ModelRef> = {};
    for (const dir of ['up', 'down'])
      for (const th of ['tip_merge', 'tip', 'frustum', 'middle', 'base']) {
        const n = `pointed_dripstone_${dir}_${th}`;
        variants[`thickness=${th},vertical_direction=${dir}`] = { model: model(n, 'cross', { cross: n }) };
      }
    return { variants };
  },
  glow_lichen: () => multiface('glow_lichen', 'glow_lichen'),
  small_amethyst_bud: () => ({ variants: directional6(model('small_amethyst_bud', 'cross', { cross: 'small_amethyst_bud' })) }),
  medium_amethyst_bud: () => ({ variants: directional6(model('medium_amethyst_bud', 'cross', { cross: 'medium_amethyst_bud' })) }),
  large_amethyst_bud: () => ({ variants: directional6(model('large_amethyst_bud', 'cross', { cross: 'large_amethyst_bud' })) }),
  amethyst_cluster: () => ({ variants: directional6(model('amethyst_cluster', 'cross', { cross: 'amethyst_cluster' })) }),
  chest: () => chestDef('chest', 'chest_front'),
  trapped_chest: () => chestDef('trapped_chest', 'trapped_chest_front'),
  fire: () => fireDef('fire', 'fire_0', 'fire_1', true),
  soul_fire: () => fireDef('soul_fire', 'soul_fire_0', 'soul_fire_1', false),
  nether_portal: portalDef,
  bubble_column: () => ({ variants: {} }),
  moss_carpet: () => single({ model: model('moss_carpet', 'carpet', { wool: 'moss_block' }) }),
  azalea: () => azaleaDef('azalea'),
  flowering_azalea: () => azaleaDef('flowering_azalea'),
  cave_vines: () => ({ variants: { 'berries=true': { model: model('cave_vines_lit', 'cross', { cross: 'cave_vines_lit' }) }, 'berries=false': { model: model('cave_vines', 'cross', { cross: 'cave_vines' }) } } }),
  cave_vines_plant: () => ({ variants: { 'berries=true': { model: model('cave_vines_plant_lit', 'cross', { cross: 'cave_vines_plant_lit' }) }, 'berries=false': { model: model('cave_vines_plant', 'cross', { cross: 'cave_vines_plant' }) } } }),
  spore_blossom: sporeBlossomDef,
  hanging_roots: () => cross('hanging_roots'),
  big_dripleaf: bigDripleafDef,
  big_dripleaf_stem: () => single({ model: reg('big_dripleaf_stem', { ao: false, elements: crossElements('big_dripleaf_stem') }) }),
  small_dripleaf: smallDripleafDef,
  basalt: () => column('basalt', 'basalt_side', 'basalt_top'),
  blackstone: () => column('blackstone', 'blackstone', 'blackstone_top'),
  ancient_debris: () => column('ancient_debris', 'ancient_debris_side', 'ancient_debris_top'),
  crimson_nylium: () => bottomTop('crimson_nylium', 'crimson_nylium_side', 'crimson_nylium', 'netherrack'),
  warped_nylium: () => bottomTop('warped_nylium', 'warped_nylium_side', 'warped_nylium', 'netherrack'),
  crimson_fungus: () => cross('crimson_fungus'),
  warped_fungus: () => cross('warped_fungus'),
  crimson_roots: () => cross('crimson_roots'),
  warped_roots: () => cross('warped_roots'),
  nether_sprouts: () => cross('nether_sprouts'),
  weeping_vines: () => cross('weeping_vines'),
  weeping_vines_plant: () => cross('weeping_vines_plant'),
  twisting_vines: () => cross('twisting_vines'),
  twisting_vines_plant: () => cross('twisting_vines_plant'),
  infested_stone: () => cubeAll('infested_stone', 'stone'),
  infested_cobblestone: () => cubeAll('infested_cobblestone', 'cobblestone'),
  infested_stone_bricks: () => cubeAll('infested_stone_bricks', 'stone_bricks'),
  infested_mossy_stone_bricks: () => cubeAll('infested_mossy_stone_bricks', 'mossy_stone_bricks'),
  infested_cracked_stone_bricks: () => cubeAll('infested_cracked_stone_bricks', 'cracked_stone_bricks'),
  infested_deepslate: () => column('infested_deepslate', 'deepslate', 'deepslate_top'),
};

NATURAL.candle = () => candleDef('candle', 'candle');
for (const c of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) {
  const n = `${c}_stained_glass_pane`;
  NATURAL[n] = () => {
    const post = model(`${n}_post`, 'pane_post', { pane: `${c}_stained_glass`, edge: `${c}_stained_glass` });
    const side = model(`${n}_side`, 'pane_side', { pane: `${c}_stained_glass`, edge: `${c}_stained_glass` });
    return { multipart: [{ apply: { model: post } }, ...HORIZONTAL.map((d) => ({ when: { [d]: 'true' } as Record<string, string>, apply: { model: side, y: Y_OF[d]! } }))] };
  };
}
for (const f of FLOWERS) NATURAL[f] = () => cross(f, f, 'xz');
for (const w of WOODS) NATURAL[`${w}_sapling`] = () => cross(`${w}_sapling`);
for (const c of CORALS)
  for (const dead of ['', 'dead_']) {
    const n = `${dead}${c}_coral`;
    NATURAL[n] = () => cross(n);
    NATURAL[`${n}_fan`] = () => single({ model: model(`${n}_fan`, 'coral_fan', { fan: `${n}_fan` }) });
    NATURAL[`${n}_wall_fan`] = () => {
      const id = model(`${n}_wall_fan`, 'coral_wall_fan', { fan: `${n}_fan` });
      const variants: Record<string, ModelRef> = {};
      for (const f of HORIZONTAL) variants[`facing=${f}`] = { model: id, y: Y_OF[f]! };
      return { variants };
    };
  }
