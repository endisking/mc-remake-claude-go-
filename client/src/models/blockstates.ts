/**
 * Blockstate definitions: which (rotated) models each block state uses.
 * Block-specific models are registered into MODELS as `block/<name>`.
 */
import type { BlockStateDef, ModelRef } from './format';
import { MODELS, box } from './library';
import { NATURAL } from './natural';
import { CRAFTED } from './crafted';

/** Register a model that inherits `parent` with the given texture variables. */
function model(name: string, parent: string, textures: Record<string, string>): string {
  const id = `block/${name}`;
  MODELS[id] = { parent, textures };
  return id;
}

function single(ref: ModelRef): BlockStateDef {
  return { variants: { '': ref } };
}

/** Random rotations about Y, like vanilla's grass/sand/dirt tops. */
function randomY(modelId: string): BlockStateDef {
  return { variants: { '': [0, 90, 180, 270].map((y) => ({ model: modelId, y: y as 0 | 90 | 180 | 270 })) } };
}

function column(name: string, side: string, end: string): BlockStateDef {
  const id = model(name, 'cube_column', { side, end });
  return {
    variants: {
      'axis=y': { model: id },
      'axis=z': { model: id, x: 90 },
      'axis=x': { model: id, x: 90, y: 90 },
    },
  };
}

function slab(name: string, tex: { top: string; bottom: string; side: string }, doubleModel: string): BlockStateDef {
  const b = model(name, 'slab', tex);
  const t = model(`${name}_top`, 'slab_top', tex);
  return { variants: { 'type=bottom': { model: b }, 'type=top': { model: t }, 'type=double': { model: doubleModel } } };
}

function stairs(name: string, tex: { top: string; bottom: string; side: string }): BlockStateDef {
  const straight = model(name, 'stairs', tex);
  const inner = model(`${name}_inner`, 'inner_stairs', tex);
  const outer = model(`${name}_outer`, 'outer_stairs', tex);
  const variants: Record<string, ModelRef> = {};
  // base models face east (the step is on the east half); rotate per facing
  const yFor: Record<string, number> = { east: 0, south: 90, west: 180, north: 270 };
  for (const facing of ['north', 'south', 'west', 'east'])
    for (const half of ['bottom', 'top'])
      for (const shape of ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right']) {
        let y = yFor[facing]!;
        const m = shape === 'straight' ? straight : shape.startsWith('inner') ? inner : outer;
        // the corner models are built as "right" variants; left variants rotate 90° counter-clockwise
        if (shape.endsWith('left')) y = (y + 270) % 360;
        let x = 0;
        if (half === 'top') {
          x = 180;
          if (shape !== 'straight') y = (y + 90) % 360;
        }
        variants[`facing=${facing},half=${half},shape=${shape}`] = { model: m, x: x as 0 | 180, y: y as 0 | 90 | 180 | 270, uvlock: true };
      }
  return { variants };
}

