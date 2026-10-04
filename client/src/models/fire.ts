/**
 * Fire and soul fire block models (our own geometry): on the ground a crossed pair of flame
 * sheets plus four sheets leaning in from the edges; attached to a burnable side or ceiling, a sheet
 * hugging that face. Multipart like vanilla: no attachments = ground fire.
 */
import type { BlockStateDef, BlockModel, FaceName } from './format';
import { MODELS } from './library';

const sheet = (face: FaceName, tex: string) => ({ [face]: { texture: tex, uv: [0, 0, 16, 16] as [number, number, number, number] } });

function register(name: string, tex: string): { floor: string; side: string; up: string } {
  const t = `#fire`;
  const floor: BlockModel = {
    ao: false,
    textures: { fire: tex },
    elements: [
      { from: [0.8, 0, 8], to: [15.2, 17, 8], shade: false, rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, faces: { ...sheet('north', t), ...sheet('south', t) } },
      { from: [8, 0, 0.8], to: [8, 17, 15.2], shade: false, rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, faces: { ...sheet('west', t), ...sheet('east', t) } },
      { from: [0, 0, 2.5], to: [16, 18, 2.5], shade: false, rotation: { origin: [8, 0, 2.5], axis: 'x', angle: 22.5 }, faces: { ...sheet('north', t), ...sheet('south', t) } },
      { from: [0, 0, 13.5], to: [16, 18, 13.5], shade: false, rotation: { origin: [8, 0, 13.5], axis: 'x', angle: -22.5 }, faces: { ...sheet('north', t), ...sheet('south', t) } },
      { from: [2.5, 0, 0], to: [2.5, 18, 16], shade: false, rotation: { origin: [2.5, 0, 8], axis: 'z', angle: -22.5 }, faces: { ...sheet('west', t), ...sheet('east', t) } },
      { from: [13.5, 0, 0], to: [13.5, 18, 16], shade: false, rotation: { origin: [13.5, 0, 8], axis: 'z', angle: 22.5 }, faces: { ...sheet('west', t), ...sheet('east', t) } },
    ],
  };
  // a sheet just in front of the north face (rotated for the other sides)
  const side: BlockModel = {
    ao: false,
    textures: { fire: tex },
    elements: [{ from: [0, 0, 0.02], to: [16, 20, 0.02], shade: false, faces: { ...sheet('north', t), ...sheet('south', t) } }],
  };
  const up: BlockModel = {
    ao: false,
    textures: { fire: tex },
    elements: [{ from: [0, 15.98, 0], to: [16, 15.98, 16], shade: false, faces: { ...sheet('down', t), ...sheet('up', t) } }],
  };
  MODELS[`block/${name}_floor`] = floor;
  MODELS[`block/${name}_side`] = side;
  MODELS[`block/${name}_up`] = up;
  return { floor: `block/${name}_floor`, side: `block/${name}_side`, up: `block/${name}_up` };
}

export function fireDef(name: 'fire' | 'soul_fire'): BlockStateDef {
  const m = register(name, `${name}_0`);
  if (name === 'soul_fire') return { multipart: [{ apply: { model: m.floor } }] };
  const none = { north: 'false', east: 'false', south: 'false', west: 'false', up: 'false' };
  const rot = { north: 0, east: 90, south: 180, west: 270 } as const;
  return {
    multipart: [
      { when: none, apply: { model: m.floor } },
      ...(['north', 'east', 'south', 'west'] as const).map((d) => ({ when: { [d]: 'true' } as Record<string, string>, apply: { model: m.side, y: rot[d] } })),
      { when: { up: 'true' }, apply: { model: m.up } },
    ],
  };
}
