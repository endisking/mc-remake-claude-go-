/**
 * Blockstate definitions for crafted and utility blocks: carpets, shulker boxes, glazed
 * terracotta, quartz and purpur pillars, crafting table, furnaces, dispensers, observers,
 * bookshelves, lamps, beehives, crops and stems, fence gates, torches, lanterns, chains,
 * end rods, flower pots. Geometry follows the vanilla block shapes (game facts).
 */
import type { BlockModel, BlockStateDef, ModelElement, ModelRef } from './format';
import { MODELS, box } from './library';

type Rot = 0 | 90 | 180 | 270;
type V3 = [number, number, number];
type UV = [number, number, number, number];
const Y_OF: Record<string, Rot> = { north: 0, east: 90, south: 180, west: 270 };
const HORIZONTAL = ['north', 'east', 'south', 'west'] as const;
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

function reg(name: string, m: BlockModel): string {
  MODELS[`block/${name}`] = m;
  return `block/${name}`;
}
const model = (name: string, parent: string, textures: Record<string, string>) => reg(name, { parent, textures });
const single = (ref: ModelRef, offset?: 'xz' | 'xyz'): BlockStateDef => ({ variants: { '': ref }, ...(offset ? { offset } : {}) });
function column(name: string, side: string, end: string): BlockStateDef {
  const id = model(name, 'cube_column', { side, end });
  return { variants: { 'axis=y': { model: id }, 'axis=z': { model: id, x: 90 }, 'axis=x': { model: id, x: 90, y: 90 }, '': { model: id } } };
}
function faces6(name: string, t: { north: string; south: string; east: string; west: string; up: string; down: string }): string {
  return reg(name, { parent: 'cube', textures: t });
}
/** Horizontal facing (front on north in the base model). */
function horizontal(id: string, extra = ''): Record<string, ModelRef> {
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) v[`facing=${f}${extra}`] = { model: id, y: Y_OF[f]! };
  return v;
}
/** Six-way facing (front on north in the base model). */
function sixWay(id: string, extra = ''): Record<string, ModelRef> {
  return { ...horizontal(id, extra), [`facing=up${extra}`]: { model: id, x: 270 }, [`facing=down${extra}`]: { model: id, x: 90 } };
}
function plane(from: V3, to: V3, tex: string, a: 'north' | 'west', b: 'south' | 'east', uv: UV, rotation?: ModelElement['rotation'], tint?: boolean): ModelElement {
  const f = { texture: tex, uv, ...(tint ? { tint: 0 } : {}) };
  return { from, to, shade: false, ...(rotation ? { rotation } : {}), faces: { [a]: { ...f }, [b]: { ...f } } };
}
function crossEls(tex: string, y0: number, y1: number, uv: UV, tint = false, inset = 0.8): ModelElement[] {
  const rot = { origin: [8, 8, 8] as V3, axis: 'y' as const, angle: 45, rescale: true };
  return [plane([inset, y0, 8], [16 - inset, y1, 8], tex, 'north', 'south', uv, rot, tint), plane([8, y0, inset], [8, y1, 16 - inset], tex, 'west', 'east', uv, rot, tint)];
}

