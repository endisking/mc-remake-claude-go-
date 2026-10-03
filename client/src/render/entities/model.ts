/**
 * Box-model system for entities. Units are pixels (16 = one block), +Y up, the model faces
 * +Z. Boxes use the standard box-unwrap texture layout: for a box of size w×h×d at texture
 * offset (u,v): top (u+d, v), bottom (u+d+w, v), then a strip at v+d of right side, front,
 * left side, back.
 */

export interface ModelBox {
  /** min corner relative to the part pivot (px) */
  from: [number, number, number];
  size: [number, number, number];
  uv: [number, number];
  inflate?: number;
  mirror?: boolean;
}

export interface PartDef {
  name: string;
  pivot: [number, number, number];
  boxes: ModelBox[];
  children?: PartDef[];
}

/** Runtime pose of a part (radians, px offsets). */
export class PartPose {
  x = 0;
  y = 0;
  z = 0;
  xRot = 0;
  yRot = 0;
  zRot = 0;
  visible = true;
  constructor(readonly def: PartDef) {
    this.reset();
  }
  reset(): void {
    [this.x, this.y, this.z] = this.def.pivot;
    this.xRot = this.yRot = this.zRot = 0;
    this.visible = true;
  }
}

/** Interleaved vertex: pos(3) uv(2) normal(3) = 8 floats. */
export const FLOATS_PER_VERTEX = 8;

/** Append the triangles of one box (pivot-relative) to `out`. Texture size tw×th. */
export function emitBox(out: number[], b: ModelBox, tw: number, th: number): void {
  const g = b.inflate ?? 0;
  let x0 = b.from[0] - g, y0 = b.from[1] - g, z0 = b.from[2] - g;
  let x1 = b.from[0] + b.size[0] + g, y1 = b.from[1] + b.size[1] + g, z1 = b.from[2] + b.size[2] + g;
  if (b.mirror) [x0, x1] = [x1, x0];
  const [w, h, d] = b.size;
  const [u, v] = b.uv;
  // faces: corners TL, BL, BR, TR seen from outside, texture rect (u0,v0)-(u1,v1), normal
  const faces: [number[][], [number, number, number, number], [number, number, number]][] = [
    // front (+Z)
    [[[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], [u + d, v + d, u + d + w, v + d + h], [0, 0, 1]],
    // back (−Z)
    [[[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h], [0, 0, -1]],
    // character's right side (−X)
    [[[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [u, v + d, u + d, v + d + h], [-1, 0, 0]],
    // character's left side (+X)
    [[[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], [u + d + w, v + d, u + 2 * d + w, v + d + h], [1, 0, 0]],
    // top (+Y): image bottom edge touches the front
    [[[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [u + d, v, u + d + w, v + d], [0, 1, 0]],
    // bottom (−Y)
    [[[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [u + d + w, v, u + d + 2 * w, v + d], [0, -1, 0]],
  ];
  for (const [c, [u0, v0, u1, v1], n] of faces) {
    let [a0, a1] = [u0, u1];
    if (b.mirror) [a0, a1] = [a1, a0];
    const uvs = [[a0, v0], [a0, v1], [a1, v1], [a1, v0]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      out.push(c[k]![0]!, c[k]![1]!, c[k]![2]!, uvs[k]![0]! / tw, uvs[k]![1]! / th, n[0], n[1], n[2]);
    }
  }
}

/** A model's geometry: one vertex range per part, in a single buffer. */
export interface BakedEntityModel {
  parts: { def: PartDef; first: number; count: number; parent: number }[];
  data: Float32Array;
}

export function bakeEntityModel(root: PartDef[], tw: number, th: number): BakedEntityModel {
  const out: number[] = [];
  const parts: BakedEntityModel['parts'] = [];
  const walk = (defs: PartDef[], parent: number) => {
    for (const def of defs) {
      const first = out.length / FLOATS_PER_VERTEX;
      for (const b of def.boxes) emitBox(out, b, tw, th);
      const idx = parts.length;
      parts.push({ def, first, count: out.length / FLOATS_PER_VERTEX - first, parent });
      if (def.children) walk(def.children, idx);
    }
  };
  walk(root, -1);
  return { parts, data: new Float32Array(out) };
}
