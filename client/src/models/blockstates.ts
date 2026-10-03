/**
 * Blockstate definitions: which (rotated) models each block state uses.
 * Block-specific models are registered into MODELS as `block/<name>`.
 */
import type { BlockStateDef, ModelRef } from './format';
import { MODELS } from './library';

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
  ice: () => single({ model: model('ice', 'cube_all', { all: 'ice' }) }),
};

/** Fluids are drawn by the mesher's fluid renderer, not models. */
export const FLUID_BLOCKS = new Set(['water', 'lava']);

export function blockStateDef(name: string, hasTexture: (t: string) => boolean): BlockStateDef {
  const ex = EXPLICIT[name];
  if (ex) return ex();
  if (FLUID_BLOCKS.has(name)) return { variants: {} };
  if (name.endsWith('_leaves')) return single({ model: model(name, 'leaves', { all: name }) });
  if ((name.endsWith('_log') || name.endsWith('_stem')) && hasTexture(name)) return column(name, name, `${name}_top`);
  if (name.endsWith('_wood') || name.endsWith('_hyphae')) {
    const log = name.replace(/_wood$/, '_log').replace(/_hyphae$/, '_stem');
    if (hasTexture(log)) return column(name, log, log);
  }
  if (name.endsWith('_slab')) {
    const base = name.replace(/_slab$/, '');
    const tex = hasTexture(`${base}_planks`) ? `${base}_planks` : base;
    if (hasTexture(tex)) return slab(name, { top: tex, bottom: tex, side: tex }, model(`${name}_double`, 'cube_all', { all: tex }));
  }
  if (name.endsWith('_stairs')) {
    const base = name.replace(/_stairs$/, '');
    const tex = hasTexture(`${base}_planks`) ? `${base}_planks` : base;
    if (hasTexture(tex)) return stairs(name, { top: tex, bottom: tex, side: tex });
  }
  if (hasTexture(name)) return single({ model: model(name, 'cube_all', { all: name }) });
  return single({ model: 'missing' });
}