// ------------------------------------------------------------------ defs
function furnaceLike(name: string, front: string, frontOn: string, side: string, top: string): BlockStateDef {
  const off = faces6(name, { north: front, south: side, east: side, west: side, up: top, down: top });
  const on = faces6(`${name}_on`, { north: frontOn, south: side, east: side, west: side, up: top, down: top });
  return { variants: { ...horizontal(on, ',lit=true'), ...horizontal(off, ',lit=false') } };
}
function dispenserLike(name: string, front: string): BlockStateDef {
  const id = faces6(name, { north: front, south: 'furnace_side', east: 'furnace_side', west: 'furnace_side', up: 'furnace_top', down: 'furnace_top' });
  return { variants: sixWay(id) };
}
function beehiveLike(name: string, t: { front: string; honey: string; side: string; top: string; bottom: string }): BlockStateDef {
  const plain = faces6(name, { north: t.front, south: t.side, east: t.side, west: t.side, up: t.top, down: t.bottom });
  const honey = faces6(`${name}_honey`, { north: t.honey, south: t.side, east: t.side, west: t.side, up: t.top, down: t.bottom });
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) {
    v[`facing=${f},honey_level=5`] = { model: honey, y: Y_OF[f]! };
    v[`facing=${f}`] = { model: plain, y: Y_OF[f]! };
  }
  return { variants: v };
}
function cropDef(name: string, tex: string, stageOfAge: number[]): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  stageOfAge.forEach((s, age) => (v[`age=${age}`] = { model: model(`${tex}_stage${s}`, 'crop', { crop: `${tex}_stage${s}` }) }));
  return { variants: v };
}
function stemDef(name: string): BlockStateDef {
  const v: Record<string, ModelRef> = {};
  for (let age = 0; age < 8; age++) {
    const h = (age + 1) * 2;
    v[`age=${age}`] = { model: reg(`${name}_growth${age}`, { ao: false, elements: crossEls('stem', -1, h - 1, [0, 16 - h, 16, 16], true) }) };
  }
  return { variants: v };
}
function attachedStemDef(name: string): BlockStateDef {
  // the bent stem points toward the fruit (FACING); base model points west (texture left → right = stem → fruit)
  const id = reg(name, { ao: false, elements: [plane([0, 0, 8], [16, 16, 8], 'attached_stem', 'north', 'south', [16, 0, 0, 16], undefined, true)] });
  const y: Record<string, Rot> = { west: 0, north: 90, east: 180, south: 270 };
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL) v[`facing=${f}`] = { model: id, y: y[f]! };
  return { variants: v };
}
function fenceGateDef(name: string, tex: string): BlockStateDef {
  const t = (from: V3, to: V3) => box(from, to, { down: 'texture', up: 'texture', north: 'texture', south: 'texture', west: 'texture', east: 'texture' }, []);
  const posts = (dy: number) => [t([0, 5 - dy, 7], [2, 16 - dy, 9]), t([14, 5 - dy, 7], [16, 16 - dy, 9])];
  const closed = (dy: number): ModelElement[] => [
    ...posts(dy),
    t([6, 6 - dy, 7], [8, 15 - dy, 9]), t([8, 6 - dy, 7], [10, 15 - dy, 9]),
    t([2, 6 - dy, 7], [6, 9 - dy, 9]), t([2, 12 - dy, 7], [6, 15 - dy, 9]),
    t([10, 6 - dy, 7], [14, 9 - dy, 9]), t([10, 12 - dy, 7], [14, 15 - dy, 9]),
  ];
  const open = (dy: number): ModelElement[] => [
    ...posts(dy),
    t([0, 6 - dy, 13], [2, 15 - dy, 15]), t([14, 6 - dy, 13], [16, 15 - dy, 15]),
    t([0, 6 - dy, 9], [2, 9 - dy, 13]), t([0, 12 - dy, 9], [2, 15 - dy, 13]),
    t([14, 6 - dy, 9], [16, 9 - dy, 13]), t([14, 12 - dy, 9], [16, 15 - dy, 13]),
  ];
  const m = (suffix: string, els: ModelElement[]) => reg(`${name}${suffix}`, { textures: { texture: tex }, elements: els });
  const ids = { closed: m('', closed(0)), open: m('_open', open(0)), wall: m('_wall', closed(3)), wallOpen: m('_wall_open', open(3)) };
  // base model spans X with leaves swinging toward +Z (south); FACING south = y 0
  const y: Record<string, Rot> = { south: 0, west: 90, north: 180, east: 270 };
  const v: Record<string, ModelRef> = {};
  for (const f of HORIZONTAL)
    for (const inWall of ['false', 'true'])
      for (const isOpen of ['false', 'true']) {
        const id = inWall === 'true' ? (isOpen === 'true' ? ids.wallOpen : ids.wall) : isOpen === 'true' ? ids.open : ids.closed;
        v[`facing=${f},in_wall=${inWall},open=${isOpen}`] = { model: id, y: y[f]!, uvlock: true };
      }
  return { variants: v };
}
function torchDefs(standing: string, wall: string, tex: string, lit?: string): Record<string, () => BlockStateDef> {
  const st = (t: string) => model(`${standing}${t === tex ? '' : '_off'}`, 'torch', { torch: t });
  const wl = (t: string) => model(`${wall}${t === tex ? '' : '_off'}`, 'wall_torch', { torch: t });
  const wallVariants = (id: string, extra: string) => ({ [`facing=east${extra}`]: { model: id }, [`facing=south${extra}`]: { model: id, y: 90 as Rot }, [`facing=west${extra}`]: { model: id, y: 180 as Rot }, [`facing=north${extra}`]: { model: id, y: 270 as Rot } });
  if (!lit) return { [standing]: () => single({ model: st(tex) }), [wall]: () => ({ variants: wallVariants(wl(tex), '') }) };
  return {
    [standing]: () => ({ variants: { 'lit=true': { model: st(tex) }, 'lit=false': { model: st(lit) } } }),
    [wall]: () => ({ variants: { ...wallVariants(wl(tex), ',lit=true'), ...wallVariants(wl(lit), ',lit=false') } }),
  };
}
function lanternDef(name: string): BlockStateDef {
  const mk = (suffix: string, dy: number) => {
    const side: UV = [0, 2, 6, 9], cap: UV = [1, 2, 5, 4], tb: UV = [0, 9, 6, 15];
    return reg(`${name}${suffix}`, {
      ao: false,
      elements: [
        { from: [5, dy, 5], to: [11, 7 + dy, 11], faces: { down: { texture: name, uv: tb, ...(dy === 0 ? { cull: 'down' as const } : {}) }, up: { texture: name, uv: tb }, north: { texture: name, uv: side }, south: { texture: name, uv: side }, west: { texture: name, uv: side }, east: { texture: name, uv: side } } },
        { from: [6, 7 + dy, 6], to: [10, 9 + dy, 10], faces: { up: { texture: name, uv: [1, 10, 5, 14] }, north: { texture: name, uv: cap }, south: { texture: name, uv: cap }, west: { texture: name, uv: cap }, east: { texture: name, uv: cap } } },
        ...crossEls(name, 9 + dy, dy ? 16 : 11, dy ? [11, 1, 14, 7] : [11, 1, 14, 3], false, 6.5),
      ],
    });
  };
  return { variants: { 'hanging=false': { model: mk('', 0) }, 'hanging=true': { model: mk('_hanging', 1) } } };
}
function chainDef(): BlockStateDef {
  const id = reg('chain', {
    ao: false,
    elements: [
      plane([6.5, 0, 8], [9.5, 16, 8], 'chain', 'north', 'south', [0, 0, 3, 16], { origin: [8, 8, 8], axis: 'y', angle: 45 }),
      plane([8, 0, 6.5], [8, 16, 9.5], 'chain', 'west', 'east', [3, 0, 6, 16], { origin: [8, 8, 8], axis: 'y', angle: 45 }),
    ],
  });
  return { variants: { 'axis=y': { model: id }, 'axis=z': { model: id, x: 90 }, 'axis=x': { model: id, x: 90, y: 90 } } };
}
function endRodDef(): BlockStateDef {
  const rod: UV = [0, 0, 2, 15], base: UV = [2, 0, 6, 3];
  const id = reg('end_rod', {
    ao: false,
    elements: [
      { from: [7, 1, 7], to: [9, 16, 9], shade: false, faces: { up: { texture: 'end_rod', uv: [0, 0, 2, 2] }, north: { texture: 'end_rod', uv: rod }, south: { texture: 'end_rod', uv: rod }, west: { texture: 'end_rod', uv: rod }, east: { texture: 'end_rod', uv: rod } } },
      { from: [6, 0, 6], to: [10, 1, 10], faces: { down: { texture: 'end_rod', uv: base }, up: { texture: 'end_rod', uv: base }, north: { texture: 'end_rod', uv: [2, 0, 6, 1] }, south: { texture: 'end_rod', uv: [2, 0, 6, 1] }, west: { texture: 'end_rod', uv: [2, 0, 6, 1] }, east: { texture: 'end_rod', uv: [2, 0, 6, 1] } } },
    ],
  });
  return { variants: { 'facing=up': { model: id }, 'facing=down': { model: id, x: 180 }, 'facing=north': { model: id, x: 90 }, 'facing=south': { model: id, x: 90, y: 180 }, 'facing=east': { model: id, x: 90, y: 90 }, 'facing=west': { model: id, x: 90, y: 270 } } };
}
const POT: ModelElement[] = [
  { from: [5, 0, 5], to: [11, 6, 11], faces: { down: { texture: 'flower_pot', uv: [5, 10, 11, 16], cull: 'down' }, north: { texture: 'flower_pot', uv: [5, 10, 11, 16] }, south: { texture: 'flower_pot', uv: [5, 10, 11, 16] }, west: { texture: 'flower_pot', uv: [5, 10, 11, 16] }, east: { texture: 'flower_pot', uv: [5, 10, 11, 16] } } },
  { from: [6, 5.9, 6], to: [10, 5.9, 10], faces: { up: { texture: 'flower_pot', uv: [0, 0, 4, 4] } } },
];
function pottedDef(name: string, plant: string | null, tint = false): BlockStateDef {
  const els = [...POT];
  if (plant) els.push(...crossEls(plant, 4, 16, [0, 0, 16, 12], tint, 2.6));
  return single({ model: reg(name, { ao: false, elements: els }) });
}

