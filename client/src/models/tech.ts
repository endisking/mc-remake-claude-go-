/**
 * Blockstate definitions for redstone components, workstations and special blocks:
 * redstone dust, special rails, repeaters, comparators, pistons, hoppers, cauldrons,
 * enchanting table, anvils, brewing stand, cakes, campfires, barrels, smoker, blast furnace,
 * job-site blocks, signs, banners, skulls, candles, End blocks and invisible technical blocks.
 * Geometry follows vanilla block shapes (game facts), simplified where vanilla uses a
 * block-entity renderer (signs, banners, skulls, chests).
 */
import type { BlockModel, BlockStateDef, FaceName, ModelElement, ModelRef } from './format';
import { MODELS } from './library';

type Rot = 0 | 90 | 180 | 270;
type V3 = [number, number, number];
type UV = [number, number, number, number];
const HORIZONTAL = ['north', 'east', 'south', 'west'] as const;
const Y_OF: Record<string, Rot> = { north: 0, east: 90, south: 180, west: 270 };
/** Base model built for facing=south (vanilla diode/anvil convention). */
const Y_SOUTH: Record<string, Rot> = { south: 0, west: 90, north: 180, east: 270 };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

function reg(name: string, m: BlockModel): string {
  MODELS[`block/${name}`] = m;
  return `block/${name}`;
}
const single = (ref: ModelRef): BlockStateDef => ({ variants: { '': ref } });
const ALL6: FaceName[] = ['down', 'up', 'north', 'south', 'west', 'east'];
/** Box with one texture per face (or a single texture) and optional per-face UVs. */
function bx(from: V3, to: V3, tex: string | Partial<Record<FaceName, string>>, opts: { uv?: Partial<Record<FaceName, UV>>; cull?: FaceName[]; skip?: FaceName[]; tint?: boolean } = {}): ModelElement {
  const faces: ModelElement['faces'] = {};
  for (const f of ALL6) {
    if (opts.skip?.includes(f)) continue;
    const t = typeof tex === 'string' ? tex : tex[f];
    if (!t) continue;
    faces[f] = { texture: t, ...(opts.uv?.[f] ? { uv: opts.uv[f] } : {}), ...(opts.cull?.includes(f) ? { cull: f } : {}), ...(opts.tint ? { tint: 0 } : {}) };
  }
  return { from, to, faces };
}
function plane(from: V3, to: V3, tex: string, a: FaceName, b: FaceName, uv: UV = [0, 0, 16, 16], tint = false, rotation?: ModelElement['rotation']): ModelElement {
  const f = { texture: tex, uv, ...(tint ? { tint: 0 } : {}) };
  return { from, to, shade: false, ...(rotation ? { rotation } : {}), faces: { [a]: { ...f }, [b]: { ...f } } };
}
function crossEls(tex: string, y0 = 0, y1 = 16, uv: UV = [0, 0, 16, 16], inset = 0.8): ModelElement[] {
  const rot = { origin: [8, 8, 8] as V3, axis: 'y' as const, angle: 45, rescale: true };
  return [plane([inset, y0, 8], [16 - inset, y1, 8], tex, 'north', 'south', uv, false, rot), plane([8, y0, inset], [8, y1, 16 - inset], tex, 'west', 'east', uv, false, rot)];
}
function rotated(id: string, table: Record<string, Rot>, extra = ''): Record<string, ModelRef> {
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) v[`facing=${f}${extra}`] = { model: id, y: table[f]! };
  return v;
}
function sixWay(id: string, extra = ''): Record<string, ModelRef> {
  return { ...rotated(id, Y_OF, extra), [`facing=up${extra}`]: { model: id, x: 270 }, [`facing=down${extra}`]: { model: id, x: 90 } };
}

