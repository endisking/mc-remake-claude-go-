/**
 * Blockstate definitions for Nether blocks whose model isn't a plain cube_all of the block's name:
 * nyliums (nylium top, netherrack bottom), basalt columns, the nether portal pane, fire, plants
 * and vines (cross models), and magma block (its texture is "magma").
 */
import type { BlockStateDef } from './format';
import { MODELS } from './library';

function reg(name: string, parent: string, textures: Record<string, string>): string {
  const id = `block/${name}`;
  MODELS[id] = { parent, textures };
  return id;
}

const PORTAL_X = 'block/nether_portal_ns';
const PORTAL_Z = 'block/nether_portal_ew';
MODELS[PORTAL_X] = {
  ao: false,
  textures: { portal: 'nether_portal' },
  elements: [{ from: [0, 0, 6], to: [16, 16, 10], shade: false, faces: { north: { texture: '#portal', uv: [0, 0, 16, 16] }, south: { texture: '#portal', uv: [0, 0, 16, 16] } } }],
};
MODELS[PORTAL_Z] = {
  ao: false,
  textures: { portal: 'nether_portal' },
  elements: [{ from: [6, 0, 0], to: [10, 16, 16], shade: false, faces: { west: { texture: '#portal', uv: [0, 0, 16, 16] }, east: { texture: '#portal', uv: [0, 0, 16, 16] } } }],
};

const CROSS_PLANTS = new Set([
  'crimson_roots', 'warped_roots', 'nether_sprouts', 'crimson_fungus', 'warped_fungus',
  'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant',
]);

export function netherBlockDef(name: string, hasTexture: (t: string) => boolean): BlockStateDef | null {
  switch (name) {
    case 'crimson_nylium':
    case 'warped_nylium':
      if (!hasTexture(name)) return null;
      return { variants: { '': { model: reg(name, 'cube_bottom_top', { top: name, bottom: 'netherrack', side: `${name}_side` }) } } };
    case 'basalt':
    case 'polished_basalt': {
      if (!hasTexture('basalt_side')) return null;
      const id = reg(name, 'cube_column', { side: 'basalt_side', end: 'basalt_top' });
      return { variants: { 'axis=y': { model: id }, 'axis=z': { model: id, x: 90 }, 'axis=x': { model: id, x: 90, y: 90 } } };
    }
    case 'nether_portal':
      return { variants: { 'axis=x': { model: PORTAL_X }, 'axis=z': { model: PORTAL_Z } } };
    case 'magma_block':
      return hasTexture('magma') ? { variants: { '': { model: reg(name, 'cube_all', { all: 'magma' }) } } } : null;
    case 'fire':
      return hasTexture('fire_0') ? { variants: { '': { model: reg(name, 'cross', { cross: 'fire_0' }) } } } : null;
    case 'soul_fire':
      return hasTexture('soul_fire_0') ? { variants: { '': { model: reg(name, 'cross', { cross: 'soul_fire_0' }) } } } : null;
    case 'gilded_blackstone':
    case 'polished_blackstone':
      return hasTexture('blackstone') ? { variants: { '': { model: reg(name, 'cube_all', { all: 'blackstone' }) } } } : null;
  }
  if (CROSS_PLANTS.has(name) && hasTexture(name)) return { variants: { '': { model: reg(name, 'cross', { cross: name }) } } };
  return null;
}