export const CRAFTED: Record<string, () => BlockStateDef> = {
  crafting_table: () => single({ model: faces6('crafting_table', { north: 'crafting_table_front', west: 'crafting_table_front', south: 'crafting_table_side', east: 'crafting_table_side', up: 'crafting_table_top', down: 'oak_planks' }) }),
  furnace: () => furnaceLike('furnace', 'furnace_front', 'furnace_front_on', 'furnace_side', 'furnace_top'),
  dispenser: () => dispenserLike('dispenser', 'dispenser_front'),
  dropper: () => dispenserLike('dropper', 'dropper_front'),
  observer: () => ({ variants: sixWay(faces6('observer', { north: 'observer_front', south: 'furnace_side', east: 'furnace_side', west: 'furnace_side', up: 'furnace_top', down: 'furnace_top' })) }),
  bookshelf: () => single({ model: model('bookshelf', 'cube_column', { side: 'bookshelf', end: 'oak_planks' }) }),
  jukebox: () => single({ model: model('jukebox', 'cube_bottom_top', { side: 'jukebox_side', top: 'jukebox_top', bottom: 'jukebox_side' }) }),
  redstone_lamp: () => ({ variants: { 'lit=true': { model: model('redstone_lamp_on', 'cube_all', { all: 'redstone_lamp_on' }) }, 'lit=false': { model: model('redstone_lamp', 'cube_all', { all: 'redstone_lamp' }) } } }),
  beehive: () => beehiveLike('beehive', { front: 'beehive_front', honey: 'beehive_front_honey', side: 'beehive_side', top: 'beehive_end', bottom: 'beehive_end' }),
  quartz_block: () => single({ model: model('quartz_block', 'cube_bottom_top', { side: 'quartz_block', top: 'quartz_block_top', bottom: 'quartz_block_top' }) }),
  quartz_pillar: () => column('quartz_pillar', 'quartz_pillar', 'quartz_pillar_top'),
  chiseled_quartz_block: () => column('chiseled_quartz_block', 'chiseled_quartz_block', 'chiseled_quartz_block_top'),
  purpur_pillar: () => column('purpur_pillar', 'purpur_pillar', 'purpur_pillar_top'),
  polished_basalt: () => column('polished_basalt', 'polished_basalt_side', 'polished_basalt_top'),
  bone_block: () => column('bone_block', 'bone_block_side', 'bone_block_top'),
  dried_kelp_block: () => single({ model: model('dried_kelp_block', 'cube_bottom_top', { side: 'dried_kelp_side', top: 'dried_kelp_top', bottom: 'dried_kelp_bottom' }) }),
  target: () => single({ model: model('target', 'cube_column', { side: 'target_side', end: 'target_top' }) }),
  lodestone: () => single({ model: model('lodestone', 'cube_column', { side: 'lodestone_side', end: 'lodestone_top' }) }),
  frosted_ice: () => single({ model: model('frosted_ice', 'cube_all', { all: 'ice' }) }),
  infested_chiseled_stone_bricks: () => single({ model: model('infested_chiseled_stone_bricks', 'cube_all', { all: 'chiseled_stone_bricks' }) }),
  petrified_oak_slab: () => {
    const tex = { top: 'oak_planks', bottom: 'oak_planks', side: 'oak_planks' };
    return { variants: { 'type=bottom': { model: model('petrified_oak_slab', 'slab', tex) }, 'type=top': { model: model('petrified_oak_slab_top', 'slab_top', tex) }, 'type=double': { model: model('petrified_oak_slab_double', 'cube_all', { all: 'oak_planks' }) } } };
  },
  carrots: () => cropDef('carrots', 'carrots', [0, 0, 1, 1, 2, 2, 2, 3]),
  potatoes: () => cropDef('potatoes', 'potatoes', [0, 0, 1, 1, 2, 2, 2, 3]),
  beetroots: () => cropDef('beetroots', 'beetroots', [0, 1, 2, 3]),
  nether_wart: () => cropDef('nether_wart', 'nether_wart', [0, 1, 1, 2]),
  pumpkin_stem: () => stemDef('pumpkin_stem'),
  melon_stem: () => stemDef('melon_stem'),
  attached_pumpkin_stem: () => attachedStemDef('attached_pumpkin_stem'),
  attached_melon_stem: () => attachedStemDef('attached_melon_stem'),
  lantern: () => lanternDef('lantern'),
  soul_lantern: () => lanternDef('soul_lantern'),
  chain: chainDef,
  end_rod: endRodDef,
  flower_pot: () => pottedDef('flower_pot', null),
  shulker_box: () => single({ model: model('shulker_box', 'cube_bottom_top', { side: 'shulker_box_side', top: 'shulker_box_top', bottom: 'shulker_box_top' }) }),
  ...torchDefs('soul_torch', 'soul_wall_torch', 'soul_torch'),
  ...torchDefs('redstone_torch', 'redstone_wall_torch', 'redstone_torch', 'redstone_torch_off'),
};

