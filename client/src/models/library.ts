/**
 * Base model library (our own JSON models). Block-specific models inherit from these.
 */
import type { BlockModel, ModelElement, ModelFace, FaceName } from './format';

const ALL: FaceName[] = ['down', 'up', 'north', 'south', 'west', 'east'];

function faces(tex: (f: FaceName) => string, opts: { cull?: boolean; tint?: number; uv?: (f: FaceName) => ModelFace['uv'] } = {}): ModelElement['faces'] {
  const out: ModelElement['faces'] = {};
  for (const f of ALL) {
    out[f] = { texture: tex(f), ...(opts.cull !== false ? { cull: f } : {}), ...(opts.tint !== undefined ? { tint: opts.tint } : {}), ...(opts.uv ? { uv: opts.uv(f) } : {}) };
  }
  return out;
}

export const MODELS: Record<string, BlockModel> = {
  // ---------------------------------------------------------------- cubes
  cube: {
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: faces((f) => `#${f}`) }],
  },
  cube_all: { parent: 'cube', textures: { down: '#all', up: '#all', north: '#all', south: '#all', west: '#all', east: '#all' } },
  cube_column: { parent: 'cube', textures: { down: '#end', up: '#end', north: '#side', south: '#side', west: '#side', east: '#side' } },
  cube_bottom_top: { parent: 'cube', textures: { down: '#bottom', up: '#top', north: '#side', south: '#side', west: '#side', east: '#side' } },
  cube_tinted_all: {
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: faces(() => '#all', { tint: 0 }) }],
  },
  leaves: { parent: 'cube_tinted_all' },
  grass_block: {
    elements: [
      {
        from: [0, 0, 0], to: [16, 16, 16],
        faces: {
          down: { texture: '#bottom', cull: 'down' },
          up: { texture: '#top', cull: 'up', tint: 0 },
          north: { texture: '#side', cull: 'north' },
          south: { texture: '#side', cull: 'south' },
          west: { texture: '#side', cull: 'west' },
          east: { texture: '#side', cull: 'east' },
        },
      },
      {
        from: [0, 0, 0], to: [16, 16, 16],
        faces: {
          north: { texture: '#overlay', cull: 'north', tint: 0 },
          south: { texture: '#overlay', cull: 'south', tint: 0 },
          west: { texture: '#overlay', cull: 'west', tint: 0 },
          east: { texture: '#overlay', cull: 'east', tint: 0 },
        },
      },
    ],
  },

  // ---------------------------------------------------------------- plants
  cross: {
    ao: false,
    elements: [
      {
        from: [0.8, 0, 8], to: [15.2, 16, 8], shade: false,
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        faces: { north: { texture: '#cross', uv: [0, 0, 16, 16] }, south: { texture: '#cross', uv: [0, 0, 16, 16] } },
      },
      {
        from: [8, 0, 0.8], to: [8, 16, 15.2], shade: false,
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        faces: { west: { texture: '#cross', uv: [0, 0, 16, 16] }, east: { texture: '#cross', uv: [0, 0, 16, 16] } },
      },
    ],
  },
  tinted_cross: {
    ao: false,
    elements: [
      {
        from: [0.8, 0, 8], to: [15.2, 16, 8], shade: false,
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        faces: { north: { texture: '#cross', uv: [0, 0, 16, 16], tint: 0 }, south: { texture: '#cross', uv: [0, 0, 16, 16], tint: 0 } },
      },
      {
        from: [8, 0, 0.8], to: [8, 16, 15.2], shade: false,
        rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
        faces: { west: { texture: '#cross', uv: [0, 0, 16, 16], tint: 0 }, east: { texture: '#cross', uv: [0, 0, 16, 16], tint: 0 } },
      },
    ],
  },

  // ---------------------------------------------------------------- torches
  torch: {
    ao: false,
    elements: [
      {
        from: [7, 0, 7], to: [9, 10, 9], shade: false,
        faces: {
          down: { texture: '#torch', uv: [7, 13, 9, 15] },
          up: { texture: '#torch', uv: [7, 6, 9, 8] },
          north: { texture: '#torch', uv: [7, 6, 9, 16] },
          south: { texture: '#torch', uv: [7, 6, 9, 16] },
          west: { texture: '#torch', uv: [7, 6, 9, 16] },
          east: { texture: '#torch', uv: [7, 6, 9, 16] },
        },
      },
    ],
  },
  wall_torch: {
    ao: false,
    elements: [
      {
        from: [-1, 3.5, 7], to: [1, 13.5, 9], shade: false,
        rotation: { origin: [0, 3.5, 8], axis: 'z', angle: -22.5 },
        faces: {
          down: { texture: '#torch', uv: [7, 13, 9, 15] },
          up: { texture: '#torch', uv: [7, 6, 9, 8] },
          north: { texture: '#torch', uv: [7, 6, 9, 16] },
          south: { texture: '#torch', uv: [7, 6, 9, 16] },
          west: { texture: '#torch', uv: [7, 6, 9, 16] },
          east: { texture: '#torch', uv: [7, 6, 9, 16] },
        },
      },
    ],
  },

  // ---------------------------------------------------------------- partial blocks
  slab: {
    elements: [
      {
        from: [0, 0, 0], to: [16, 8, 16],
        faces: {
          down: { texture: '#bottom', cull: 'down' },
          up: { texture: '#top' },
          north: { texture: '#side', uv: [0, 8, 16, 16], cull: 'north' },
          south: { texture: '#side', uv: [0, 8, 16, 16], cull: 'south' },
          west: { texture: '#side', uv: [0, 8, 16, 16], cull: 'west' },
          east: { texture: '#side', uv: [0, 8, 16, 16], cull: 'east' },
        },
      },
    ],
  },
  slab_top: {
    elements: [
      {
        from: [0, 8, 0], to: [16, 16, 16],
        faces: {
          down: { texture: '#bottom' },
          up: { texture: '#top', cull: 'up' },
          north: { texture: '#side', uv: [0, 0, 16, 8], cull: 'north' },
          south: { texture: '#side', uv: [0, 0, 16, 8], cull: 'south' },
          west: { texture: '#side', uv: [0, 0, 16, 8], cull: 'west' },
          east: { texture: '#side', uv: [0, 0, 16, 8], cull: 'east' },
        },
      },
    ],
  },
  stairs: {
    elements: [
      box([0, 0, 0], [16, 8, 16], { down: 'bottom', up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['down', 'north', 'south', 'west', 'east']),
      box([8, 8, 0], [16, 16, 16], { up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['up', 'north', 'south', 'east']),
    ],
  },
  inner_stairs: {
    elements: [
      box([0, 0, 0], [16, 8, 16], { down: 'bottom', up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['down', 'north', 'south', 'west', 'east']),
      box([8, 8, 0], [16, 16, 16], { up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['up', 'north', 'south', 'east']),
      box([0, 8, 8], [8, 16, 16], { up: 'top', north: 'side', south: 'side', west: 'side' }, ['up', 'south', 'west']),
    ],
  },
  outer_stairs: {
    elements: [
      box([0, 0, 0], [16, 8, 16], { down: 'bottom', up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['down', 'north', 'south', 'west', 'east']),
      box([8, 8, 8], [16, 16, 16], { up: 'top', north: 'side', south: 'side', west: 'side', east: 'side' }, ['up', 'south', 'east']),
    ],
  },
  carpet: {
    elements: [box([0, 0, 0], [16, 1, 16], { down: 'wool', up: 'wool', north: 'wool', south: 'wool', west: 'wool', east: 'wool' }, ['down', 'north', 'south', 'west', 'east'])],
  },
  pressure_plate_up: {
    elements: [box([1, 0, 1], [15, 1, 15], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, ['down'])],
  },
  pressure_plate_down: {
    elements: [box([1, 0, 1], [15, 0.5, 15], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, ['down'])],
  },
  button: {
    elements: [box([5, 0, 6], [11, 2, 10], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, [])],
  },
  button_pressed: {
    elements: [box([5, 0, 6], [11, 1, 10], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, [])],
  },
  fence_post: {
    elements: [box([6, 0, 6], [10, 16, 10], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, ['down', 'up'])],
  },
  fence_side: {
    elements: [
      box([7, 12, 0], [9, 15, 9], { down: 'texture', up: 'texture', north: 'texture', west: 'texture', east: 'texture' }, ['north']),
      box([7, 6, 0], [9, 9, 9], { down: 'texture', up: 'texture', north: 'texture', west: 'texture', east: 'texture' }, ['north']),
    ],
  },
  wall_post: {
    elements: [box([4, 0, 4], [12, 16, 12], { down: 'wall', up: 'wall', north: 'wall', south: 'wall', west: 'wall', east: 'wall' }, ['down', 'up'])],
  },
  wall_side: {
    elements: [box([5, 0, 0], [11, 14, 8], { down: 'wall', up: 'wall', north: 'wall', west: 'wall', east: 'wall' }, ['down', 'north'])],
  },
  wall_side_tall: {
    elements: [box([5, 0, 0], [11, 16, 8], { down: 'wall', up: 'wall', north: 'wall', west: 'wall', east: 'wall' }, ['down', 'up', 'north'])],
  },
  pane_post: {
    elements: [box([7, 0, 7], [9, 16, 9], { down: 'edge', up: 'edge', north: 'edge', south: 'edge', west: 'edge', east: 'edge' }, ['down', 'up'])],
  },
  pane_side: {
    elements: [
      {
        from: [7, 0, 0], to: [9, 16, 7],
        faces: {
          down: { texture: '#edge', uv: [7, 0, 9, 7], cull: 'down' },
          up: { texture: '#edge', uv: [7, 0, 9, 7], cull: 'up' },
          north: { texture: '#edge', cull: 'north', uv: [7, 0, 9, 16] },
          west: { texture: '#pane', uv: [16, 0, 9, 16] },
          east: { texture: '#pane', uv: [9, 0, 16, 16] },
        },
      },
    ],
  },
  door_bottom: {
    elements: [
      {
        from: [0, 0, 0], to: [3, 16, 16],
        faces: {
          down: { texture: '#bottom', uv: [13, 0, 16, 16], cull: 'down' },
          north: { texture: '#bottom', uv: [3, 0, 0, 16], cull: 'north' },
          south: { texture: '#bottom', uv: [0, 0, 3, 16], cull: 'south' },
          west: { texture: '#bottom', uv: [16, 0, 0, 16], cull: 'west' },
          east: { texture: '#bottom', uv: [0, 0, 16, 16] },
        },
      },
    ],
  },
  door_top: {
    elements: [
      {
        from: [0, 0, 0], to: [3, 16, 16],
        faces: {
          up: { texture: '#top', uv: [13, 0, 16, 16], cull: 'up' },
          north: { texture: '#top', uv: [3, 0, 0, 16], cull: 'north' },
          south: { texture: '#top', uv: [0, 0, 3, 16], cull: 'south' },
          west: { texture: '#top', uv: [16, 0, 0, 16], cull: 'west' },
          east: { texture: '#top', uv: [0, 0, 16, 16] },
        },
      },
    ],
  },
  trapdoor_bottom: {
    elements: [box([0, 0, 0], [16, 3, 16], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, ['down', 'north', 'south', 'west', 'east'])],
  },
  trapdoor_top: {
    elements: [box([0, 13, 0], [16, 16, 16], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, ['up', 'north', 'south', 'west', 'east'])],
  },
  trapdoor_open: {
    elements: [box([0, 0, 13], [16, 16, 16], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, ['down', 'up', 'south', 'west', 'east'])],
  },
  ladder: {
    ao: false,
    elements: [{ from: [0, 0, 15.2], to: [16, 16, 15.2], shade: false, faces: { north: { texture: '#texture' }, south: { texture: '#texture' } } }],
  },
  rail_flat: {
    ao: false,
    elements: [{ from: [0, 1, 0], to: [16, 1, 16], faces: { up: { texture: '#rail', uv: [0, 0, 16, 16] }, down: { texture: '#rail', uv: [0, 16, 16, 0] } } }],
  },
  rail_raised_ne: {
    ao: false,
    elements: [
      {
        from: [0, 9, 0], to: [16, 9, 16],
        rotation: { origin: [8, 9, 8], axis: 'x', angle: 45, rescale: true },
        faces: { up: { texture: '#rail', uv: [0, 0, 16, 16] }, down: { texture: '#rail', uv: [0, 16, 16, 0] } },
      },
    ],
  },
  lever: {
    elements: [
      box([5, 0, 4], [11, 3, 12], { down: 'base', up: 'base', north: 'base', south: 'base', west: 'base', east: 'base' }, ['down']),
      {
        from: [7, 1, 7], to: [9, 11, 9],
        rotation: { origin: [8, 1, 8], axis: 'x', angle: -45 },
        faces: {
          up: { texture: '#lever', uv: [7, 6, 9, 8] },
          north: { texture: '#lever', uv: [7, 6, 9, 16] },
          south: { texture: '#lever', uv: [7, 6, 9, 16] },
          west: { texture: '#lever', uv: [7, 6, 9, 16] },
          east: { texture: '#lever', uv: [7, 6, 9, 16] },
        },
      },
    ],
  },
  vine: {
    ao: false,
    elements: [{ from: [0, 0, 0.8], to: [16, 16, 0.8], shade: false, faces: { north: { texture: '#vine', uv: [16, 0, 0, 16], tint: 0 }, south: { texture: '#vine', uv: [0, 0, 16, 16], tint: 0 } } }],
  },
  crop: {
    ao: false,
    elements: [0, 1].flatMap((i) => [
      { from: [4, -1, 0], to: [4, 15, 16], shade: false, faces: { west: { texture: '#crop', uv: [0, 0, 16, 16] }, east: { texture: '#crop', uv: [0, 0, 16, 16] } } },
      { from: [12, -1, 0], to: [12, 15, 16], shade: false, faces: { west: { texture: '#crop', uv: [0, 0, 16, 16] }, east: { texture: '#crop', uv: [0, 0, 16, 16] } } },
      { from: [0, -1, 4], to: [16, 15, 4], shade: false, faces: { north: { texture: '#crop', uv: [0, 0, 16, 16] }, south: { texture: '#crop', uv: [0, 0, 16, 16] } } },
      { from: [0, -1, 12], to: [16, 15, 12], shade: false, faces: { north: { texture: '#crop', uv: [0, 0, 16, 16] }, south: { texture: '#crop', uv: [0, 0, 16, 16] } } },
    ].slice(i * 4, i * 4 + 4)) as ModelElement[],
  },
  cactus: {
    elements: [
      box([0, 0, 0], [16, 16, 16], { down: 'bottom', up: 'top' }, ['down', 'up']),
      { from: [0, 0, 1], to: [16, 16, 15], faces: { north: { texture: '#side' }, south: { texture: '#side' } } },
      { from: [1, 0, 0], to: [15, 16, 16], faces: { west: { texture: '#side' }, east: { texture: '#side' } } },
    ],
  },
  farmland: {
    elements: [box([0, 0, 0], [16, 15, 16], { down: 'dirt', up: 'top', north: 'dirt', south: 'dirt', west: 'dirt', east: 'dirt' }, ['down', 'north', 'south', 'west', 'east'])],
  },
  missing: { parent: 'cube_all', textures: { all: 'missing' } },
};

// snow layers 1..8 (height 2·n pixels); layer 8 is a full block
for (let n = 1; n <= 8; n++) {
  const h = n * 2;
  MODELS[`snow_height${h}`] = {
    elements: [box([0, 0, 0], [16, h, 16], { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, n === 8 ? ['down', 'up', 'north', 'south', 'west', 'east'] : ['down', 'north', 'south', 'west', 'east'])],
  };
}

/** A box element whose faces use `#var` textures, UVs projected from the box, with listed cull faces. */
export function box(
  from: [number, number, number],
  to: [number, number, number],
  tex: Partial<Record<FaceName, string>>,
  cull: FaceName[],
): ModelElement {
  const f: ModelElement['faces'] = {};
  for (const name of ALL) {
    const t = tex[name];
    if (!t) continue;
    f[name] = { texture: `#${t}`, ...(cull.includes(name) ? { cull: name } : {}) };
  }
  return { from, to, faces: f };
}