// ------------------------------------------------------------------ redstone
function redstoneWireDef(): BlockStateDef {
  const dot = reg('redstone_dust_dot', { ao: false, elements: [{ from: [0, 0.25, 0], to: [16, 0.25, 16], shade: false, faces: { up: { texture: 'redstone_dust_dot', uv: [0, 0, 16, 16], tint: 0 } } }] });
  const side = reg('redstone_dust_side', { ao: false, elements: [{ from: [0, 0.25, 0], to: [16, 0.25, 8], shade: false, faces: { up: { texture: 'redstone_dust_line', uv: [0, 0, 16, 8], tint: 0 } } }] });
  const up = reg('redstone_dust_up', { ao: false, elements: [{ from: [0, 0, 0.25], to: [16, 16, 0.25], shade: false, faces: { south: { texture: 'redstone_dust_line', uv: [0, 0, 16, 16], tint: 0 } } }] });
  const conn = 'side|up';
  const parts: NonNullable<BlockStateDef['multipart']> = [
    {
      when: { OR: [
        { north: 'none', east: 'none', south: 'none', west: 'none' },
        { north: conn, east: conn }, { east: conn, south: conn }, { south: conn, west: conn }, { west: conn, north: conn },
      ] },
      apply: { model: dot },
    },
  ];
  for (const d of HORIZONTAL) {
    parts.push({ when: { [d]: conn }, apply: { model: side, y: Y_OF[d]! } });
    parts.push({ when: { [d]: 'up' }, apply: { model: up, y: Y_OF[d]! } });
  }
  return { multipart: parts };
}
function specialRailDef(name: string): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (const powered of ['false', 'true']) {
    const tex = powered === 'true' ? `${name}_on` : name;
    const flat = reg(`${name}${powered === 'true' ? '_on' : ''}`, { parent: 'rail_flat', textures: { rail: tex } });
    const raised = reg(`${name}${powered === 'true' ? '_on' : ''}_raised`, { parent: 'rail_raised_ne', textures: { rail: tex } });
    v[`powered=${powered},shape=north_south`] = { model: flat };
    v[`powered=${powered},shape=east_west`] = { model: flat, y: 90 };
    v[`powered=${powered},shape=ascending_north`] = { model: raised };
    v[`powered=${powered},shape=ascending_east`] = { model: raised, y: 90 };
    v[`powered=${powered},shape=ascending_south`] = { model: raised, y: 180 };
    v[`powered=${powered},shape=ascending_west`] = { model: raised, y: 270 };
  }
  return { variants: v };
}
const TORCH_UV: Partial<Record<FaceName, UV>> = { up: [7, 6, 9, 8], north: [7, 6, 9, 11], south: [7, 6, 9, 11], west: [7, 6, 9, 11], east: [7, 6, 9, 11] };
function diodeTorch(x: number, z: number, on: boolean, h = 7): ModelElement {
  return bx([x, 2, z], [x + 2, h, z + 2], on ? 'redstone_torch' : 'redstone_torch_off', { uv: TORCH_UV, skip: ['down'] });
}
function diodeBase(tex: string): ModelElement {
  return bx([0, 0, 0], [16, 2, 16], { up: tex, down: 'smooth_stone', north: 'smooth_stone_slab_side', south: 'smooth_stone_slab_side', west: 'smooth_stone_slab_side', east: 'smooth_stone_slab_side' },
    { cull: ['down'], uv: { north: [0, 14, 16, 16], south: [0, 14, 16, 16], west: [0, 14, 16, 16], east: [0, 14, 16, 16] } });
}
function repeaterDef(): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (let delay = 1; delay <= 4; delay++)
    for (const powered of [false, true])
      for (const locked of [false, true]) {
        const back = 4 + delay * 2;
        const els = [diodeBase(powered ? 'repeater_on' : 'repeater'), diodeTorch(7, 2, powered)];
        els.push(locked ? bx([2, 2, back], [14, 4, back + 2], 'bedrock') : diodeTorch(7, back, powered));
        const id = reg(`repeater_${delay}tick${powered ? '_on' : ''}${locked ? '_locked' : ''}`, { elements: els });
        for (const f of HORIZONTAL) v[`delay=${delay},facing=${f},locked=${locked},powered=${powered}`] = { model: id, y: Y_SOUTH[f]! };
      }
  return { variants: v };
}
function comparatorDef(): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (const powered of [false, true])
    for (const mode of ['compare', 'subtract']) {
      const els = [diodeBase(powered ? 'comparator_on' : 'comparator'), diodeTorch(4, 11, powered), diodeTorch(10, 11, powered), diodeTorch(7, 2, mode === 'subtract', mode === 'subtract' ? 6 : 5)];
      const id = reg(`comparator${powered ? '_on' : ''}${mode === 'subtract' ? '_subtract' : ''}`, { elements: els });
      for (const f of HORIZONTAL) v[`facing=${f},mode=${mode},powered=${powered}`] = { model: id, y: Y_SOUTH[f]! };
    }
  return { variants: v };
}
/** Six-way facing for models built with their front facing up (vanilla piston convention). */
function upFacing(id: string, extra = ''): Record<string, ModelRef> {
  return {
    [`facing=up${extra}`]: { model: id }, [`facing=down${extra}`]: { model: id, x: 180 },
    [`facing=north${extra}`]: { model: id, x: 90 }, [`facing=south${extra}`]: { model: id, x: 90, y: 180 },
    [`facing=east${extra}`]: { model: id, x: 90, y: 90 }, [`facing=west${extra}`]: { model: id, x: 90, y: 270 },
  };
}
function pistonDef(sticky: boolean): BlockStateDef {
  const top = sticky ? 'piston_top_sticky' : 'piston_top';
  const normal = reg(sticky ? 'sticky_piston' : 'piston', { parent: 'cube_bottom_top', textures: { top, bottom: 'piston_bottom', side: 'piston_side' } });
  const sideUV: UV = [0, 4, 16, 16];
  const base = reg('piston_base', {
    elements: [bx([0, 0, 0], [16, 12, 16], { up: 'piston_inner', down: 'piston_bottom', north: 'piston_side', south: 'piston_side', west: 'piston_side', east: 'piston_side' },
      { cull: ['down', 'north', 'south', 'west', 'east'], uv: { north: sideUV, south: sideUV, west: sideUV, east: sideUV } })],
  });
  return { variants: { ...upFacing(normal, ',extended=false'), ...upFacing(base, ',extended=true') } };
}
function pistonHeadDef(): BlockStateDef {
  const plateUV: UV = [0, 0, 16, 4], armUV: UV = [0, 0, 4, 16];
  const mk = (name: string, face: string, short: boolean) => reg(name, {
    elements: [
      bx([0, 12, 0], [16, 16, 16], { up: face, down: face, north: 'piston_side', south: 'piston_side', west: 'piston_side', east: 'piston_side' }, { cull: ['up'], uv: { north: plateUV, south: plateUV, west: plateUV, east: plateUV } }),
      bx([6, short ? 0 : -4, 6], [10, 12, 10], 'piston_side', { skip: ['up', 'down'], uv: { north: armUV, south: armUV, west: armUV, east: armUV } }),
    ],
  });
  const v: Record<string, ModelRef> = {};
  for (const type of ['normal', 'sticky'])
    for (const short of [false, true]) {
      const id = mk(`piston_head${type === 'sticky' ? '_sticky' : ''}${short ? '_short' : ''}`, type === 'sticky' ? 'piston_top_sticky' : 'piston_top', short);
      Object.assign(v, upFacing(id, `,short=${short},type=${type}`));
    }
  return { variants: v };
}
function hopperDef(): BlockStateDef {
  const T = { up: 'hopper_top', down: 'hopper_outside', north: 'hopper_outside', south: 'hopper_outside', west: 'hopper_outside', east: 'hopper_outside' };
  const bowl: ModelElement[] = [
    bx([0, 10, 0], [16, 11, 16], { down: 'hopper_outside', up: 'hopper_inside', north: 'hopper_outside', south: 'hopper_outside', west: 'hopper_outside', east: 'hopper_outside' }),
    bx([0, 11, 0], [2, 16, 16], T, { cull: ['up', 'west'] }), bx([14, 11, 0], [16, 16, 16], T, { cull: ['up', 'east'] }),
    bx([2, 11, 0], [14, 16, 2], T, { cull: ['up', 'north'] }), bx([2, 11, 14], [14, 16, 16], T, { cull: ['up', 'south'] }),
    bx([4, 4, 4], [12, 10, 12], 'hopper_outside'),
  ];
  const down = reg('hopper', { elements: [...bowl, bx([6, 0, 6], [10, 4, 10], 'hopper_outside', { cull: ['down'] })] });
  const side = reg('hopper_side', { elements: [...bowl, bx([6, 4, 0], [10, 8, 4], 'hopper_outside', { cull: ['north'] })] });
  return { variants: { 'facing=down': { model: down }, ...rotated(side, Y_OF) } };
}
function cauldronEls(): ModelElement[] {
  const s = { up: 'cauldron_top', down: 'cauldron_bottom', north: 'cauldron_side', south: 'cauldron_side', west: 'cauldron_side', east: 'cauldron_side' };
  return [
    bx([0, 3, 0], [2, 16, 16], s, { cull: ['west', 'up'] }), bx([14, 3, 0], [16, 16, 16], s, { cull: ['east', 'up'] }),
    bx([2, 3, 0], [14, 16, 2], s, { cull: ['north', 'up'] }), bx([2, 3, 14], [14, 16, 16], s, { cull: ['south', 'up'] }),
    bx([2, 3, 2], [14, 4, 14], { up: 'cauldron_inner', down: 'cauldron_bottom' }),
    bx([0, 0, 0], [4, 3, 2], 'cauldron_side', { cull: ['down'] }), bx([0, 0, 2], [2, 3, 4], 'cauldron_side', { cull: ['down'] }),
    bx([12, 0, 0], [16, 3, 2], 'cauldron_side', { cull: ['down'] }), bx([14, 0, 2], [16, 3, 4], 'cauldron_side', { cull: ['down'] }),
    bx([0, 0, 14], [4, 3, 16], 'cauldron_side', { cull: ['down'] }), bx([0, 0, 12], [2, 3, 14], 'cauldron_side', { cull: ['down'] }),
    bx([12, 0, 14], [16, 3, 16], 'cauldron_side', { cull: ['down'] }), bx([14, 0, 12], [16, 3, 14], 'cauldron_side', { cull: ['down'] }),
  ];
}
function cauldronDef(kind: 'empty' | 'water' | 'lava' | 'powder_snow'): BlockStateDef {
  const base = cauldronEls();
  const surface = (h: number, tex: string, tint: boolean) => ({ from: [2, h, 2] as V3, to: [14, h, 14] as V3, faces: { up: { texture: tex, uv: [2, 2, 14, 14] as UV, ...(tint ? { tint: 0 } : {}) } } });
  if (kind === 'empty') return single({ model: reg('cauldron', { elements: base }) });
  if (kind === 'lava') return single({ model: reg('lava_cauldron', { elements: [...base, surface(15, 'lava_still', false)] }) });
  const v: Record<string, ModelRef> = {};
  for (let level = 1; level <= 3; level++)
    v[`level=${level}`] = { model: reg(`${kind}_cauldron_level${level}`, { elements: [...base, surface(6 + level * 3, kind === 'water' ? 'water_still' : 'powder_snow', kind === 'water')] }) };
  return { variants: v };
}
function anvilDef(name: string): BlockStateDef {
  const id = reg(name, {
    elements: [
      bx([2, 0, 2], [14, 4, 14], 'anvil', { cull: ['down'] }),
      bx([4, 4, 3], [12, 5, 13], 'anvil'),
      bx([6, 5, 4], [10, 10, 12], 'anvil'),
      bx([3, 10, 0], [13, 16, 16], { up: 'anvil_top', down: 'anvil', north: 'anvil', south: 'anvil', west: 'anvil', east: 'anvil' }),
    ],
  });
  // the long axis of the top runs along Z for facing=south/north
  return { variants: rotated(id, { south: 90, west: 180, north: 270, east: 0 }) };
}
function brewingStandDef(): BlockStateDef {
  const els: ModelElement[] = [
    bx([7, 0, 7], [9, 14, 9], 'brewing_stand', { uv: { north: [7, 2, 9, 16], south: [7, 2, 9, 16], west: [7, 2, 9, 16], east: [7, 2, 9, 16], up: [7, 2, 9, 4] }, skip: ['down'] }),
    bx([9, 0, 5], [15, 2, 11], 'brewing_stand_base', { cull: ['down'] }),
    bx([2, 0, 1], [8, 2, 7], 'brewing_stand_base', { cull: ['down'] }),
    bx([2, 0, 9], [8, 2, 15], 'brewing_stand_base', { cull: ['down'] }),
  ];
  return single({ model: reg('brewing_stand', { ao: false, elements: els }) });
}
function cakeEls(bites: number): ModelElement[] {
  const x0 = 1 + bites * 2;
  return [bx([x0, 0, 1], [15, 8, 15], { up: 'cake_top', down: 'cake_bottom', north: 'cake_side', south: 'cake_side', east: 'cake_side', west: bites > 0 ? 'cake_inner' : 'cake_side' }, { cull: ['down'] })];
}
function cakeDef(): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (let b = 0; b < 7; b++) v[`bites=${b}`] = { model: reg(`cake_slice${b}`, { elements: cakeEls(b) }) };
  return { variants: v };
}
function candleEls(tex: string, count: number): ModelElement[] {
  const layouts: [number, number, number][][] = [[[7, 7, 6]], [[5, 7, 6], [9, 6, 5]], [[7, 9, 6], [5, 6, 5], [9, 7, 3]], [[6, 8, 6], [9, 8, 5], [5, 5, 5], [8, 5, 3]]];
  const els: ModelElement[] = [];
  for (const [x, z, h] of layouts[count - 1]!) {
    const side: UV = [0, 14 - h, 2, 14];
    els.push(bx([x, 0, z], [x + 2, h, z + 2], tex, { uv: { up: [2, 8, 4, 10], down: [2, 8, 4, 10], north: side, south: side, west: side, east: side }, cull: ['down'] }));
    els.push(plane([x + 1, h, z + 0.5], [x + 1, h + 1, z + 1.5], tex, 'west', 'east', [0, 7, 1, 8]));
  }
  return els;
}
function candleDef(color: string): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (let n = 1; n <= 4; n++) v[`candles=${n}`] = { model: reg(`${color}_candle_${n}`, { ao: false, elements: candleEls(`${color}_candle`, n) }) };
  return { variants: v };
}
function candleCakeDef(tex: string, name: string): BlockStateDef {
  const els = [...cakeEls(0)];
  els.push(bx([7, 8, 7], [9, 14, 9], tex, { uv: { up: [2, 8, 4, 10], north: [0, 8, 2, 14], south: [0, 8, 2, 14], west: [0, 8, 2, 14], east: [0, 8, 2, 14] }, skip: ['down'] }));
  els.push(plane([8, 14, 7.5], [8, 15, 8.5], tex, 'west', 'east', [0, 7, 1, 8]));
  return single({ model: reg(name, { elements: els }) });
}
function campfireDef(name: string, fire: string): BlockStateDef {
  const logs = (lit: boolean): ModelElement[] => {
    const t = lit ? 'campfire_log_lit' : 'campfire_log';
    return [
      bx([1, 0, 0], [5, 4, 16], t, { cull: ['down'] }), bx([11, 0, 0], [15, 4, 16], t, { cull: ['down'] }),
      bx([0, 3, 11], [16, 7, 15], t), bx([0, 3, 1], [16, 7, 5], t),
      bx([5, 0, 5], [11, 1, 11], 'campfire_log', { cull: ['down'] }),
    ];
  };
  const lit = reg(name, { elements: [...logs(true), ...crossEls(fire, 1, 16)] });
  const off = reg(`${name}_off`, { elements: logs(false) });
  return { variants: { ...rotated(lit, Y_SOUTH, ',lit=true'), ...rotated(off, Y_SOUTH, ',lit=false') } };
}
function barrelDef(): BlockStateDef {
  const closed = reg('barrel', { parent: 'cube', textures: { north: 'barrel_top', south: 'barrel_bottom', west: 'barrel_side', east: 'barrel_side', up: 'barrel_side', down: 'barrel_side' } });
  const open = reg('barrel_open', { parent: 'cube', textures: { north: 'barrel_top_open', south: 'barrel_bottom', west: 'barrel_side', east: 'barrel_side', up: 'barrel_side', down: 'barrel_side' } });
  return { variants: { ...sixWay(open, ',open=true'), ...sixWay(closed, ',open=false') } };
}
function furnaceLike(name: string): BlockStateDef {
  const mk = (id: string, front: string) => reg(id, { parent: 'cube', textures: { north: front, south: `${name}_side`, west: `${name}_side`, east: `${name}_side`, up: `${name}_top`, down: `${name}_top` } });
  return { variants: { ...rotated(mk(`${name}_on`, `${name}_front_on`), Y_OF, ',lit=true'), ...rotated(mk(name, `${name}_front`), Y_OF, ',lit=false') } };
}
function tableDef(name: string): BlockStateDef {
  return single({ model: reg(name, { parent: 'cube', textures: { north: `${name}_front`, south: `${name}_side`, west: `${name}_front`, east: `${name}_side`, up: `${name}_top`, down: `${name}_bottom` } }) });
}
function loomDef(): BlockStateDef {
  const id = reg('loom', { parent: 'cube', textures: { north: 'loom_front', south: 'loom_side', west: 'loom_side', east: 'loom_side', up: 'loom_top', down: 'loom_bottom' } });
  return { variants: rotated(id, Y_OF) };
}
function composterDef(): BlockStateDef {
  const s = { up: 'composter_top', down: 'composter_bottom', north: 'composter_side', south: 'composter_side', west: 'composter_side', east: 'composter_side' };
  const walls: ModelElement[] = [
    bx([0, 0, 0], [16, 2, 16], s, { cull: ['down'] }),
    bx([0, 2, 0], [2, 16, 16], s, { cull: ['west', 'up'] }), bx([14, 2, 0], [16, 16, 16], s, { cull: ['east', 'up'] }),
    bx([2, 2, 0], [14, 16, 2], s, { cull: ['north', 'up'] }), bx([2, 2, 14], [14, 16, 16], s, { cull: ['south', 'up'] }),
  ];
  const v: Record<string, ModelRef> = {};
  for (let level = 0; level <= 8; level++) {
    const els = [...walls];
    if (level > 0) {
      const h = level === 8 ? 15 : Math.min(15, 1 + level * 2);
      els.push({ from: [2, h, 2], to: [14, h, 14], faces: { up: { texture: level >= 7 ? 'compost_ready' : 'compost', uv: [2, 2, 14, 14] } } });
    }
    v[`level=${level}`] = { model: reg(`composter_contents${level}`, { elements: els }) };
  }
  return { variants: v };
}
function lecternDef(): BlockStateDef {
  const id = reg('lectern', {
    elements: [
      bx([0, 0, 0], [16, 2, 16], { up: 'lectern_side', down: 'oak_planks', north: 'lectern_side', south: 'lectern_side', west: 'lectern_side', east: 'lectern_side' }, { cull: ['down'] }),
      bx([4, 2, 4], [12, 13, 12], 'lectern_side'),
      { from: [0, 12, 3], to: [16, 16, 16], rotation: { origin: [8, 14, 8], axis: 'x', angle: -22.5 }, faces: { up: { texture: 'lectern_top' }, down: { texture: 'oak_planks' }, north: { texture: 'lectern_side', uv: [0, 0, 16, 4] }, south: { texture: 'lectern_side', uv: [0, 0, 16, 4] }, west: { texture: 'lectern_side', uv: [3, 0, 16, 4] }, east: { texture: 'lectern_side', uv: [0, 0, 13, 4] } } },
    ],
  });
  return { variants: rotated(id, Y_SOUTH) };
}
function stonecutterDef(): BlockStateDef {
  const id = reg('stonecutter', {
    elements: [
      bx([0, 0, 0], [16, 9, 16], { up: 'stonecutter_top', down: 'stonecutter_side', north: 'stonecutter_side', south: 'stonecutter_side', west: 'stonecutter_side', east: 'stonecutter_side' }, { cull: ['down', 'north', 'south', 'west', 'east'], uv: { north: [0, 7, 16, 16], south: [0, 7, 16, 16], west: [0, 7, 16, 16], east: [0, 7, 16, 16] } }),
      plane([1, 9, 8], [15, 16, 8], 'stonecutter_saw', 'north', 'south', [1, 9, 15, 16]),
    ],
  });
  return { variants: rotated(id, { north: 90, east: 180, south: 270, west: 0 }) };
}
function grindstoneDef(): BlockStateDef {
  const id = reg('grindstone', {
    elements: [
      bx([4, 4, 2], [12, 16, 14], { north: 'grindstone_round', south: 'grindstone_round', up: 'grindstone_round', down: 'grindstone_round', west: 'grindstone_side', east: 'grindstone_side' }),
      bx([2, 7, 6], [4, 13, 10], 'grindstone_pivot'), bx([12, 7, 6], [14, 13, 10], 'grindstone_pivot'),
      bx([2, 0, 6], [4, 7, 10], 'grindstone_leg', { cull: ['down'] }), bx([12, 0, 6], [14, 7, 10], 'grindstone_leg', { cull: ['down'] }),
    ],
  });
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) {
    v[`face=floor,facing=${f}`] = { model: id, y: Y_OF[f]! };
    v[`face=wall,facing=${f}`] = { model: id, x: 90, y: Y_OF[f]! };
    v[`face=ceiling,facing=${f}`] = { model: id, x: 180, y: ((Y_OF[f]! + 180) % 360) as Rot };
  }
  return { variants: v };
}
function bellDef(): BlockStateDef {
  const bellEls: ModelElement[] = [bx([5, 6, 5], [11, 13, 11], 'bell_body'), bx([4, 4, 4], [12, 6, 12], 'bell_body')];
  const floor = reg('bell_floor', { elements: [...bellEls, bx([2, 13, 7], [14, 15, 9], 'bell_bar'), bx([0, 0, 6], [2, 16, 10], 'bell_bar', { cull: ['down'] }), bx([14, 0, 6], [16, 16, 10], 'bell_bar', { cull: ['down'] })] });
  const ceiling = reg('bell_ceiling', { elements: [...bellEls.map((e) => ({ ...e, from: [e.from[0], e.from[1] + 1, e.from[2]] as V3, to: [e.to[0], e.to[1] + 1, e.to[2]] as V3 })), bx([7, 14, 7], [9, 16, 9], 'bell_bar', { cull: ['up'] })] });
  const wall = reg('bell_wall', { elements: [...bellEls, bx([7, 13, 0], [9, 15, 13], 'bell_bar', { cull: ['north'] })] });
  const between = reg('bell_between_walls', { elements: [...bellEls, bx([7, 13, 0], [9, 15, 16], 'bell_bar', { cull: ['north', 'south'] })] });
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) {
    v[`attachment=floor,facing=${f}`] = { model: floor, y: ((Y_OF[f]! + 90) % 360) as Rot };
    v[`attachment=ceiling,facing=${f}`] = { model: ceiling, y: Y_OF[f]! };
    v[`attachment=single_wall,facing=${f}`] = { model: wall, y: Y_OF[f]! };
    v[`attachment=double_wall,facing=${f}`] = { model: between, y: Y_OF[f]! };
  }
  return { variants: v };
}
function enderChestDef(): BlockStateDef {
  const m = { texture: 'ender_chest_front', uv: [7, 4, 9, 8] as UV };
  const id = reg('ender_chest', {
    elements: [
      bx([1, 0, 1], [15, 14, 15], { up: 'ender_chest_top', down: 'ender_chest_top', north: 'ender_chest_front', south: 'ender_chest_side', west: 'ender_chest_side', east: 'ender_chest_side' }, { cull: ['down'] }),
      { from: [7, 7, 0], to: [9, 11, 1], faces: { north: m, west: m, east: m, up: m, down: m } },
    ],
  });
  return { variants: rotated(id, Y_OF) };
}
function signDef(wood: string): Record<string, () => BlockStateDef> {
  const tex = `${wood}_sign`;
  const board = bx([0, 7, 7], [16, 15, 9], tex);
  const post = bx([7, 0, 7.5], [9, 7, 8.5], `${wood === 'crimson' || wood === 'warped' ? `${wood}_stem` : `${wood}_log`}`);
  const standing = reg(`${wood}_sign`, { elements: [board, post] });
  const wall = reg(`${wood}_wall_sign`, { elements: [bx([0, 4.5, 14], [16, 12.5, 16], tex)] });
  return {
    [`${wood}_sign`]: () => {
      const v: Record<string, ModelRef> = {};
      // rotation 0..15 in 22.5° steps; models only rotate by 90°, so snap to the nearest quarter
      for (let r = 0; r < 16; r++) v[`rotation=${r}`] = { model: standing, y: ((Math.round(r / 4) % 4) * 90) as Rot };
      return { variants: v };
    },
    [`${wood}_wall_sign`]: () => ({ variants: rotated(wall, Y_OF) }),
  };
}
function bannerDef(color: string): Record<string, () => BlockStateDef> {
  const tex = `${color}_banner`;
  const pole = bx([7, 0, 7], [9, 28, 9], 'oak_planks', { cull: ['down'] });
  const cloth = bx([0, 2, 9], [16, 32, 10], tex);
  const bar = bx([0, 28, 7], [16, 30, 9], 'oak_planks');
  const standing = reg(`${color}_banner`, { elements: [pole, bar, cloth] });
  const wall = reg(`${color}_wall_banner`, { elements: [bx([0, 12, 14], [16, 14, 16], 'oak_planks'), bx([0, -14, 13], [16, 14, 14], tex)] });
  return {
    [`${color}_banner`]: () => {
      const v: Record<string, ModelRef> = {};
      for (let r = 0; r < 16; r++) v[`rotation=${r}`] = { model: standing, y: ((Math.round(r / 4) % 4) * 90) as Rot };
      return { variants: v };
    },
    [`${color}_wall_banner`]: () => ({ variants: rotated(wall, Y_OF) }),
  };
}
function skullDef(kind: string): Record<string, () => BlockStateDef> {
  const tex = `${kind}_skull`;
  const isDragon = kind === 'dragon';
  const s = isDragon ? 12 : 8;
  const head = bx([8 - s / 2, 0, 8 - s / 2], [8 + s / 2, s, 8 + s / 2], tex, { uv: { north: [4, 4, 12, 12], south: [4, 4, 12, 12], west: [4, 4, 12, 12], east: [4, 4, 12, 12], up: [4, 4, 12, 12], down: [4, 4, 12, 12] } });
  const standing = reg(tex, { elements: [head] });
  const wall = reg(`${tex}_wall`, { elements: [{ ...head, from: [8 - s / 2, 4, 16 - s] as V3, to: [8 + s / 2, 4 + s, 16] as V3 }] });
  const names = kind === 'skeleton' || kind === 'wither_skeleton' ? [`${kind}_skull`, `${kind}_wall_skull`] : [`${kind}_head`, `${kind}_wall_head`];
  return {
    [names[0]!]: () => {
      const v: Record<string, ModelRef> = {};
      for (let r = 0; r < 16; r++) v[`rotation=${r}`] = { model: standing, y: (((Math.round(r / 4) + 2) % 4) * 90) as Rot };
      return { variants: v };
    },
    [names[1]!]: () => ({ variants: rotated(wall, Y_OF) }),
  };
}
function endPortalFrameDef(): BlockStateDef {
  const frame = bx([0, 0, 0], [16, 13, 16], { up: 'end_portal_frame_top', down: 'end_stone', north: 'end_portal_frame_side', south: 'end_portal_frame_side', west: 'end_portal_frame_side', east: 'end_portal_frame_side' },
    { cull: ['down', 'north', 'south', 'west', 'east'], uv: { north: [0, 3, 16, 16], south: [0, 3, 16, 16], west: [0, 3, 16, 16], east: [0, 3, 16, 16] } });
  const eye = bx([4, 13, 4], [12, 16, 12], 'end_portal_frame_eye', { uv: { up: [4, 4, 12, 12], north: [4, 4, 12, 7], south: [4, 4, 12, 7], west: [4, 4, 12, 7], east: [4, 4, 12, 7] }, skip: ['down'] });
  const empty = reg('end_portal_frame', { elements: [frame] });
  const filled = reg('end_portal_frame_filled', { elements: [frame, eye] });
  return { variants: { ...rotated(filled, Y_SOUTH, ',eye=true'), ...rotated(empty, Y_SOUTH, ',eye=false') } };
}
function respawnAnchorDef(): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (let c = 0; c <= 4; c++) {
    const side = `respawn_anchor_side${c}`, top = c > 0 ? 'respawn_anchor_top' : 'respawn_anchor_top_off';
    v[`charges=${c}`] = { model: reg(`respawn_anchor_${c}`, { parent: 'cube_bottom_top', textures: { side, top, bottom: 'respawn_anchor_bottom' } }) };
  }
  return { variants: v };
}
function beaconDef(): BlockStateDef {
  return single({
    model: reg('beacon', {
      elements: [
        bx([0, 0, 0], [16, 16, 16], 'glass', { cull: ['down', 'up', 'north', 'south', 'west', 'east'] }),
        bx([2, 0.1, 2], [14, 3, 14], 'obsidian'),
        bx([3, 3, 3], [13, 14, 13], 'beacon'),
      ],
    }),
  });
}
function chorusPlantDef(): BlockStateDef {
  const core = reg('chorus_plant_core', { elements: [bx([4, 4, 4], [12, 12, 12], 'chorus_plant')] });
  const arm = reg('chorus_plant_arm', { elements: [bx([4, 4, 0], [12, 12, 4], 'chorus_plant', { cull: ['north'] })] });
  const parts: NonNullable<BlockStateDef['multipart']> = [{ apply: { model: core } }];
  for (const d of HORIZONTAL) parts.push({ when: { [d]: 'true' }, apply: { model: arm, y: Y_OF[d]! } });
  parts.push({ when: { up: 'true' }, apply: { model: arm, x: 270 } });
  parts.push({ when: { down: 'true' }, apply: { model: arm, x: 90 } });
  return { multipart: parts };
}
function chorusFlowerDef(): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  const alive = reg('chorus_flower', { parent: 'cube_all', textures: { all: 'chorus_flower' } });
  const dead = reg('chorus_flower_dead', { parent: 'cube_all', textures: { all: 'chorus_flower_dead' } });
  for (let a = 0; a <= 5; a++) v[`age=${a}`] = { model: a === 5 ? dead : alive };
  return { variants: v };
}
function dragonEggDef(): BlockStateDef {
  const layers: [number, number, number][] = [[6, 15, 16], [5, 14, 15], [4, 13, 14], [3, 11, 13], [2, 8, 11], [1, 3, 8], [2, 1, 3], [3, 0, 1]];
  return single({ model: reg('dragon_egg', { elements: layers.map(([inset, y0, y1]) => bx([inset, y0, inset], [16 - inset, y1, 16 - inset], 'dragon_egg')) }) });
}
function turtleEggDef(): BlockStateDef {
  const spots: [number, number, number, number][] = [[5, 4, 4, 7], [1, 7, 3, 5], [9, 9, 3, 5], [10, 2, 3, 4]];
  const v: Record<string, ModelRef> = {};
  for (let eggs = 1; eggs <= 4; eggs++)
    for (let hatch = 0; hatch <= 2; hatch++) {
      const tex = hatch === 0 ? 'turtle_egg' : hatch === 1 ? 'turtle_egg_slightly_cracked' : 'turtle_egg_very_cracked';
      const els = spots.slice(0, eggs).map(([x, z, w, h]) => bx([x, 0, z], [x + w, h, z + w], tex, { cull: ['down'] }));
      v[`eggs=${eggs},hatch=${hatch}`] = { model: reg(`turtle_egg_${eggs}_${hatch}`, { elements: els }) };
    }
  return { variants: v };
}
function sculkSensorDef(): BlockStateDef {
  const els: ModelElement[] = [
    bx([0, 0, 0], [16, 8, 16], { up: 'sculk_sensor_top', down: 'sculk_sensor_bottom', north: 'sculk_sensor_side', south: 'sculk_sensor_side', west: 'sculk_sensor_side', east: 'sculk_sensor_side' },
      { cull: ['down', 'north', 'south', 'west', 'east'], uv: { north: [0, 8, 16, 16], south: [0, 8, 16, 16], west: [0, 8, 16, 16], east: [0, 8, 16, 16] } }),
    ...crossEls('sculk_sensor_tendril', 8, 16, [0, 8, 16, 16]),
  ];
  return single({ model: reg('sculk_sensor', { elements: els }) });
}
function lightningRodDef(): BlockStateDef {
  const id = reg('lightning_rod', {
    ao: false,
    elements: [
      bx([7, 0, 7], [9, 12, 9], 'lightning_rod', { uv: { north: [0, 4, 2, 16], south: [0, 4, 2, 16], west: [0, 4, 2, 16], east: [0, 4, 2, 16], down: [0, 0, 2, 2] }, skip: ['up'] }),
      bx([6, 12, 6], [10, 16, 10], 'lightning_rod', { uv: { north: [2, 0, 6, 4], south: [2, 0, 6, 4], west: [2, 0, 6, 4], east: [2, 0, 6, 4], up: [2, 0, 6, 4], down: [2, 0, 6, 4] } }),
    ],
  });
  return { variants: { 'facing=up': { model: id }, 'facing=down': { model: id, x: 180 }, 'facing=north': { model: id, x: 90 }, 'facing=south': { model: id, x: 90, y: 180 }, 'facing=east': { model: id, x: 90, y: 90 }, 'facing=west': { model: id, x: 90, y: 270 } } };
}
function tripwireHookDef(): BlockStateDef {
  const id = reg('tripwire_hook', {
    ao: false,
    elements: [
      bx([6.2, 1, 14], [9.8, 9, 16], 'tripwire_hook', { uv: { north: [0, 0, 4, 8], south: [0, 0, 4, 8], west: [0, 0, 2, 8], east: [0, 0, 2, 8], up: [0, 0, 4, 2], down: [0, 0, 4, 2] } }),
      plane([7.5, 6, 9], [8.5, 6, 14], 'tripwire_hook', 'west', 'east', [6, 0, 7, 5]),
    ],
  });
  return { variants: rotated(id, Y_OF) };
}
function tripwireDef(): BlockStateDef {
  const seg = reg('tripwire_ns', { ao: false, elements: [{ from: [7.5, 1.5, 0], to: [8.5, 1.5, 16], shade: false, faces: { up: { texture: 'tripwire', uv: [0, 7, 16, 8], rotation: 90 }, down: { texture: 'tripwire', uv: [0, 7, 16, 8], rotation: 90 } } }] });
  return { multipart: [{ apply: { model: seg } }, { when: { east: 'true' }, apply: { model: seg, y: 90 } }, { when: { west: 'true' }, apply: { model: seg, y: 90 } }] };
}
function daylightDef(): BlockStateDef {
  const mk = (name: string, top: string) => reg(name, {
    elements: [bx([0, 0, 0], [16, 6, 16], { up: top, down: 'oak_planks', north: 'oak_planks', south: 'oak_planks', west: 'oak_planks', east: 'oak_planks' }, { cull: ['down', 'north', 'south', 'west', 'east'], uv: { north: [0, 10, 16, 16], south: [0, 10, 16, 16], west: [0, 10, 16, 16], east: [0, 10, 16, 16] } })],
  });
  return { variants: { 'inverted=true': { model: mk('daylight_detector_inverted', 'daylight_detector_inverted_top') }, 'inverted=false': { model: mk('daylight_detector', 'daylight_detector_top') } } };
}
function commandBlockDef(kind: string): BlockStateDef {
  const id = reg(`${kind}_command_block`, { parent: 'cube', textures: { north: `${kind}_command_block_front`, south: `${kind}_command_block_back`, west: `${kind}_command_block_side`, east: `${kind}_command_block_side`, up: `${kind}_command_block_side`, down: `${kind}_command_block_side` } });
  return { variants: sixWay(id) };
}
const EMPTY: BlockStateDef = { variants: {} };