for (const c of COLORS) {
  CRAFTED[`${c}_carpet`] = () => single({ model: model(`${c}_carpet`, 'carpet', { wool: `${c}_wool` }) });
  CRAFTED[`${c}_shulker_box`] = () => single({ model: model(`${c}_shulker_box`, 'cube_bottom_top', { side: `${c}_shulker_box_side`, top: `${c}_shulker_box_top`, bottom: `${c}_shulker_box_top` }) });
  CRAFTED[`${c}_glazed_terracotta`] = () => {
    // pattern rotates with FACING like vanilla glazed terracotta
    const id = model(`${c}_glazed_terracotta`, 'cube_all', { all: `${c}_glazed_terracotta` });
    const y: Record<string, Rot> = { south: 0, west: 90, north: 180, east: 270 };
    const v: Record<string, ModelRef> = {};
    for (const f of HORIZONTAL) v[`facing=${f}`] = { model: id, y: y[f]! };
    return { variants: v };
  };
}
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped']) CRAFTED[`${w}_fence_gate`] = () => fenceGateDef(`${w}_fence_gate`, `${w}_planks`);
const POTTED: Record<string, [string, boolean?]> = {
  oak_sapling: ['oak_sapling'], spruce_sapling: ['spruce_sapling'], birch_sapling: ['birch_sapling'], jungle_sapling: ['jungle_sapling'], acacia_sapling: ['acacia_sapling'], dark_oak_sapling: ['dark_oak_sapling'],
  fern: ['fern', true], dandelion: ['dandelion'], poppy: ['poppy'], blue_orchid: ['blue_orchid'], allium: ['allium'], azure_bluet: ['azure_bluet'], red_tulip: ['red_tulip'],
  orange_tulip: ['orange_tulip'], white_tulip: ['white_tulip'], pink_tulip: ['pink_tulip'], oxeye_daisy: ['oxeye_daisy'], cornflower: ['cornflower'], lily_of_the_valley: ['lily_of_the_valley'],
  wither_rose: ['wither_rose'], red_mushroom: ['red_mushroom'], brown_mushroom: ['brown_mushroom'], dead_bush: ['dead_bush'], crimson_fungus: ['crimson_fungus'], warped_fungus: ['warped_fungus'],
  crimson_roots: ['crimson_roots'], warped_roots: ['warped_roots'], bamboo: ['bamboo_stage0'], cactus: ['cactus_side'], azalea_bush: ['azalea_plant'], flowering_azalea_bush: ['azalea_plant'],
};
for (const [n, [tex, tint]] of Object.entries(POTTED)) CRAFTED[`potted_${n}`] = () => pottedDef(`potted_${n}`, tex, !!tint);