const EXPLICIT: Record<string, () => BlockStateDef> = {
  grass_block: () => {
    const normal = model('grass_block', 'grass_block', { bottom: 'dirt', top: 'grass_block_top', side: 'grass_block_side', overlay: 'grass_block_side_overlay' });
    const snowy = model('grass_block_snow', 'cube_bottom_top', { bottom: 'dirt', top: 'grass_block_top', side: 'grass_block_snow' });
    return {
      variants: {
        'snowy=true': { model: snowy },
        'snowy=false': [0, 90, 180, 270].map((y) => ({ model: normal, y: y as 0 | 90 | 180 | 270 })),
      },
    };
  },
  dirt: () => randomY(model('dirt', 'cube_all', { all: 'dirt' })),
  sand: () => randomY(model('sand', 'cube_all', { all: 'sand' })),
  red_sand: () => randomY(model('red_sand', 'cube_all', { all: 'red_sand' })),
  stone: () => single({ model: model('stone', 'cube_all', { all: 'stone' }) }),
  bedrock: () => ({ variants: { '': [0, 90, 180, 270].map((y) => ({ model: model('bedrock', 'cube_all', { all: 'bedrock' }), y: y as 0 | 90 | 180 | 270 })) } }),
  deepslate: () => column('deepslate', 'deepslate', 'deepslate_top'),
  grass: () => ({ ...single({ model: model('grass', 'tinted_cross', { cross: 'grass' }) }), offset: 'xyz' }),
  poppy: () => ({ ...single({ model: model('poppy', 'cross', { cross: 'poppy' }) }), offset: 'xz' }),
  dandelion: () => ({ ...single({ model: model('dandelion', 'cross', { cross: 'dandelion' }) }), offset: 'xz' }),
  torch: () => single({ model: model('torch', 'torch', { torch: 'torch' }) }),
  wall_torch: () => {
    const id = model('wall_torch', 'wall_torch', { torch: 'torch' });
    // base model leans toward +x (attached to a wall on the west); rotate so it points away from the wall
    return { variants: { 'facing=east': { model: id }, 'facing=south': { model: id, y: 90 }, 'facing=west': { model: id, y: 180 }, 'facing=north': { model: id, y: 270 } } };
  },
  snow: () => {
    const variants: Record<string, ModelRef> = {};
    for (let n = 1; n <= 8; n++) variants[`layers=${n}`] = { model: model(`snow_height${n * 2}`, `snow_height${n * 2}`, { texture: 'snow' }) };
    return { variants };
  },
  glass: () => single({ model: model('glass', 'cube_all', { all: 'glass' }) }),
  glass_pane: () => paneDef('glass_pane', 'glass', 'glass_pane_top'),
  oak_fence: () => fenceDef('oak_fence', 'oak_planks'),
  cobblestone_wall: () => wallDef('cobblestone_wall', 'cobblestone'),
  oak_door: () => doorDef('oak_door', 'oak_door_top', 'oak_door_bottom'),
  oak_trapdoor: () => trapdoorDef('oak_trapdoor', 'oak_trapdoor'),
  ladder: () => {
    const id = model('ladder', 'ladder', { texture: 'ladder' });
    return { variants: { 'facing=north': { model: id }, 'facing=east': { model: id, y: 90 }, 'facing=south': { model: id, y: 180 }, 'facing=west': { model: id, y: 270 } } };
  },
  rail: () => {
    const flat = model('rail_flat', 'rail_flat', { rail: 'rail' });
    const raised = model('rail_raised_ne', 'rail_raised_ne', { rail: 'rail' });
    return {
      variants: {
        'shape=north_south': { model: flat },
        'shape=east_west': { model: flat, y: 90 },
        'shape=ascending_north': { model: raised },
        'shape=ascending_east': { model: raised, y: 90 },
        'shape=ascending_south': { model: raised, y: 180 },
        'shape=ascending_west': { model: raised, y: 270 },
        'shape=south_east': { model: flat },
        'shape=south_west': { model: flat, y: 90 },
        'shape=north_west': { model: flat, y: 180 },
        'shape=north_east': { model: flat, y: 270 },
      },
    };
  },
  vine: (): BlockStateDef => {
    const id = model('vine', 'vine', { vine: 'vine' });
    return {
      multipart: [
        { when: { north: 'true' }, apply: { model: id } },
        { when: { east: 'true' }, apply: { model: id, y: 90 } },
        { when: { south: 'true' }, apply: { model: id, y: 180 } },
        { when: { west: 'true' }, apply: { model: id, y: 270 } },
        { when: { up: 'true' }, apply: { model: id, x: 270 } },
      ],
    };
  },
  wheat: () => {
    const variants: Record<string, ModelRef> = {};
    for (let a = 0; a < 8; a++) variants[`age=${a}`] = { model: model(`wheat_stage${a}`, 'crop', { crop: `wheat_stage${a}` }) };
    return { variants };
  },
  cactus: () => single({ model: model('cactus', 'cactus', { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }) }),
  white_carpet: () => single({ model: model('white_carpet', 'carpet', { wool: 'white_wool' }) }),
  stone_pressure_plate: () => ({
    variants: {
      'powered=false': { model: model('stone_pressure_plate', 'pressure_plate_up', { texture: 'stone' }) },
      'powered=true': { model: model('stone_pressure_plate_down', 'pressure_plate_down', { texture: 'stone' }) },
    },
  }),
  stone_button: () => buttonDef('stone_button', 'stone'),
  oak_button: () => buttonDef('oak_button', 'oak_planks'),
  lever: () => {
    const id = model('lever', 'lever', { base: 'cobblestone', lever: 'lever' });
    const variants: Record<string, ModelRef> = {};
    for (const face of ['floor', 'wall', 'ceiling'])
      for (const facing of ['north', 'south', 'west', 'east'])
        for (const powered of ['false', 'true']) {
          const x: Rot = face === 'floor' ? 0 : face === 'wall' ? 90 : 180;
          let y = Y_OF[facing]!;
          if (face === 'ceiling') y = ((y + 180) % 360) as Rot;
          if (powered === 'true') y = ((y + 180) % 360) as Rot;
          variants[`face=${face},facing=${facing},powered=${powered}`] = { model: id, x, y };
        }
    return { variants };
  },
  farmland: () => {
    const dry = model('farmland', 'farmland', { dirt: 'dirt', top: 'farmland' });
    const wet = model('farmland_moist', 'farmland', { dirt: 'dirt', top: 'farmland_moist' });
    const variants: Record<string, ModelRef> = {};
    for (let m = 0; m < 8; m++) variants[`moisture=${m}`] = { model: m === 7 ? wet : dry };
    return { variants };
  },
  ice: () => single({ model: model('ice', 'cube_all', { all: 'ice' }) }),
  hay_block: () => column('hay_block', 'hay_block_side', 'hay_block_top'),
  cobweb: () => single({ model: model('cobweb', 'cross', { cross: 'cobweb' }) }),
  tnt: () => single({ model: model('tnt', 'cube_bottom_top', { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' }) }),
  iron_bars: () => paneDef('iron_bars', 'iron_bars', 'iron_bars'),
  dirt_path: () => {
    MODELS.dirt_path_base = {
      elements: [box([0, 0, 0], [16, 15, 16], { down: 'bottom', up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['down', 'north', 'south', 'west', 'east'])],
    };
    return randomY(model('dirt_path', 'dirt_path_base', { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' }));
  },
};

type Rot = 0 | 90 | 180 | 270;
const Y_OF: Record<string, Rot> = { north: 0, east: 90, south: 180, west: 270 };

/** Fence: post + one side arm per connected direction (arm model points north). */
export function fenceDef(name: string, texture: string): BlockStateDef {
  const post = model(`${name}_post`, 'fence_post', { texture });
  const side = model(`${name}_side`, 'fence_side', { texture });
  return {
    multipart: [
      { apply: { model: post } },
      ...(['north', 'east', 'south', 'west'] as const).map((d) => ({ when: { [d]: 'true' } as Record<string, string>, apply: { model: side, y: Y_OF[d]!, uvlock: true } })),
    ],
  };
}

/** 1.17 walls: post when up=true, low or tall side per direction. */
export function wallDef(name: string, texture: string): BlockStateDef {
  const post = model(`${name}_post`, 'wall_post', { wall: texture });
  const side = model(`${name}_side`, 'wall_side', { wall: texture });
  const tall = model(`${name}_side_tall`, 'wall_side_tall', { wall: texture });
  const dirs = ['north', 'east', 'south', 'west'] as const;
  return {
    multipart: [
      { when: { up: 'true' }, apply: { model: post } },
      ...dirs.map((d) => ({ when: { [d]: 'low' } as Record<string, string>, apply: { model: side, y: Y_OF[d]!, uvlock: true } })),
      ...dirs.map((d) => ({ when: { [d]: 'tall' } as Record<string, string>, apply: { model: tall, y: Y_OF[d]!, uvlock: true } })),
    ],
  };
}

export function paneDef(name: string, pane: string, edge: string): BlockStateDef {
  const post = model(`${name}_post`, 'pane_post', { pane, edge });
  const side = model(`${name}_side`, 'pane_side', { pane, edge });
  return {
    multipart: [
      { apply: { model: post } },
      ...(['north', 'east', 'south', 'west'] as const).map((d) => ({ when: { [d]: 'true' } as Record<string, string>, apply: { model: side, y: Y_OF[d]! } })),
    ],
  };
}

/** Doors: base models are hinged on the west side facing east (closed). */
export function doorDef(name: string, top: string, bottom: string): BlockStateDef {
  const b = model(`${name}_bottom`, 'door_bottom', { bottom, top });
  const t = model(`${name}_top`, 'door_top', { bottom, top });
  const variants: Record<string, ModelRef> = {};
  const baseY: Record<string, number> = { east: 0, south: 90, west: 180, north: 270 };
  for (const facing of ['north', 'south', 'west', 'east'])
    for (const half of ['lower', 'upper'])
      for (const hinge of ['left', 'right'])
        for (const open of ['false', 'true']) {
          let y = baseY[facing]!;
          if (open === 'true') y += hinge === 'left' ? 90 : 270;
          variants[`facing=${facing},half=${half},hinge=${hinge},open=${open}`] = { model: half === 'lower' ? b : t, y: ((y % 360) as Rot) };
        }
  return { variants };
}

/**
 * Bed halves: a 6-px mattress (y 3–9) on two 3×3×3 legs at the outer corners. Modelled with
 * the head toward north (−Z); FACING (foot → head) rotates it.
 */
/**
 * Scaffolding: framed side panels (seen from outside and inside), a slatted platform on top and
 * a frame underneath; a hanging ("bottom") piece adds foot rails like its collision shape.
 */
export function scaffoldingDef(): BlockStateDef {
  type V3 = [number, number, number];
  const both = (from: V3, to: V3, a: 'north' | 'south' | 'west' | 'east' | 'up' | 'down', b: typeof a, texture: string) => ({
    from, to, faces: { [a]: { texture }, [b]: { texture } },
  });
  const shell = [
    both([0, 0, 0], [16, 16, 0], 'north', 'south', 'scaffolding_side'),
    both([0, 0, 16], [16, 16, 16], 'south', 'north', 'scaffolding_side'),
    both([0, 0, 0], [0, 16, 16], 'west', 'east', 'scaffolding_side'),
    both([16, 0, 0], [16, 16, 16], 'east', 'west', 'scaffolding_side'),
    both([0, 16, 0], [16, 16, 16], 'up', 'down', 'scaffolding_top'),
    both([0, 0, 0], [16, 0, 16], 'down', 'up', 'scaffolding_bottom'),
  ];
  MODELS['block/scaffolding_stable'] = { elements: shell };
  const rail = (from: V3, to: V3) => ({
    from, to,
    faces: Object.fromEntries((['north', 'south', 'west', 'east', 'up'] as const).map((f) => [f, { texture: 'scaffolding_side', uv: [0, 14, 16, 16] as [number, number, number, number] }])),
  });
  MODELS['block/scaffolding_unstable'] = {
    elements: [...shell, rail([0.01, 0, 0.01], [2, 2, 15.99]), rail([14, 0, 0.01], [15.99, 2, 15.99]), rail([2, 0, 0.01], [14, 2, 2]), rail([2, 0, 14], [14, 2, 15.99])],
  };
  return { variants: { 'bottom=false': { model: 'block/scaffolding_stable' }, 'bottom=true': { model: 'block/scaffolding_unstable' } } };
}

export function bedDef(name: string): BlockStateDef {
  const color = name.replace(/_bed$/, '');
  const wood = 'bed_wood';
  const leg = (x: number, z: number) => ({
    from: [x, 0, z] as [number, number, number],
    to: [x + 3, 3, z + 3] as [number, number, number],
    faces: Object.fromEntries((['down', 'north', 'south', 'west', 'east'] as const).map((f) => [f, { texture: wood, ...(f === 'down' ? { cull: 'down' as const } : {}) }])),
  });
  MODELS[`block/${name}_head`] = {
    elements: [
      {
        from: [0, 3, 0], to: [16, 9, 16],
        faces: {
          up: { texture: `${color}_bed_top_head` },
          down: { texture: wood },
          north: { texture: 'bed_end_head' },
          west: { texture: `${color}_bed_side_head`, uv: [16, 7, 0, 13] },
          east: { texture: `${color}_bed_side_head` },
        },
      },
      leg(0, 0),
      leg(13, 0),
    ],
  };
  MODELS[`block/${name}_foot`] = {
    elements: [
      {
        from: [0, 3, 0], to: [16, 9, 16],
        faces: {
          up: { texture: `${color}_bed_top_foot` },
          down: { texture: wood },
          south: { texture: `${color}_bed_end_foot` },
          west: { texture: `${color}_bed_side_foot` },
          east: { texture: `${color}_bed_side_foot` },
        },
      },
      leg(0, 13),
      leg(13, 13),
    ],
  };
  const y: Record<string, Rot> = { north: 0, east: 90, south: 180, west: 270 };
  const variants: Record<string, ModelRef> = {};
  for (const facing of ['north', 'south', 'west', 'east'])
    for (const part of ['head', 'foot']) variants[`facing=${facing},part=${part}`] = { model: `block/${name}_${part}`, y: y[facing]! };
  return { variants };
}

export function trapdoorDef(name: string, texture: string): BlockStateDef {
  const bottom = model(`${name}_bottom`, 'trapdoor_bottom', { texture });
  const top = model(`${name}_top`, 'trapdoor_top', { texture });
  const open = model(`${name}_open`, 'trapdoor_open', { texture });
  const variants: Record<string, ModelRef> = {};
  // open model sits against the south edge; rotate so it lies against the side opposite `facing`
  const openY: Record<string, Rot> = { north: 0, east: 90, south: 180, west: 270 };
  for (const facing of ['north', 'south', 'west', 'east'])
    for (const half of ['bottom', 'top']) {
      variants[`facing=${facing},half=${half},open=false`] = { model: half === 'top' ? top : bottom };
      variants[`facing=${facing},half=${half},open=true`] = { model: open, y: openY[facing]! };
    }
  return { variants };
}

/** Fluids are drawn by the mesher's fluid renderer, not models. */
export const FLUID_BLOCKS = new Set(['water', 'lava']);

function buttonDef(name: string, texture: string): BlockStateDef {
  const up = model(name, 'button', { texture });
  const down = model(`${name}_pressed`, 'button_pressed', { texture });
  const variants: Record<string, ModelRef> = {};
  for (const face of ['floor', 'wall', 'ceiling'])
    for (const facing of ['north', 'south', 'west', 'east'])
      for (const powered of ['false', 'true']) {
        const x: Rot = face === 'floor' ? 0 : face === 'wall' ? 90 : 180;
        let y = Y_OF[facing]!;
        if (face === 'ceiling') y = ((y + 180) % 360) as Rot;
        variants[`face=${face},facing=${facing},powered=${powered}`] = { model: powered === 'true' ? down : up, x, y, uvlock: face === 'wall' };
      }
  return { variants };
}

/**
 * Textures of the full block a slab/stairs/wall/fence/button is made of: planks for woods,
 * `<base>s` for bricks, the sandstone top/bottom faces, smooth variants' top texture.
 */
function materialTextures(base: string, has: (t: string) => boolean): { top: string; bottom: string; side: string } | null {
  const all = (t: string) => ({ top: t, bottom: t, side: t });
  if (has(`${base}_planks`)) return all(`${base}_planks`);
  if (base === 'smooth_stone' && has('smooth_stone_slab_side')) return { top: 'smooth_stone', bottom: 'smooth_stone', side: 'smooth_stone_slab_side' };
  const sandstone = /^(smooth_|cut_)?(red_)?sandstone$/.exec(base);
  if (sandstone) {
    const top = `${sandstone[2] ?? ''}sandstone_top`;
    if (sandstone[1] === 'smooth_') return all(top);
    if (sandstone[1] === 'cut_') return { top, bottom: top, side: base };
    return { top, bottom: `${sandstone[2] ?? ''}sandstone_bottom`, side: base };
  }
  for (const t of [base, `${base}s`, `${base}_block`]) if (has(t)) return all(t);
  return null;
}

export function blockStateDef(name: string, hasTexture: (t: string) => boolean): BlockStateDef {
  const ex = EXPLICIT[name] ?? NATURAL[name] ?? CRAFTED[name];
  if (ex) return ex();
  if (FLUID_BLOCKS.has(name)) return { variants: {} };
  // waxed copper looks exactly like its unwaxed counterpart
  if (name.startsWith('waxed_')) return blockStateDef(name === 'waxed_copper_block' ? 'copper_block' : name.slice(6), hasTexture);
  if (name.endsWith('_door') && hasTexture(`${name}_top`)) return doorDef(name, `${name}_top`, `${name}_bottom`);
  if (name.endsWith('_trapdoor') && hasTexture(name)) return trapdoorDef(name, name);
  if (name.endsWith('_pressure_plate')) {
    const base = name.slice(0, -'_pressure_plate'.length);
    const tex = base === 'light_weighted' ? 'gold_block' : base === 'heavy_weighted' ? 'iron_block' : materialTextures(base, hasTexture)?.side;
    if (tex && hasTexture(tex)) {
      return {
        variants: {
          'powered=false': { model: model(name, 'pressure_plate_up', { texture: tex }) },
          'powered=true': { model: model(`${name}_down`, 'pressure_plate_down', { texture: tex }) },
          'power=0': { model: model(name, 'pressure_plate_up', { texture: tex }) },
          '': { model: model(`${name}_down`, 'pressure_plate_down', { texture: tex }) },
        },
      };
    }
  }
  if (name.endsWith('_bed')) return bedDef(name);
  if (name === 'scaffolding') return scaffoldingDef();
  if (name.endsWith('_leaves')) return single({ model: model(name, 'leaves', { all: name }) });
  if ((name.endsWith('_log') || name.endsWith('_stem')) && hasTexture(name)) return column(name, name, `${name}_top`);
  if (name.endsWith('_wood') || name.endsWith('_hyphae')) {
    const log = name.replace(/_wood$/, '_log').replace(/_hyphae$/, '_stem');
    if (hasTexture(log)) return column(name, log, log);
  }
  for (const suffix of ['_slab', '_stairs', '_wall', '_fence', '_button'] as const) {
    if (!name.endsWith(suffix)) continue;
    const tex = materialTextures(name.slice(0, -suffix.length), hasTexture);
    if (!tex) break;
    if (suffix === '_slab') {
      const dbl = tex.top === tex.side ? model(`${name}_double`, 'cube_all', { all: tex.side }) : model(`${name}_double`, 'cube_bottom_top', tex);
      return slab(name, tex, dbl);
    }
    if (suffix === '_stairs') return stairs(name, tex);
    if (suffix === '_wall') return wallDef(name, tex.side);
    if (suffix === '_fence') return fenceDef(name, tex.side);
    return buttonDef(name, tex.side);
  }
  if (hasTexture(name)) return single({ model: model(name, 'cube_all', { all: name }) });
  return single({ model: 'missing' });
}