export const TECH: Record<string, () => BlockStateDef> = {
  redstone_wire: redstoneWireDef,
  powered_rail: () => specialRailDef('powered_rail'),
  detector_rail: () => specialRailDef('detector_rail'),
  activator_rail: () => specialRailDef('activator_rail'),
  repeater: repeaterDef,
  comparator: comparatorDef,
  piston: () => pistonDef(false),
  sticky_piston: () => pistonDef(true),
  piston_head: pistonHeadDef,
  moving_piston: () => EMPTY,
  hopper: hopperDef,
  cauldron: () => cauldronDef('empty'),
  water_cauldron: () => cauldronDef('water'),
  lava_cauldron: () => cauldronDef('lava'),
  powder_snow_cauldron: () => cauldronDef('powder_snow'),
  enchanting_table: () => single({ model: reg('enchanting_table', { elements: [bx([0, 0, 0], [16, 12, 16], { up: 'enchanting_table_top', down: 'enchanting_table_bottom', north: 'enchanting_table_side', south: 'enchanting_table_side', west: 'enchanting_table_side', east: 'enchanting_table_side' }, { cull: ['down', 'north', 'south', 'west', 'east'], uv: { north: [0, 4, 16, 16], south: [0, 4, 16, 16], west: [0, 4, 16, 16], east: [0, 4, 16, 16] } })] }) }),
  anvil: () => anvilDef('anvil'),
  chipped_anvil: () => anvilDef('chipped_anvil'),
  damaged_anvil: () => anvilDef('damaged_anvil'),
  brewing_stand: brewingStandDef,
  cake: cakeDef,
  candle_cake: () => candleCakeDef('candle', 'candle_cake'),
  campfire: () => campfireDef('campfire', 'campfire_fire'),
  soul_campfire: () => campfireDef('soul_campfire', 'soul_campfire_fire'),
  barrel: barrelDef,
  smoker: () => furnaceLike('smoker'),
  blast_furnace: () => furnaceLike('blast_furnace'),
  cartography_table: () => tableDef('cartography_table'),
  fletching_table: () => tableDef('fletching_table'),
  smithing_table: () => tableDef('smithing_table'),
  loom: loomDef,
  composter: composterDef,
  lectern: lecternDef,
  stonecutter: stonecutterDef,
  grindstone: grindstoneDef,
  bell: bellDef,
  ender_chest: enderChestDef,
  end_portal_frame: endPortalFrameDef,
  end_portal: () => single({ model: reg('end_portal', { elements: [{ from: [0, 12, 0], to: [16, 12, 16], shade: false, faces: { up: { texture: 'end_portal' }, down: { texture: 'end_portal' } } }] }) }),
  end_gateway: () => single({ model: reg('end_gateway', { parent: 'cube_all', textures: { all: 'end_portal' } }) }),
  respawn_anchor: respawnAnchorDef,
  beacon: beaconDef,
  conduit: () => single({ model: reg('conduit', { elements: [bx([5, 5, 5], [11, 11, 11], 'conduit')] }) }),
  chorus_plant: chorusPlantDef,
  chorus_flower: chorusFlowerDef,
  dragon_egg: dragonEggDef,
  turtle_egg: turtleEggDef,
  sculk_sensor: sculkSensorDef,
  lightning_rod: lightningRodDef,
  tripwire_hook: tripwireHookDef,
  tripwire: tripwireDef,
  daylight_detector: daylightDef,
  command_block: () => commandBlockDef('command'),
  repeating_command_block: () => commandBlockDef('repeating'),
  chain_command_block: () => commandBlockDef('chain'),
  structure_block: () => single({ model: reg('structure_block', { parent: 'cube_all', textures: { all: 'structure_block' } }) }),
  jigsaw: () => ({ variants: { '': { model: reg('jigsaw', { parent: 'cube_all', textures: { all: 'jigsaw' } }) } } }),
  // invisible technical blocks (vanilla renders nothing unless the matching item is held)
  barrier: () => EMPTY,
  light: () => EMPTY,
  structure_void: () => EMPTY,
};
for (const c of COLORS) {
  TECH[`${c}_candle`] = () => candleDef(c);
  TECH[`${c}_candle_cake`] = () => candleCakeDef(`${c}_candle`, `${c}_candle_cake`);
  Object.assign(TECH, bannerDef(c));
}
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped']) Object.assign(TECH, signDef(w));
for (const k of ['skeleton', 'wither_skeleton', 'zombie', 'creeper', 'player', 'dragon']) Object.assign(TECH, skullDef(k));
