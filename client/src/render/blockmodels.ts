/** Shared setup of baked block models from the texture manifest (main thread + workers). */
import { bakeAll, type BakeResult, type TextureInfo } from '../models/bake';
import { blockStateDef } from '../models/blockstates';
import type { FluidTextures } from './mesher';

export interface TextureManifestEntry {
  name: string;
  frames: number;
  frametime?: number;
  interpolate?: boolean;
  tint?: string;
  cutout?: boolean;
  translucent?: boolean;
}

export interface TextureManifest {
  textures: TextureManifestEntry[];
}

export function textureInfoMap(m: TextureManifest): Map<string, TextureInfo> {
  const map = new Map<string, TextureInfo>();
  m.textures.forEach((t, i) => {
    map.set(t.name, { layer: i, cutout: !!t.cutout, translucent: !!t.translucent, leaves: t.name.endsWith('_leaves') });
  });
  return map;
}

export function bakeBlockModels(m: TextureManifest, fancy: boolean): { bake: BakeResult; fluids: FluidTextures; textures: Map<string, TextureInfo> } {
  const textures = textureInfoMap(m);
  const bake = bakeAll((name) => blockStateDef(name, (t) => textures.has(t)), textures, { fancy });
  const layer = (n: string) => textures.get(n)?.layer ?? textures.get('missing')!.layer;
  return {
    bake,
    textures,
    fluids: { waterStill: layer('water_still'), waterFlow: layer('water_flow'), lavaStill: layer('lava_still'), lavaFlow: layer('lava_flow') },
  };
}
