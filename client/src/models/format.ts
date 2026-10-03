/**
 * Blockcraft block model format (JSON).
 *
 * A *model* is a list of box elements with per-face textures and UVs; models can inherit
 * from a parent and reference textures through `#variables`. A *blockstate definition*
 * maps block states to one or more (rotated) models, either by matching variants or by
 * multipart conditions (fences, walls, redstone wire, ...).
 *
 * Coordinates are in pixels (0–16 is one block). UVs are in pixels of the 16×16 texture.
 */

export type FaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
export const FACE_NAMES: FaceName[] = ['down', 'up', 'north', 'south', 'west', 'east'];

export interface ModelFace {
  /** Texture name or `#variable`. */
  texture: string;
  /** [u1, v1, u2, v2]; defaults to the element's projection onto the face. */
  uv?: [number, number, number, number];
  /** Skip this face when the neighbour in this direction hides it. */
  cull?: FaceName;
  rotation?: 0 | 90 | 180 | 270;
  /** Tint source index: 0 = biome grass/foliage/water (per block), other indices block-specific. */
  tint?: number;
}

export interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  /** Directional shading (default true). */
  shade?: boolean;
  faces: Partial<Record<FaceName, ModelFace>>;
}

export interface BlockModel {
  parent?: string;
  textures?: Record<string, string>;
  /** Ambient occlusion (default true). */
  ao?: boolean;
  elements?: ModelElement[];
}

export interface ModelRef {
  model: string;
  /** Rotation around X then Y, in multiples of 90°. */
  x?: 0 | 90 | 180 | 270;
  y?: 0 | 90 | 180 | 270;
  /** Keep textures aligned to the world when rotated. */
  uvlock?: boolean;
  /** Relative weight when several models are listed (random per position). */
  weight?: number;
}

/** A condition: property → allowed values ("a|b"), or { OR: [...] } / { AND: [...] }. */
export type Condition = Record<string, string> | { OR: Condition[] } | { AND: Condition[] };

export interface BlockStateDef {
  /** Keys like "facing=north,half=top" (any subset of properties); "" matches everything. */
  variants?: Record<string, ModelRef | ModelRef[]>;
  multipart?: { when?: Condition; apply: ModelRef | ModelRef[] }[];
  /** Random XZ (and optionally Y) offset per position, like flowers and tall grass. */
  offset?: 'xz' | 'xyz';
}
