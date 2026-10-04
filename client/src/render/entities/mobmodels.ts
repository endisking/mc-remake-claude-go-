/**
 * Mob models. Geometry (box sizes, pivots, UV offsets) and animations follow the vanilla 1.17.1
 * model classes and are written in vanilla model space: pixels, +Y down, the model's front
 * toward −Z, y = 24 at the feet. The bake step converts each box so the shared box-unwrap
 * texture layout lands on the right faces; the renderer maps vanilla space to world space.
 *
 * Textures are original (tools/texgen/entities.ts) in the standard per-model UV layout.
 */
import { emitBox, FLOATS_PER_VERTEX, type ModelBox } from './model';
import { sheepColor, type ClientMob } from '../../world/mobs';

const PI = Math.PI;

export interface VBox {
  uv: [number, number];
  from: [number, number, number];
  size: [number, number, number];
  inflate?: number;
  mirror?: boolean;
}

export interface VPart {
  name: string;
  pivot: [number, number, number];
  rot?: [number, number, number];
  boxes: VBox[];
  children?: VPart[];
}

/** Runtime pose of a part in vanilla model space. */
export class VPose {
  x = 0;
  y = 0;
  z = 0;
  xRot = 0;
  yRot = 0;
  zRot = 0;
  visible = true;
  constructor(readonly def: VPart) {
    this.reset();
  }
  reset(): void {
    [this.x, this.y, this.z] = this.def.pivot;
    [this.xRot, this.yRot, this.zRot] = this.def.rot ?? [0, 0, 0];
    this.visible = true;
  }
  setPos(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  copyFrom(o: VPose): void {
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    this.xRot = o.xRot;
    this.yRot = o.yRot;
    this.zRot = o.zRot;
  }
}

export type Poses = Record<string, VPose>;

export interface MobAnim {
  limbSwing: number;
  limbSwingAmount: number;
  ageInTicks: number;
  /** head yaw relative to the body (degrees) */
  netHeadYaw: number;
  headPitch: number;
  attackTime: number;
  partial: number;
  mob: ClientMob;
}

/** AgeableListModel baby rendering parameters. */
export interface BabyParams {
  scaleHead: boolean;
  yHead: number;
  zHead: number;
  headScale: number;
  bodyScale: number;
  bodyY: number;
}

export interface MobModelDef {
  tex: [number, number];
  parts: VPart[];
  /** top-level parts drawn with the baby head transform */
  headParts?: string[];
  baby?: BabyParams;
  anim(p: Poses, a: MobAnim): void;
}

export interface BakedPart {
  def: VPart;
  first: number;
  count: number;
  parent: number;
}

export interface BakedMobModel {
  parts: BakedPart[];
  data: Float32Array;
}

const b = (u: number, v: number, x: number, y: number, z: number, w: number, h: number, d: number, inflate = 0, mirror = false): VBox => ({
  uv: [u, v], from: [x, y, z], size: [w, h, d], ...(inflate ? { inflate } : {}), ...(mirror ? { mirror } : {}),
});

/**
 * Bake a vanilla-space model: each box is converted to the y-up/+Z-front convention that
 * emitBox's texture layout assumes, emitted, and flipped back (diag(1, −1, −1)) so vertices
 * are in vanilla part space with the right texture on every face.
 */
export function bakeMobModel(parts: VPart[], tw: number, th: number): BakedMobModel {
  const out: number[] = [];
  const baked: BakedPart[] = [];
  const walk = (defs: VPart[], parent: number) => {
    for (const def of defs) {
      const first = out.length / FLOATS_PER_VERTEX;
      for (const vb of def.boxes) {
        const [x, y, z] = vb.from, [w, h, d] = vb.size;
        const mb: ModelBox = { from: [x, -(y + h), -(z + d)], size: [w, h, d], uv: vb.uv, inflate: vb.inflate, mirror: vb.mirror };
        const tmp: number[] = [];
        emitBox(tmp, mb, tw, th);
        for (let i = 0; i < tmp.length; i += FLOATS_PER_VERTEX) {
          tmp[i + 1] = -tmp[i + 1]!;
          tmp[i + 2] = -tmp[i + 2]!;
          tmp[i + 6] = -tmp[i + 6]!;
          tmp[i + 7] = -tmp[i + 7]!;
        }
        // flat boxes (fins: one size is 0) have degenerate faces; keep only faces with area
        const tri = 3 * FLOATS_PER_VERTEX;
        for (let i = 0; i < tmp.length; i += tri) {
          const ax = tmp[i + 8]! - tmp[i]!, ay = tmp[i + 9]! - tmp[i + 1]!, az = tmp[i + 10]! - tmp[i + 2]!;
          const bx = tmp[i + 16]! - tmp[i]!, by = tmp[i + 17]! - tmp[i + 1]!, bz = tmp[i + 18]! - tmp[i + 2]!;
          const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
          if (cx * cx + cy * cy + cz * cz < 1e-12) continue;
          for (let k = 0; k < tri; k++) out.push(tmp[i + k]!);
        }
      }
      const idx = baked.length;
      baked.push({ def, first, count: out.length / FLOATS_PER_VERTEX - first, parent });
      if (def.children) walk(def.children, idx);
    }
  };
  walk(parts, -1);
  return { parts: baked, data: new Float32Array(out) };
}

export function createPoses(parts: VPart[]): Poses {
  const p: Poses = {};
  const walk = (defs: VPart[]) => {
    for (const d of defs) {
      p[d.name] = new VPose(d);
      if (d.children) walk(d.children);
    }
  };
  walk(parts);
  return p;
}

// ------------------------------------------------------------------ geometry

/** HumanoidModel.createMesh(deformation g, yOffset) */
export function humanoidMesh(g = 0, yOff = 0, playerLimbs = false): VPart[] {
  return [
    { name: 'head', pivot: [0, yOff, 0], boxes: [b(0, 0, -4, -8, -4, 8, 8, 8, g)] },
    { name: 'hat', pivot: [0, yOff, 0], boxes: [b(32, 0, -4, -8, -4, 8, 8, 8, g + 0.5)] },
    { name: 'body', pivot: [0, yOff, 0], boxes: [b(16, 16, -4, 0, -2, 8, 12, 4, g)] },
    { name: 'right_arm', pivot: [-5, 2 + yOff, 0], boxes: [b(40, 16, -3, -2, -2, 4, 12, 4, g)] },
    { name: 'left_arm', pivot: [5, 2 + yOff, 0], boxes: [playerLimbs ? b(32, 48, -1, -2, -2, 4, 12, 4, g) : b(40, 16, -1, -2, -2, 4, 12, 4, g, true)] },
    { name: 'right_leg', pivot: [-1.9, 12 + yOff, 0], boxes: [b(0, 16, -2, 0, -2, 4, 12, 4, g)] },
    { name: 'left_leg', pivot: [1.9, 12 + yOff, 0], boxes: [playerLimbs ? b(16, 48, -2, 0, -2, 4, 12, 4, g) : b(0, 16, -2, 0, -2, 4, 12, 4, g, true)] },
  ];
}

/** SkeletonModel.createBodyLayer: thin 2×12×2 limbs. */
export function skeletonMesh(): VPart[] {
  const m = humanoidMesh();
  const set = (name: string, pivot: [number, number, number], box: VBox) => {
    const p = m.find((x) => x.name === name)!;
    p.pivot = pivot;
    p.boxes = [box];
  };
  set('right_arm', [-5, 2, 0], b(40, 16, -1, -2, -1, 2, 12, 2));
  set('left_arm', [5, 2, 0], b(40, 16, -1, -2, -1, 2, 12, 2, 0, true));
  set('right_leg', [-2, 12, 0], b(0, 16, -1, 0, -1, 2, 12, 2));
  set('left_leg', [2, 12, 0], b(0, 16, -1, 0, -1, 2, 12, 2, 0, true));
  return m;
}

/** CreeperModel.createBodyLayer */
export function creeperMesh(g = 0): VPart[] {
  const leg = () => [b(0, 16, -2, 0, -2, 4, 6, 4, g)];
  return [
    { name: 'head', pivot: [0, 6, 0], boxes: [b(0, 0, -4, -8, -4, 8, 8, 8, g)] },
    { name: 'body', pivot: [0, 6, 0], boxes: [b(16, 16, -4, 0, -2, 8, 12, 4, g)] },
    { name: 'right_hind_leg', pivot: [-2, 18, 4], boxes: leg() },
    { name: 'left_hind_leg', pivot: [2, 18, 4], boxes: leg() },
    { name: 'right_front_leg', pivot: [-2, 18, -4], boxes: leg() },
    { name: 'left_front_leg', pivot: [2, 18, -4], boxes: leg() },
  ];
}

/** SpiderModel.createSpiderBodyLayer */
export function spiderMesh(): VPart[] {
  const r = () => [b(18, 0, -15, -1, -1, 16, 2, 2)];
  const l = () => [b(18, 0, -1, -1, -1, 16, 2, 2, 0, true)];
  return [
    { name: 'head', pivot: [0, 15, -3], boxes: [b(32, 4, -4, -4, -8, 8, 8, 8)] },
    { name: 'body0', pivot: [0, 15, 0], boxes: [b(0, 0, -3, -3, -3, 6, 6, 6)] },
    { name: 'body1', pivot: [0, 15, 9], boxes: [b(0, 12, -5, -4, -6, 10, 8, 12)] },
    { name: 'right_hind_leg', pivot: [-4, 15, 2], boxes: r() },
    { name: 'left_hind_leg', pivot: [4, 15, 2], boxes: l() },
    { name: 'right_middle_hind_leg', pivot: [-4, 15, 1], boxes: r() },
    { name: 'left_middle_hind_leg', pivot: [4, 15, 1], boxes: l() },
    { name: 'right_middle_front_leg', pivot: [-4, 15, 0], boxes: r() },
    { name: 'left_middle_front_leg', pivot: [4, 15, 0], boxes: l() },
    { name: 'right_front_leg', pivot: [-4, 15, -1], boxes: r() },
    { name: 'left_front_leg', pivot: [4, 15, -1], boxes: l() },
  ];
}

/** QuadrupedModel.createBodyMesh(legHeight, g) */
export function quadrupedMesh(legHeight: number, g = 0): VPart[] {
  const leg = () => [b(0, 16, -2, 0, -2, 4, legHeight, 4, g)];
  return [
    { name: 'head', pivot: [0, 18 - legHeight, -6], boxes: [b(0, 0, -4, -4, -8, 8, 8, 8, g)] },
    { name: 'body', pivot: [0, 17 - legHeight, 2], rot: [PI / 2, 0, 0], boxes: [b(28, 8, -5, -10, -7, 10, 16, 8, g)] },
    { name: 'right_hind_leg', pivot: [-3, 24 - legHeight, 7], boxes: leg() },
    { name: 'left_hind_leg', pivot: [3, 24 - legHeight, 7], boxes: leg() },
    { name: 'right_front_leg', pivot: [-3, 24 - legHeight, -5], boxes: leg() },
    { name: 'left_front_leg', pivot: [3, 24 - legHeight, -5], boxes: leg() },
  ];
}

/** PigModel.createBodyLayer (the saddle layer is the same mesh inflated by 0.5) */
export function pigMesh(g = 0): VPart[] {
  const m = quadrupedMesh(6, g);
  m[0] = { name: 'head', pivot: [0, 12, -6], boxes: [b(0, 0, -4, -4, -8, 8, 8, 8, g), b(16, 16, -2, 0, -9, 4, 3, 1, g)] };
  return m;
}

/** CowModel.createBodyLayer */
export function cowMesh(): VPart[] {
  const leg = (mirror: boolean) => [b(0, 16, -2, 0, -2, 4, 12, 4, 0, mirror)];
  return [
    { name: 'head', pivot: [0, 4, -8], boxes: [b(0, 0, -4, -4, -6, 8, 8, 6), b(22, 0, -5, -5, -4, 1, 3, 1), b(22, 0, 4, -5, -4, 1, 3, 1)] },
    { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: [b(18, 4, -6, -10, -7, 12, 18, 10), b(52, 0, -2, 2, -8, 4, 6, 1)] },
    { name: 'right_hind_leg', pivot: [-4, 12, 7], boxes: leg(false) },
    { name: 'left_hind_leg', pivot: [4, 12, 7], boxes: leg(true) },
    { name: 'right_front_leg', pivot: [-4, 12, -6], boxes: leg(false) },
    { name: 'left_front_leg', pivot: [4, 12, -6], boxes: leg(true) },
  ];
}

/** SheepModel.createBodyLayer */
export function sheepMesh(): VPart[] {
  const m = quadrupedMesh(12);
  m[0] = { name: 'head', pivot: [0, 6, -8], boxes: [b(0, 0, -3, -4, -6, 6, 6, 8)] };
  m[1] = { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: [b(28, 8, -4, -10, -7, 8, 16, 6)] };
  return m;
}

/** SheepFurModel.createFurLayer */
export function sheepFurMesh(): VPart[] {
  const leg = () => [b(0, 16, -2, 0, -2, 4, 6, 4, 0.5)];
  return [
    { name: 'head', pivot: [0, 6, -8], boxes: [b(0, 0, -3, -4, -4, 6, 6, 6, 0.6)] },
    { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: [b(28, 8, -4, -10, -7, 8, 16, 6, 1.75)] },
    { name: 'right_hind_leg', pivot: [-3, 12, 7], boxes: leg() },
    { name: 'left_hind_leg', pivot: [3, 12, 7], boxes: leg() },
    { name: 'right_front_leg', pivot: [-3, 12, -5], boxes: leg() },
    { name: 'left_front_leg', pivot: [3, 12, -5], boxes: leg() },
  ];
}

/** ChickenModel.createBodyLayer */
export function chickenMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, 15, -4], boxes: [b(0, 0, -2, -6, -2, 4, 6, 3)] },
    { name: 'beak', pivot: [0, 15, -4], boxes: [b(14, 0, -2, -4, -4, 4, 2, 2)] },
    { name: 'red_thing', pivot: [0, 15, -4], boxes: [b(14, 4, -1, -2, -3, 2, 2, 2)] },
    { name: 'body', pivot: [0, 16, 0], rot: [PI / 2, 0, 0], boxes: [b(0, 9, -3, -4, -3, 6, 8, 6)] },
    { name: 'right_leg', pivot: [-2, 19, 1], boxes: [b(26, 0, -1, 0, -3, 3, 5, 3)] },
    { name: 'left_leg', pivot: [1, 19, 1], boxes: [b(26, 0, -1, 0, -3, 3, 5, 3)] },
    { name: 'right_wing', pivot: [-4, 13, 0], boxes: [b(24, 13, 0, 0, -3, 1, 4, 6)] },
    { name: 'left_wing', pivot: [4, 13, 0], boxes: [b(24, 13, -1, 0, -3, 1, 4, 6)] },
  ];
}

/** EndermanModel.createBodyLayer */
export function endermanMesh(): VPart[] {
  const limb = (mirror: boolean) => [b(56, 0, -1, -2, -1, 2, 30, 2, 0, mirror)];
  const legBox = (mirror: boolean) => [b(56, 0, -1, 0, -1, 2, 30, 2, 0, mirror)];
  return [
    { name: 'head', pivot: [0, -13, 0], boxes: [b(0, 0, -4, -8, -4, 8, 8, 8)] },
    { name: 'hat', pivot: [0, -13, 0], boxes: [b(0, 16, -4, -8, -4, 8, 8, 8, -0.5)] },
    { name: 'body', pivot: [0, -14, 0], boxes: [b(32, 16, -4, 0, -2, 8, 12, 4)] },
    { name: 'right_arm', pivot: [-5, -12, 0], boxes: limb(false) },
    { name: 'left_arm', pivot: [5, -12, 0], boxes: limb(true) },
    { name: 'right_leg', pivot: [-2, -5, 0], boxes: legBox(false) },
    { name: 'left_leg', pivot: [2, -5, 0], boxes: legBox(true) },
  ];
}

/** SlimeModel inner body (cube, eyes, mouth) */
export function slimeInnerMesh(): VPart[] {
  return [
    { name: 'cube', pivot: [0, 0, 0], boxes: [b(0, 16, -3, 17, -3, 6, 6, 6)] },
    { name: 'right_eye', pivot: [0, 0, 0], boxes: [b(32, 0, -3.25, 18, -3.5, 2, 2, 2)] },
    { name: 'left_eye', pivot: [0, 0, 0], boxes: [b(32, 4, 1.25, 18, -3.5, 2, 2, 2)] },
    { name: 'mouth', pivot: [0, 0, 0], boxes: [b(32, 8, 0, 21, -3.5, 1, 1, 1)] },
  ];
}

/** SlimeModel outer (translucent) cube */
export function slimeOuterMesh(): VPart[] {
  return [{ name: 'cube', pivot: [0, 0, 0], boxes: [b(0, 0, -4, 16, -4, 8, 8, 8)] }];
}

/** BatModel.createBodyLayer */
export function batMesh(): VPart[] {
  return [
    {
      name: 'head', pivot: [0, 0, 0], boxes: [b(0, 0, -3, -3, -3, 6, 6, 6)], children: [
        { name: 'right_ear', pivot: [0, 0, 0], boxes: [b(24, 0, -4, -6, -2, 3, 4, 1)] },
        { name: 'left_ear', pivot: [0, 0, 0], boxes: [b(24, 0, 1, -6, -2, 3, 4, 1, 0, true)] },
      ],
    },
    {
      name: 'body', pivot: [0, 0, 0], boxes: [b(0, 16, -3, 4, -3, 6, 12, 6), b(0, 34, -5, 16, 0, 10, 6, 1)], children: [
        {
          name: 'right_wing', pivot: [0, 0, 0], boxes: [b(42, 0, -12, 1, 1.5, 10, 16, 1)], children: [
            { name: 'right_wing_tip', pivot: [-12, 1, 1.5], boxes: [b(24, 16, -8, 1, 0, 8, 12, 1)] },
          ],
        },
        {
          name: 'left_wing', pivot: [0, 0, 0], boxes: [b(42, 0, 2, 1, 1.5, 10, 16, 1, 0, true)], children: [
            { name: 'left_wing_tip', pivot: [12, 1, 1.5], boxes: [b(24, 16, 0, 1, 0, 8, 12, 1, 0, true)] },
          ],
        },
      ],
    },
  ];
}

/** SquidModel.createBodyLayer: body and 8 tentacles in a ring */
export function squidMesh(): VPart[] {
  const parts: VPart[] = [{ name: 'body', pivot: [0, 8, 0], boxes: [b(0, 0, -6, -8, -6, 12, 16, 12)] }];
  for (let j = 0; j < 8; j++) {
    const a = (j * PI * 2) / 8;
    parts.push({ name: `tentacle${j}`, pivot: [Math.cos(a) * 5, 15, Math.sin(a) * 5], rot: [0, (j * PI * -2) / 8 + PI / 2, 0], boxes: [b(48, 0, -1, 0, -1, 2, 18, 2)] });
  }
  return parts;
}

/** VillagerModel.createBodyModel: tall head with a nose, robe, folded arms. */
export function villagerMesh(): VPart[] {
  return [
    {
      name: 'head', pivot: [0, 0, 0], boxes: [b(0, 0, -4, -10, -4, 8, 10, 8)], children: [
        {
          name: 'hat', pivot: [0, 0, 0], boxes: [b(32, 0, -4, -10, -4, 8, 10, 8, 0.51)], children: [
            { name: 'hat_rim', pivot: [0, 0, 0], rot: [-PI / 2, 0, 0], boxes: [b(30, 47, -8, -8, -6, 16, 16, 1)] },
          ],
        },
        { name: 'nose', pivot: [0, -2, 0], boxes: [b(24, 0, -1, -1, -6, 2, 4, 2)] },
      ],
    },
    {
      name: 'body', pivot: [0, 0, 0], boxes: [b(16, 20, -4, 0, -3, 8, 12, 6)], children: [
        { name: 'jacket', pivot: [0, 0, 0], boxes: [b(0, 38, -4, 0, -3, 8, 18, 6, 0.5)] },
      ],
    },
    { name: 'arms', pivot: [0, 3, -1], rot: [-0.75, 0, 0], boxes: [b(44, 22, -8, -2, -2, 4, 8, 4), b(44, 22, 4, -2, -2, 4, 8, 4, 0, true), b(40, 38, -4, 2, -2, 8, 4, 4)] },
    { name: 'right_leg', pivot: [-2, 12, 0], boxes: [b(0, 22, -2, 0, -2, 4, 12, 4)] },
    { name: 'left_leg', pivot: [2, 12, 0], boxes: [b(0, 22, -2, 0, -2, 4, 12, 4, 0, true)] },
  ];
}

/** WitchModel: the villager body with a mole on the nose and a crooked pointed hat. */
export function witchMesh(): VPart[] {
  const m = villagerMesh();
  const head = m[0]!;
  head.children = [
    {
      name: 'hat', pivot: [-5, -10.03125, -5], boxes: [b(0, 64, 0, 0, 0, 10, 2, 10)], children: [
        {
          name: 'hat2', pivot: [1.75, -4, 2], rot: [-0.05235988, 0, 0.02617994], boxes: [b(0, 76, 0, 0, 0, 7, 4, 7)], children: [
            {
              name: 'hat3', pivot: [1.75, -4, 2], rot: [-0.10471976, 0, 0.05235988], boxes: [b(0, 87, 0, 0, 0, 4, 4, 4)], children: [
                { name: 'hat4', pivot: [1.75, -2, 2], rot: [-0.20943952, 0, 0.10471976], boxes: [b(0, 95, 0, 0, 0, 1, 2, 1, 0.25)] },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'nose', pivot: [0, -2, 0], boxes: [b(24, 0, -1, -1, -6, 2, 4, 2)], children: [
        { name: 'mole', pivot: [0, -2, 0], boxes: [b(0, 0, 0, 3, -6.75, 1, 1, 1, -0.25)] },
      ],
    },
  ];
  return m;
}

/** ZombieVillagerModel: humanoid limbs with the villager head and robe. */
export function zombieVillagerMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, 0, 0], boxes: [b(0, 0, -4, -10, -4, 8, 10, 8), b(24, 0, -1, -3, -6, 2, 4, 2)] },
    {
      name: 'hat', pivot: [0, 0, 0], boxes: [b(32, 0, -4, -10, -4, 8, 10, 8, 0.5)], children: [
        { name: 'hat_rim', pivot: [0, 0, 0], rot: [-PI / 2, 0, 0], boxes: [b(30, 47, -8, -8, -6, 16, 16, 1)] },
      ],
    },
    { name: 'body', pivot: [0, 0, 0], boxes: [b(16, 20, -4, 0, -3, 8, 12, 6), b(0, 38, -4, 0, -3, 8, 20, 6, 0.05)] },
    { name: 'right_arm', pivot: [-5, 2, 0], boxes: [b(44, 22, -3, -2, -2, 4, 12, 4)] },
    { name: 'left_arm', pivot: [5, 2, 0], boxes: [b(44, 22, -1, -2, -2, 4, 12, 4, 0, true)] },
    { name: 'right_leg', pivot: [-2, 12, 0], boxes: [b(0, 22, -2, 0, -2, 4, 12, 4)] },
    { name: 'left_leg', pivot: [2, 12, 0], boxes: [b(0, 22, -2, 0, -2, 4, 12, 4, 0, true)] },
  ];
}

/** IronGolemModel.createBodyLayer (128×128) */
export function ironGolemMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, -7, -2], boxes: [b(0, 0, -4, -12, -5.5, 8, 10, 8), b(24, 0, -1, -5, -7.5, 2, 4, 2)] },
    { name: 'body', pivot: [0, -7, 0], boxes: [b(0, 40, -9, -2, -6, 18, 12, 11), b(0, 70, -4.5, 10, -3, 9, 5, 6, 0.5)] },
    { name: 'right_arm', pivot: [0, -7, 0], boxes: [b(60, 21, -13, -2.5, -3, 4, 30, 6)] },
    { name: 'left_arm', pivot: [0, -7, 0], boxes: [b(60, 58, 9, -2.5, -3, 4, 30, 6)] },
    { name: 'right_leg', pivot: [-4, 11, 0], boxes: [b(37, 0, -3.5, -3, -3, 6, 16, 5)] },
    { name: 'left_leg', pivot: [5, 11, 0], boxes: [b(60, 0, -3.5, -3, -3, 6, 16, 5, 0, true)] },
  ];
}

/** WolfModel.createBodyLayer */
export function wolfMesh(): VPart[] {
  const leg = () => [b(0, 18, 0, 0, -1, 2, 8, 2)];
  return [
    {
      name: 'head', pivot: [-1, 13.5, -7], boxes: [], children: [
        { name: 'real_head', pivot: [0, 0, 0], boxes: [b(0, 0, -2, -3, -2, 6, 6, 4), b(16, 14, -2, -5, 0, 2, 2, 1), b(16, 14, 2, -5, 0, 2, 2, 1), b(0, 10, -0.5, 0, -5, 3, 3, 4)] },
      ],
    },
    { name: 'body', pivot: [0, 14, 2], rot: [PI / 2, 0, 0], boxes: [b(18, 14, -3, -2, -3, 6, 9, 6)] },
    { name: 'upper_body', pivot: [-1, 14, -3], rot: [PI / 2, 0, 0], boxes: [b(21, 0, -3, -3, -3, 8, 6, 7)] },
    { name: 'right_hind_leg', pivot: [-2.5, 16, 7], boxes: leg() },
    { name: 'left_hind_leg', pivot: [0.5, 16, 7], boxes: leg() },
    { name: 'right_front_leg', pivot: [-2.5, 16, -4], boxes: leg() },
    { name: 'left_front_leg', pivot: [0.5, 16, -4], boxes: leg() },
    { name: 'tail', pivot: [-1, 12, 8], boxes: [], children: [{ name: 'real_tail', pivot: [0, 0, 0], boxes: [b(9, 18, 0, 0, -1, 2, 8, 2)] }] },
  ];
}

/** PhantomModel.createBodyLayer: flat body, two-segment wings, tail. */
export function phantomMesh(): VPart[] {
  return [
    {
      name: 'body', pivot: [0, 0, 0], rot: [-0.1, 0, 0], boxes: [b(0, 8, -3, -2, -8, 5, 3, 9)], children: [
        {
          name: 'tail_base', pivot: [0, -2, 1], boxes: [b(3, 20, -2, 0, 0, 3, 2, 6)], children: [
            { name: 'tail_tip', pivot: [0, 0.5, 6], boxes: [b(4, 29, -1, 0, 0, 1, 1, 6)] },
          ],
        },
        {
          name: 'left_wing_base', pivot: [2, -2, -8], rot: [0, 0, 0.1], boxes: [b(23, 12, 0, 0, 0, 6, 2, 9)], children: [
            { name: 'left_wing_tip', pivot: [6, 0, 0], rot: [0, 0, 0.1], boxes: [b(16, 24, 0, 0, 0, 13, 1, 9)] },
          ],
        },
        {
          name: 'right_wing_base', pivot: [-3, -2, -8], rot: [0, 0, -0.1], boxes: [b(23, 12, -6, 0, 0, 6, 2, 9, 0, true)], children: [
            { name: 'right_wing_tip', pivot: [-6, 0, 0], rot: [0, 0, -0.1], boxes: [b(16, 24, -13, 0, 0, 13, 1, 9, 0, true)] },
          ],
        },
        { name: 'head', pivot: [0, 1, -7], rot: [0.2, 0, 0], boxes: [b(0, 0, -4, -2, -5, 7, 3, 5)] },
      ],
    },
  ];
}

/** IllagerModel.createBodyLayer: villager-like head and robe, crossed arms or free arms. */
export function illagerMesh(): VPart[] {
  return [
    {
      name: 'head', pivot: [0, 0, 0], boxes: [b(0, 0, -4, -10, -4, 8, 10, 8)], children: [
        { name: 'nose', pivot: [0, -2, 0], boxes: [b(24, 0, -1, -1, -6, 2, 4, 2)] },
      ],
    },
    { name: 'body', pivot: [0, 0, 0], boxes: [b(16, 20, -4, 0, -3, 8, 12, 6), b(0, 38, -4, 0, -3, 8, 20, 6, 0.5)] },
    { name: 'arms', pivot: [0, 3, -1], rot: [-0.75, 0, 0], boxes: [b(44, 22, -8, -2, -2, 4, 8, 4), b(44, 22, 4, -2, -2, 4, 8, 4, 0, true), b(40, 38, -4, 2, -2, 8, 4, 4)] },
    { name: 'right_leg', pivot: [-2, 12, 0], boxes: [b(0, 22, -2, 0, -2, 4, 12, 4)] },
    { name: 'left_leg', pivot: [2, 12, 0], boxes: [b(0, 22, -2, 0, -2, 4, 12, 4, 0, true)] },
    { name: 'right_arm', pivot: [-5, 2, 0], boxes: [b(40, 46, -3, -2, -2, 4, 12, 4)] },
    { name: 'left_arm', pivot: [5, 2, 0], boxes: [b(40, 46, -1, -2, -2, 4, 12, 4, 0, true)] },
  ];
}

/** CodModel.createBodyLayer (32×32; fin UVs moved inside the texture) */
export function codMesh(): VPart[] {
  return [
    { name: 'body', pivot: [0, 22, 0], boxes: [b(0, 0, -1, -2, 0, 2, 4, 7)] },
    { name: 'head', pivot: [0, 22, 0], boxes: [b(11, 0, -1, -2, -3, 2, 4, 3)] },
    { name: 'nose', pivot: [0, 22, -3], boxes: [b(0, 11, -1, -2, -1, 2, 3, 1)] },
    { name: 'right_fin', pivot: [-1, 23, 0], rot: [0, -PI / 4, 0], boxes: [b(22, 1, -2, 0, -1, 2, 0, 2)] },
    { name: 'left_fin', pivot: [1, 23, 0], rot: [0, PI / 4, 0], boxes: [b(22, 4, 0, 0, -1, 2, 0, 2)] },
    { name: 'tail_fin', pivot: [0, 22, 7], boxes: [b(22, 3, 0, -2, 0, 0, 4, 4)] },
    { name: 'top_fin', pivot: [0, 20, 0], boxes: [b(20, 10, 0, -1, -1, 0, 1, 6)] },
  ];
}

/** SalmonModel.createBodyLayer (32×32; fin UVs moved inside the texture) */
export function salmonMesh(): VPart[] {
  return [
    {
      name: 'body_front', pivot: [0, 20, 0], boxes: [b(0, 0, -1.5, -2.5, 0, 3, 5, 8)], children: [
        { name: 'top_front_fin', pivot: [0, -4.5, 5], boxes: [b(2, 26, 0, 0, 0, 0, 2, 3)] },
      ],
    },
    {
      name: 'body_back', pivot: [0, 20, 8], boxes: [b(0, 13, -1.5, -2.5, 0, 3, 5, 8)], children: [
        { name: 'back_fin', pivot: [0, 0, 8], boxes: [b(20, 10, 0, -2.5, 0, 0, 5, 6)] },
        { name: 'top_back_fin', pivot: [0, -4.5, -1], boxes: [b(8, 26, 0, 0, 0, 0, 2, 4)] },
      ],
    },
    { name: 'head', pivot: [0, 20, 0], boxes: [b(22, 0, -1, -2, -3, 2, 4, 3)] },
    { name: 'right_fin', pivot: [-1.5, 21.5, 0], rot: [0, 0, -PI / 4], boxes: [b(22, 22, -2, 0, 0, 2, 0, 2)] },
    { name: 'left_fin', pivot: [1.5, 21.5, 0], rot: [0, 0, PI / 4], boxes: [b(26, 22, 0, 0, 0, 2, 0, 2)] },
  ];
}

/** HorseModel.createBodyMesh (64×64): long body, neck with head, mane and muzzle, tall legs. */
export function horseMesh(longEars = false): VPart[] {
  const ears: VPart[] = longEars
    ? [
        { name: 'left_ear', pivot: [0, 0, 0], boxes: [b(0, 12, 0, -18, 4, 2, 7, 1)] },
        { name: 'right_ear', pivot: [0, 0, 0], boxes: [b(0, 12, -2, -18, 4, 2, 7, 1)] },
      ]
    : [
        { name: 'left_ear', pivot: [0, 0, 0], boxes: [b(19, 16, 0.55, -13, 4, 2, 3, 1, -0.001)] },
        { name: 'right_ear', pivot: [0, 0, 0], boxes: [b(19, 16, -2.55, -13, 4, 2, 3, 1, -0.001)] },
      ];
  const leg = (mirror: boolean, x0: number, z0: number) => [b(48, 21, x0, -1.01, z0, 4, 11, 4, 0, mirror)];
  return [
    { name: 'body', pivot: [0, 11, 5], boxes: [b(0, 32, -5, -8, -17, 10, 10, 22, 0.05)] },
    {
      name: 'head_parts', pivot: [0, 4, -12], rot: [PI / 6, 0, 0], boxes: [b(0, 35, -2, -11, -2, 4, 12, 7)], children: [
        { name: 'head', pivot: [0, 0, 0], boxes: [b(0, 13, -3, -11, -2, 6, 5, 7)] },
        { name: 'mane', pivot: [0, 0, 0], boxes: [b(56, 36, -1, -11, 5.01, 2, 16, 2)] },
        { name: 'upper_mouth', pivot: [0, 0, 0], boxes: [b(0, 25, -2, -11, -7, 4, 5, 5)] },
        ...ears,
      ],
    },
    { name: 'left_hind_leg', pivot: [4, 14, 7], boxes: leg(true, -3, -1) },
    { name: 'right_hind_leg', pivot: [-4, 14, 7], boxes: leg(false, -1, -1) },
    { name: 'left_front_leg', pivot: [4, 14, -12], boxes: leg(true, -3, -1.9) },
    { name: 'right_front_leg', pivot: [-4, 14, -12], boxes: leg(false, -1, -1.9) },
    { name: 'tail', pivot: [0, 4, 11], rot: [PI / 6, 0, 0], boxes: [b(42, 36, -1.5, 0, 0, 3, 14, 4)] },
  ];
}

/** OcelotModel.createBodyMesh (64×32): cats and ocelots. */
export function felineMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, 15, -9], boxes: [b(0, 0, -2.5, -2, -3, 5, 4, 5), b(0, 24, -1.5, 0, -4, 3, 2, 2), b(0, 10, -2, -3, 0, 1, 1, 2), b(6, 10, 1, -3, 0, 1, 1, 2)] },
    { name: 'body', pivot: [0, 12, -10], rot: [PI / 2, 0, 0], boxes: [b(20, 0, -2, 3, -8, 4, 16, 6)] },
    { name: 'tail1', pivot: [0, 15, 8], rot: [0.9, 0, 0], boxes: [b(0, 15, -0.5, 0, 0, 1, 8, 1)] },
    { name: 'tail2', pivot: [0, 20, 14], boxes: [b(4, 15, -0.5, 0, 0, 1, 8, 1)] },
    { name: 'left_hind_leg', pivot: [1.1, 18, 5], boxes: [b(8, 13, -1, 0, 1, 2, 6, 2)] },
    { name: 'right_hind_leg', pivot: [-1.1, 18, 5], boxes: [b(8, 13, -1, 0, 1, 2, 6, 2)] },
    { name: 'left_front_leg', pivot: [1.2, 14.1, -5], boxes: [b(40, 0, -1, 0, 0, 2, 10, 2)] },
    { name: 'right_front_leg', pivot: [-1.2, 14.1, -5], boxes: [b(40, 0, -1, 0, 0, 2, 10, 2)] },
  ];
}

/** PolarBearModel.createBodyLayer (128×64) */
export function polarBearMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, 10, -16], boxes: [b(0, 0, -3.5, -3, -3, 7, 7, 7), b(0, 44, -2.5, 1, -6, 5, 3, 3), b(26, 0, -4.5, -4, -1, 2, 2, 1), b(26, 0, 2.5, -4, -1, 2, 2, 1, 0, true)] },
    { name: 'body', pivot: [-2, 9, 12], rot: [PI / 2, 0, 0], boxes: [b(0, 19, -5, -13, -7, 14, 14, 11), b(39, 0, -4, -25, -7, 12, 12, 10)] },
    { name: 'right_hind_leg', pivot: [-4.5, 14, 6], boxes: [b(50, 22, -2, 0, -2, 4, 10, 8)] },
    { name: 'left_hind_leg', pivot: [4.5, 14, 6], boxes: [b(50, 22, -2, 0, -2, 4, 10, 8)] },
    { name: 'right_front_leg', pivot: [-3.5, 14, -8], boxes: [b(50, 40, -2, 0, -2, 4, 10, 6)] },
    { name: 'left_front_leg', pivot: [3.5, 14, -8], boxes: [b(50, 40, -2, 0, -2, 4, 10, 6)] },
  ];
}

/** SnowGolemModel.createBodyLayer (64×64) */
export function snowGolemMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, 4, 0], boxes: [b(0, 0, -4, -8, -4, 8, 8, 8, -0.5)] },
    { name: 'left_arm', pivot: [5, 6, 1], rot: [0, 0, 1], boxes: [b(32, 0, -1, 0, -1, 12, 2, 2, -0.5)] },
    { name: 'right_arm', pivot: [-5, 6, -1], rot: [0, PI, -1], boxes: [b(32, 0, -1, 0, -1, 12, 2, 2, -0.5)] },
    { name: 'upper_body', pivot: [0, 13, 0], boxes: [b(0, 16, -5, -10, -5, 10, 10, 10, -0.5)] },
    { name: 'lower_body', pivot: [0, 24, 0], boxes: [b(0, 36, -6, -12, -6, 12, 12, 12, -0.5)] },
  ];
}

/** SilverfishModel / EndermiteModel: a chain of segments (plus the silverfish's three shell layers). */
export function segmentedMesh(sizes: number[][], texs: number[][], layers: boolean): VPart[] {
  const parts: VPart[] = [];
  const place: number[] = [];
  let f = -3.5;
  for (let i = 0; i < sizes.length; i++) {
    const [w, h, d] = sizes[i]!;
    parts.push({ name: `segment${i}`, pivot: [0, 24 - h!, f], boxes: [b(texs[i]![0]!, texs[i]![1]!, w! * -0.5, 0, d! * -0.5, w!, h!, d!)] });
    place[i] = f;
    if (i < sizes.length - 1) f += (d! + sizes[i + 1]![2]!) * 0.5;
  }
  if (layers) {
    parts.push({ name: 'layer0', pivot: [0, 16, place[2]!], boxes: [b(20, 0, -5, 0, sizes[2]![2]! * -0.5, 10, 8, sizes[2]![2]!)] });
    parts.push({ name: 'layer1', pivot: [0, 20, place[4]!], boxes: [b(20, 11, -3, 0, sizes[4]![2]! * -0.5, 6, 4, sizes[4]![2]!)] });
    parts.push({ name: 'layer2', pivot: [0, 19, place[1]!], boxes: [b(20, 18, -3, 0, sizes[4]![2]! * -0.5, 6, 5, sizes[1]![2]!)] });
  }
  return parts;
}

const SILVERFISH_SIZES = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
const SILVERFISH_TEXS = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
const ENDERMITE_SIZES = [[4, 3, 2], [6, 4, 5], [3, 3, 1], [1, 2, 1]];
const ENDERMITE_TEXS = [[0, 0], [0, 5], [0, 14], [0, 18]];

/** BeeModel.createBodyLayer (64×64) */
export function beeMesh(): VPart[] {
  return [
    {
      name: 'bone', pivot: [0, 19, 0], boxes: [], children: [
        {
          name: 'body', pivot: [0, 0, 0], boxes: [b(0, 0, -3.5, -4, -5, 7, 7, 10)], children: [
            { name: 'stinger', pivot: [0, 0, 0], boxes: [b(26, 7, 0, -1, 5, 0, 1, 2)] },
            { name: 'left_antenna', pivot: [0, -2, -5], boxes: [b(2, 0, 1.5, -2, -3, 1, 2, 3)] },
            { name: 'right_antenna', pivot: [0, -2, -5], boxes: [b(2, 3, -2.5, -2, -3, 1, 2, 3)] },
          ],
        },
        { name: 'right_wing', pivot: [-1.5, -4, -3], rot: [0, -0.2618, 0], boxes: [b(0, 18, -9, 0, 0, 9, 0, 6)] },
        { name: 'left_wing', pivot: [1.5, -4, -3], rot: [0, 0.2618, 0], boxes: [b(0, 18, 0, 0, 0, 9, 0, 6, 0, true)] },
        { name: 'front_legs', pivot: [1.5, 3, -2], boxes: [b(26, 1, -5, 0, 0, 7, 2, 0)] },
        { name: 'middle_legs', pivot: [1.5, 3, 0], boxes: [b(26, 3, -5, 0, 0, 7, 2, 0)] },
        { name: 'back_legs', pivot: [1.5, 3, 2], boxes: [b(26, 5, -5, 0, 0, 7, 2, 0)] },
      ],
    },
  ];
}

/** RabbitModel.createBodyLayer (64×32) */
export function rabbitMesh(): VPart[] {
  const tilt = -0.34906584;
  return [
    { name: 'left_hind_foot', pivot: [3, 17.5, 3.7], boxes: [b(26, 24, -1, 5.5, -3.7, 2, 1, 7)] },
    { name: 'right_hind_foot', pivot: [-3, 17.5, 3.7], boxes: [b(8, 24, -1, 5.5, -3.7, 2, 1, 7)] },
    { name: 'left_haunch', pivot: [3, 17.5, 3.7], rot: [tilt, 0, 0], boxes: [b(30, 15, -1, 0, 0, 2, 4, 5)] },
    { name: 'right_haunch', pivot: [-3, 17.5, 3.7], rot: [tilt, 0, 0], boxes: [b(16, 15, -1, 0, 0, 2, 4, 5)] },
    { name: 'body', pivot: [0, 19, 8], rot: [tilt, 0, 0], boxes: [b(0, 0, -3, -2, -10, 6, 5, 10)] },
    { name: 'left_front_leg', pivot: [3, 17, -1], rot: [-0.19198622, 0, 0], boxes: [b(8, 15, -1, 0, -1, 2, 7, 2)] },
    { name: 'right_front_leg', pivot: [-3, 17, -1], rot: [-0.19198622, 0, 0], boxes: [b(0, 15, -1, 0, -1, 2, 7, 2)] },
    { name: 'head', pivot: [0, 16, -1], boxes: [b(32, 0, -2.5, -4, -5, 5, 4, 5)] },
    { name: 'right_ear', pivot: [0, 16, -1], rot: [0, -0.2617994, 0], boxes: [b(52, 0, -2.5, -9, -1, 2, 5, 1)] },
    { name: 'left_ear', pivot: [0, 16, -1], rot: [0, 0.2617994, 0], boxes: [b(58, 0, 0.5, -9, -1, 2, 5, 1)] },
    { name: 'tail', pivot: [0, 20, 7], rot: [-0.3490659, 0, 0], boxes: [b(52, 6, -1.5, -1.5, 0, 3, 3, 2)] },
    { name: 'nose', pivot: [0, 16, -1], boxes: [b(32, 9, -0.5, -2.5, -5.5, 1, 1, 1)] },
  ];
}

/** LlamaModel.createBodyLayer (128×64) */
export function llamaMesh(): VPart[] {
  const leg = () => [b(29, 29, -2, 0, -2, 4, 14, 4)];
  return [
    { name: 'head', pivot: [0, 7, -6], boxes: [b(0, 0, -2, -14, -10, 4, 4, 9), b(0, 14, -4, -16, -6, 8, 18, 6), b(17, 0, -4, -19, -4, 3, 3, 2), b(17, 0, 1, -19, -4, 3, 3, 2)] },
    { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: [b(29, 0, -6, -10, -7, 12, 18, 10)] },
    { name: 'right_hind_leg', pivot: [-3.5, 10, 6], boxes: leg() },
    { name: 'left_hind_leg', pivot: [3.5, 10, 6], boxes: leg() },
    { name: 'right_front_leg', pivot: [-3.5, 10, -5], boxes: leg() },
    { name: 'left_front_leg', pivot: [3.5, 10, -5], boxes: leg() },
  ];
}

/** TurtleModel.createBodyLayer (128×64) */
export function turtleMesh(): VPart[] {
  return [
    { name: 'head', pivot: [0, 19, -10], boxes: [b(3, 0, -3, -1, -3, 6, 5, 6)] },
    { name: 'body', pivot: [0, 11, -10], rot: [PI / 2, 0, 0], boxes: [b(7, 37, -9.5, 3, -10, 19, 20, 6), b(31, 1, -5.5, 3, -13, 11, 18, 3)] },
    { name: 'right_hind_leg', pivot: [-3.5, 22, 11], boxes: [b(1, 23, -2, 0, 0, 4, 1, 10)] },
    { name: 'left_hind_leg', pivot: [3.5, 22, 11], boxes: [b(1, 12, -2, 0, 0, 4, 1, 10)] },
    { name: 'right_front_leg', pivot: [-5, 21, -4], boxes: [b(27, 30, -13, 0, -2, 13, 1, 5)] },
    { name: 'left_front_leg', pivot: [5, 21, -4], boxes: [b(27, 24, 0, 0, -2, 13, 1, 5)] },
  ];
}

/** FoxModel.createBodyLayer (48×32) */
export function foxMesh(): VPart[] {
  const d = 0.001;
  return [
    {
      name: 'head', pivot: [-1, 16.5, -3], boxes: [b(1, 5, -3, -2, -5, 8, 6, 6)], children: [
        { name: 'right_ear', pivot: [0, 0, 0], boxes: [b(8, 1, -3, -4, -4, 2, 2, 1)] },
        { name: 'left_ear', pivot: [0, 0, 0], boxes: [b(15, 1, 3, -4, -4, 2, 2, 1)] },
        { name: 'nose', pivot: [0, 0, 0], boxes: [b(6, 18, -1, 2.01, -8, 4, 2, 3)] },
      ],
    },
    {
      name: 'body', pivot: [0, 16, -6], rot: [PI / 2, 0, 0], boxes: [b(24, 15, -3, 3.999, -3.5, 6, 11, 6)], children: [
        { name: 'tail', pivot: [-4, 15, -1], rot: [-0.05235988, 0, 0], boxes: [b(30, 0, 2, 0, -1, 4, 9, 5)] },
      ],
    },
    { name: 'right_hind_leg', pivot: [-5, 17.5, 7], boxes: [b(13, 24, 2, 0.5, -1, 2, 6, 2, d)] },
    { name: 'left_hind_leg', pivot: [-1, 17.5, 7], boxes: [b(4, 24, 2, 0.5, -1, 2, 6, 2, d)] },
    { name: 'right_front_leg', pivot: [-5, 17.5, 0], boxes: [b(13, 24, 2, 0.5, -1, 2, 6, 2, d)] },
    { name: 'left_front_leg', pivot: [-1, 17.5, 0], boxes: [b(4, 24, 2, 0.5, -1, 2, 6, 2, d)] },
  ];
}

// ------------------------------------------------------------------ animation helpers

const RAD = PI / 180;

/** AnimationUtils.bobModelPart */
function bobModelPart(p: VPose, age: number, scale: number): void {
  p.zRot += scale * (Math.cos(age * 0.09) * 0.05 + 0.05);
  p.xRot += scale * Math.sin(age * 0.067) * 0.05;
}

/** AnimationUtils.bobArms */
function bobArms(r: VPose, l: VPose, age: number): void {
  r.zRot += Math.cos(age * 0.09) * 0.05 + 0.05;
  l.zRot -= Math.cos(age * 0.09) * 0.05 + 0.05;
  r.xRot += Math.sin(age * 0.067) * 0.05;
  l.xRot -= Math.sin(age * 0.067) * 0.05;
}

/** HumanoidModel.setupAnim (standing pose, right-handed mob) with an optional right-arm pose. */
function humanoidAnim(p: Poses, a: MobAnim, rightArmPose: 'empty' | 'item' | 'bow' = 'empty'): void {
  const { head, hat, body, right_arm: ra, left_arm: la, right_leg: rl, left_leg: ll } = p as Record<string, VPose>;
  head!.yRot = a.netHeadYaw * RAD;
  head!.xRot = a.headPitch * RAD;
  body!.yRot = 0;
  ra!.z = 0;
  ra!.x = -5;
  la!.z = 0;
  la!.x = 5;
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  ra!.xRot = Math.cos(ls * 0.6662 + PI) * 2 * amt * 0.5;
  la!.xRot = Math.cos(ls * 0.6662) * 2 * amt * 0.5;
  ra!.zRot = 0;
  la!.zRot = 0;
  rl!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
  ll!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
  rl!.yRot = ll!.yRot = rl!.zRot = ll!.zRot = 0;
  ra!.yRot = 0;
  la!.yRot = 0;
  if (rightArmPose === 'item') ra!.xRot = ra!.xRot * 0.5 - PI / 10;
  else if (rightArmPose === 'bow') {
    ra!.yRot = -0.1 + head!.yRot;
    la!.yRot = 0.1 + head!.yRot + 0.4;
    ra!.xRot = -PI / 2 + head!.xRot;
    la!.xRot = -PI / 2 + head!.xRot;
  }
  // setupAttackAnimation (right arm)
  if (a.attackTime > 0) {
    let f = a.attackTime;
    body!.yRot = Math.sin(Math.sqrt(f) * PI * 2) * 0.2;
    ra!.z = Math.sin(body!.yRot) * 5;
    ra!.x = -Math.cos(body!.yRot) * 5;
    la!.z = -Math.sin(body!.yRot) * 5;
    la!.x = Math.cos(body!.yRot) * 5;
    ra!.yRot += body!.yRot;
    la!.yRot += body!.yRot;
    la!.xRot += body!.yRot;
    f = 1 - a.attackTime;
    f *= f;
    f *= f;
    f = 1 - f;
    const f1 = Math.sin(f * PI);
    const f2 = Math.sin(a.attackTime * PI) * -(head!.xRot - 0.7) * 0.75;
    ra!.xRot -= f1 * 1.2 + f2;
    ra!.yRot += body!.yRot * 2;
    ra!.zRot += Math.sin(a.attackTime * PI) * -0.4;
  }
  body!.xRot = 0;
  rl!.z = 0.1;
  ll!.z = 0.1;
  rl!.y = 12;
  ll!.y = 12;
  head!.y = 0;
  body!.y = 0;
  la!.y = 2;
  ra!.y = 2;
  bobModelPart(ra!, a.ageInTicks, 1);
  bobModelPart(la!, a.ageInTicks, -1);
  hat?.copyFrom(head!);
}

/** AnimationUtils.animateZombieArms */
function zombieArms(p: Poses, aggressive: boolean, attackTime: number, age: number): void {
  const ra = p.right_arm!, la = p.left_arm!;
  const f = Math.sin(attackTime * PI);
  const f1 = Math.sin((1 - (1 - attackTime) * (1 - attackTime)) * PI);
  ra.zRot = 0;
  la.zRot = 0;
  ra.yRot = -(0.1 - f * 0.6);
  la.yRot = 0.1 - f * 0.6;
  const f2 = -PI / (aggressive ? 1.5 : 2.25);
  ra.xRot = f2;
  la.xRot = f2;
  ra.xRot += f * 1.2 - f1 * 0.4;
  la.xRot += f * 1.2 - f1 * 0.4;
  bobArms(ra, la, age);
}

function quadrupedAnim(p: Poses, a: MobAnim): void {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  p.head!.xRot = a.headPitch * RAD;
  p.head!.yRot = a.netHeadYaw * RAD;
  p.right_hind_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
  p.left_hind_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
  p.right_front_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
  p.left_front_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
}

const aggressive = (a: MobAnim) => (a.mob.data.get('aggressive') ?? 0) !== 0;

// ------------------------------------------------------------------ models

const HUMANOID_BABY: BabyParams = { scaleHead: true, yHead: 16, zHead: 0, headScale: 2, bodyScale: 2, bodyY: 24 };

const zombieAnim = (p: Poses, a: MobAnim) => {
  humanoidAnim(p, a);
  zombieArms(p, aggressive(a), a.attackTime, a.ageInTicks);
};

/** SkeletonModel: bow pose while aggressive with a bow, zombie-like arms when fighting without one. */
const skeletonAnim = (p: Poses, a: MobAnim) => {
  const bow = (a.mob.data.get('bow') ?? 1) !== 0;
  const aggro = aggressive(a);
  humanoidAnim(p, a, bow && aggro ? 'bow' : 'empty');
  if (aggro && !bow) {
    const ra = p.right_arm!, la = p.left_arm!;
    const f = Math.sin(a.attackTime * PI);
    const f1 = Math.sin((1 - (1 - a.attackTime) * (1 - a.attackTime)) * PI);
    ra.zRot = 0;
    la.zRot = 0;
    ra.yRot = -(0.1 - f * 0.6);
    la.yRot = 0.1 - f * 0.6;
    ra.xRot = -PI / 2;
    la.xRot = -PI / 2;
    ra.xRot -= f * 1.2 - f1 * 0.4;
    la.xRot -= f * 1.2 - f1 * 0.4;
    bobArms(ra, la, a.ageInTicks);
  }
};

const creeperAnim = (p: Poses, a: MobAnim) => {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  p.head!.yRot = a.netHeadYaw * RAD;
  p.head!.xRot = a.headPitch * RAD;
  p.right_hind_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
  p.left_hind_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
  p.right_front_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
  p.left_front_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
};

/** SpiderModel.setupAnim: splayed legs, alternating quarter-phase swing pattern. */
const spiderAnim = (p: Poses, a: MobAnim) => {
  p.head!.yRot = a.netHeadYaw * RAD;
  p.head!.xRot = a.headPitch * RAD;
  const f = PI / 4;
  const legs = ['hind', 'middle_hind', 'middle_front', 'front'];
  const zr = [f, f * 0.74, f * 0.74, f];
  const yr = [PI / 4, PI / 8, -PI / 8, -PI / 4];
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  const phase = [0, PI, PI / 2, (PI * 3) / 2];
  for (let i = 0; i < 4; i++) {
    const r = p[`right_${legs[i]}_leg`]!, l = p[`left_${legs[i]}_leg`]!;
    const fy = -(Math.cos(ls * 0.6662 * 2 + phase[i]!) * 0.4) * amt;
    const fz = Math.abs(Math.sin(ls * 0.6662 + phase[i]!) * 0.4) * amt;
    r.zRot = -zr[i]! + fz;
    l.zRot = zr[i]! - fz;
    r.yRot = yr[i]! + fy;
    l.yRot = -yr[i]! - fy;
  }
};

/** SheepModel.prepareMobModel + setupAnim: the head lowers and nibbles while grazing. */
const sheepAnim = (p: Poses, a: MobAnim) => {
  quadrupedAnim(p, a);
  p.head!.y = 6 + a.mob.headEatPositionScale(a.partial) * 9;
  const ang = a.mob.headEatAngleScale(a.partial);
  if (ang !== null) p.head!.xRot = ang;
};

/** ChickenModel.setupAnim (ageInTicks is the wing bob from ChickenRenderer.getBob) */
const chickenAnim = (p: Poses, a: MobAnim) => {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  p.head!.xRot = a.headPitch * RAD;
  p.head!.yRot = a.netHeadYaw * RAD;
  p.beak!.xRot = p.red_thing!.xRot = p.head!.xRot;
  p.beak!.yRot = p.red_thing!.yRot = p.head!.yRot;
  p.right_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
  p.left_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
  const bob = a.mob.chickenBob(a.partial);
  p.right_wing!.zRot = bob;
  p.left_wing!.zRot = -bob;
};

/** EndermanModel.setupAnim: half-amplitude limb swing clamped to ±0.4, open jaw when creepy. */
const endermanAnim = (p: Poses, a: MobAnim) => {
  humanoidAnim(p, a);
  const { head, hat, body, right_arm: ra, left_arm: la, right_leg: rl, left_leg: ll } = p as Record<string, VPose>;
  body!.xRot = 0;
  body!.y = -14;
  body!.z = 0;
  for (const q of [ra!, la!, rl!, ll!]) {
    q.xRot *= 0.5;
    if (q.xRot > 0.4) q.xRot = 0.4;
    if (q.xRot < -0.4) q.xRot = -0.4;
  }
  if ((a.mob.data.get('carried') ?? 0) > 0) {
    ra!.xRot = -0.5;
    la!.xRot = -0.5;
    ra!.zRot = 0.05;
    la!.zRot = -0.05;
  }
  ra!.z = la!.z = rl!.z = ll!.z = 0;
  rl!.y = -5;
  ll!.y = -5;
  head!.z = 0;
  head!.y = -13;
  hat!.copyFrom(head!);
  if (aggressive(a)) head!.y -= 5;
  ra!.setPos(-5, -12, 0);
  la!.setPos(5, -12, 0);
};

/** BatModel.setupAnim: hanging upside down or flapping. */
const batAnim = (p: Poses, a: MobAnim) => {
  const { head, body, right_wing: rw, left_wing: lw, right_wing_tip: rt, left_wing_tip: lt } = p as Record<string, VPose>;
  if ((a.mob.data.get('hanging') ?? 0) !== 0) {
    head!.xRot = a.headPitch * RAD;
    head!.yRot = PI - a.netHeadYaw * RAD;
    head!.zRot = PI;
    head!.setPos(0, -2, 0);
    rw!.setPos(-3, 0, 3);
    lw!.setPos(3, 0, 3);
    body!.xRot = PI;
    rw!.xRot = -PI * 0.05;
    rw!.yRot = -PI * 0.4;
    rt!.yRot = -PI * 0.55;
    lw!.xRot = rw!.xRot;
    lw!.yRot = -rw!.yRot;
    lt!.yRot = -rt!.yRot;
  } else {
    head!.xRot = a.headPitch * RAD;
    head!.yRot = a.netHeadYaw * RAD;
    head!.zRot = 0;
    head!.setPos(0, 0, 0);
    rw!.setPos(0, 0, 0);
    lw!.setPos(0, 0, 0);
    body!.xRot = PI / 4 + Math.cos(a.ageInTicks * 0.1) * 0.15;
    body!.yRot = 0;
    rw!.yRot = Math.cos(a.ageInTicks * 1.3) * PI * 0.25;
    lw!.yRot = -rw!.yRot;
    rt!.yRot = rw!.yRot * 0.5;
    lt!.yRot = -rw!.yRot * 0.5;
  }
};

/** SquidModel.setupAnim: every tentacle bends by the tentacle angle. */
const squidAnim = (p: Poses, a: MobAnim) => {
  const ang = a.mob.tentacleAngleO + (a.mob.tentacleAngle - a.mob.tentacleAngleO) * a.partial;
  for (let j = 0; j < 8; j++) p[`tentacle${j}`]!.xRot = ang;
};

/** VillagerModel.setupAnim: head look, half-amplitude leg swing, arms stay folded. */
const villagerAnim = (p: Poses, a: MobAnim) => {
  p.head!.yRot = a.netHeadYaw * RAD;
  p.head!.xRot = a.headPitch * RAD;
  p.right_leg!.xRot = Math.cos(a.limbSwing * 0.6662) * 1.4 * a.limbSwingAmount * 0.5;
  p.left_leg!.xRot = Math.cos(a.limbSwing * 0.6662 + PI) * 1.4 * a.limbSwingAmount * 0.5;
  p.right_leg!.yRot = 0;
  p.left_leg!.yRot = 0;
};

/** Mth.triangleWave */
function triangleWave(f: number, g: number): number {
  return (Math.abs((((f % g) + g) % g) - g * 0.5) - g * 0.25) / (g * 0.25);
}

/** IronGolemModel.prepareMobModel + setupAnim: stiff-legged walk, arms swing or slam. */
const ironGolemAnim = (p: Poses, a: MobAnim) => {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  p.head!.yRot = a.netHeadYaw * RAD;
  p.head!.xRot = a.headPitch * RAD;
  p.right_leg!.xRot = -1.5 * triangleWave(ls, 13) * amt;
  p.left_leg!.xRot = 1.5 * triangleWave(ls, 13) * amt;
  const t = a.mob.attackAnimationTick;
  if (t > 0) {
    p.right_arm!.xRot = -2 + 1.5 * triangleWave(t - a.partial, 10);
    p.left_arm!.xRot = -2 + 1.5 * triangleWave(t - a.partial, 10);
  } else {
    p.right_arm!.xRot = (-0.2 + 1.5 * triangleWave(ls, 13)) * amt;
    p.left_arm!.xRot = (-0.2 - 1.5 * triangleWave(ls, 13)) * amt;
  }
};

/** WolfModel.prepareMobModel + setupAnim: trot, tail angle by mood, sitting pose. */
const wolfAnim = (p: Poses, a: MobAnim) => {
  const m = a.mob, ls = a.limbSwing, amt = a.limbSwingAmount;
  const tail = (m.data.get('aggressive') ?? 0) ? 1.5393804 : (m.data.get('tame') ?? 0) ? (0.55 - (20 - (m.data.get('health') ?? 20)) * 0.02) * PI : PI / 5;
  if ((m.data.get('sitting') ?? 0) !== 0) {
    p.upper_body!.setPos(-1, 16, -3);
    p.upper_body!.xRot = (PI * 2) / 5;
    p.body!.setPos(0, 18, 0);
    p.body!.xRot = PI / 4;
    p.tail!.setPos(-1, 21, 6);
    p.right_hind_leg!.setPos(-2.5, 22.7, 2);
    p.right_hind_leg!.xRot = (PI * 3) / 2;
    p.left_hind_leg!.setPos(0.5, 22.7, 2);
    p.left_hind_leg!.xRot = (PI * 3) / 2;
    p.right_front_leg!.xRot = 5.811947;
    p.right_front_leg!.setPos(-2.49, 17, -4);
    p.left_front_leg!.xRot = 5.811947;
    p.left_front_leg!.setPos(0.51, 17, -4);
  } else {
    p.right_hind_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
    p.left_hind_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
    p.right_front_leg!.xRot = Math.cos(ls * 0.6662 + PI) * 1.4 * amt;
    p.left_front_leg!.xRot = Math.cos(ls * 0.6662) * 1.4 * amt;
  }
  p.head!.xRot = a.headPitch * RAD;
  p.head!.yRot = a.netHeadYaw * RAD;
  p.tail!.xRot = tail;
};

/** PhantomModel.setupAnim: slow wing beats and a swishing tail. */
const phantomAnim = (p: Poses, a: MobAnim) => {
  const f = (a.mob.id * 3 + a.ageInTicks) * 0.13;
  const w = Math.cos(f) * 16 * RAD;
  p.left_wing_base!.zRot = w;
  p.left_wing_tip!.zRot = w;
  p.right_wing_base!.zRot = -w;
  p.right_wing_tip!.zRot = -w;
  p.tail_base!.xRot = -(5 + Math.cos(f * 2) * 5) * RAD;
  p.tail_tip!.xRot = -(5 + Math.cos(f * 2) * 5) * RAD;
};

/** IllagerModel.setupAnim: arms crossed when calm; raised weapon arms or a crossbow hold when hostile. */
const illagerAnim = (p: Poses, a: MobAnim) => {
  const head = p.head!, ra = p.right_arm!, la = p.left_arm!;
  head.yRot = a.netHeadYaw * RAD;
  head.xRot = a.headPitch * RAD;
  p.right_leg!.xRot = Math.cos(a.limbSwing * 0.6662) * 1.4 * a.limbSwingAmount * 0.5;
  p.left_leg!.xRot = Math.cos(a.limbSwing * 0.6662 + PI) * 1.4 * a.limbSwingAmount * 0.5;
  const hostile = aggressive(a);
  p.arms!.visible = !hostile;
  ra.visible = la.visible = hostile;
  if (!hostile) return;
  if (a.mob.type === 'pillager') {
    // AnimationUtils.animateCrossbowHold
    ra.yRot = -0.3 + head.yRot;
    la.yRot = 0.6 + head.yRot;
    ra.xRot = -PI / 2 + head.xRot + 0.1;
    la.xRot = -1.5 + head.xRot;
  } else {
    // swinging a weapon (vindicator axe) or casting (evoker): arms raised like a zombie's
    zombieArms(p, true, a.attackTime, a.ageInTicks);
  }
};

/** CodModel.setupAnim: the tail beats faster out of water. */
const codAnim = (p: Poses, a: MobAnim) => {
  const f = a.mob.inWater ? 1 : 1.5;
  p.tail_fin!.yRot = -f * 0.45 * Math.sin(0.6 * a.ageInTicks);
};

/** SalmonModel.setupAnim: the back half of the body swings. */
const salmonAnim = (p: Poses, a: MobAnim) => {
  const w = a.mob.inWater;
  p.body_back!.yRot = -(w ? 1 : 1.3) * 0.25 * Math.sin((w ? 1 : 1.7) * 0.6 * a.ageInTicks);
};

/** HorseModel.prepareMobModel (walking subset): head look, diagonal-pair stride, swishing tail. */
const horseAnim = (p: Poses, a: MobAnim) => {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  const yaw = Math.max(-20, Math.min(20, a.netHeadYaw));
  p.head_parts!.yRot = yaw * RAD;
  p.head_parts!.xRot = PI / 6 + a.headPitch * RAD;
  const f = Math.cos(ls * 0.6662 + PI) * 0.8 * amt;
  p.left_hind_leg!.xRot = -f;
  p.right_hind_leg!.xRot = f;
  p.left_front_leg!.xRot = f;
  p.right_front_leg!.xRot = -f;
  p.tail!.xRot = PI / 6 + amt * 0.75;
  p.tail!.y = 4 - amt;
  p.tail!.z = 11 + amt * 2;
};

/** OcelotModel.setupAnim (walking): offset leg phases and a curling tail. */
const felineAnim = (p: Poses, a: MobAnim) => {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  p.head!.xRot = a.headPitch * RAD;
  p.head!.yRot = a.netHeadYaw * RAD;
  if ((a.mob.data.get('sitting') ?? 0) !== 0) {
    // OcelotModel sitting pose (CatModel.prepareMobModel)
    p.body!.xRot = PI / 4;
    p.body!.y += -4;
    p.body!.z += 5;
    p.head!.y += -3.3;
    p.head!.z += 1;
    p.tail1!.y += 8;
    p.tail1!.z += -2;
    p.tail2!.y += 2;
    p.tail2!.z += -0.8;
    p.tail1!.xRot = 1.7278761;
    p.tail2!.xRot = 2.670354;
    p.left_front_leg!.xRot = -0.15707964;
    p.left_front_leg!.y = 16.1;
    p.left_front_leg!.z = -7;
    p.right_front_leg!.xRot = -0.15707964;
    p.right_front_leg!.y = 16.1;
    p.right_front_leg!.z = -7;
    p.left_hind_leg!.xRot = -PI / 2;
    p.left_hind_leg!.y = 21;
    p.left_hind_leg!.z = 1;
    p.right_hind_leg!.xRot = -PI / 2;
    p.right_hind_leg!.y = 21;
    p.right_hind_leg!.z = 1;
    return;
  }
  p.left_hind_leg!.xRot = Math.cos(ls * 0.6662) * amt;
  p.right_hind_leg!.xRot = Math.cos(ls * 0.6662 + 0.3) * amt;
  p.left_front_leg!.xRot = Math.cos(ls * 0.6662 + PI + 0.3) * amt;
  p.right_front_leg!.xRot = Math.cos(ls * 0.6662 + PI) * amt;
  p.tail2!.xRot = 1.7278761 + (PI / 4) * Math.cos(ls) * amt;
};

/** SnowGolemModel.setupAnim: the upper body turns a quarter of the head yaw, arms follow it. */
const snowGolemAnim = (p: Poses, a: MobAnim) => {
  p.head!.yRot = a.netHeadYaw * RAD;
  p.head!.xRot = a.headPitch * RAD;
  const ub = p.upper_body!;
  ub.yRot = a.netHeadYaw * RAD * 0.25;
  const f = Math.sin(ub.yRot), f1 = Math.cos(ub.yRot);
  p.left_arm!.yRot = ub.yRot;
  p.right_arm!.yRot = ub.yRot + PI;
  p.left_arm!.x = f1 * 5;
  p.left_arm!.z = -f * 5;
  p.right_arm!.x = -f1 * 5;
  p.right_arm!.z = f * 5;
};

/** SilverfishModel / EndermiteModel.setupAnim: a travelling wiggle along the segments. */
const segmentedAnim = (yAmp: number, xAmp: number) => (p: Poses, a: MobAnim) => {
  for (let i = 0; p[`segment${i}`]; i++) {
    const s = p[`segment${i}`]!;
    s.yRot = Math.cos(a.ageInTicks * 0.9 + i * 0.15 * PI) * PI * yAmp * (1 + Math.abs(i - 2));
    s.x = Math.sin(a.ageInTicks * 0.9 + i * 0.15 * PI) * PI * xAmp * Math.abs(i - 2);
  }
  if (p.layer0) {
    p.layer0.yRot = p.segment2!.yRot;
    p.layer1!.yRot = p.segment4!.yRot;
    p.layer1!.x = p.segment4!.x;
    p.layer2!.yRot = p.segment1!.yRot;
    p.layer2!.x = p.segment1!.x;
  }
};

/** BeeModel.setupAnim: wings buzz and the body bobs while flying; folded wings when landed. */
const beeAnim = (p: Poses, a: MobAnim) => {
  const rw = p.right_wing!, lw = p.left_wing!, bone = p.bone!;
  const landed = a.mob.onGround && a.limbSwingAmount < 0.01;
  if (!landed) {
    rw.yRot = 0;
    rw.zRot = Math.cos(a.ageInTicks * 120.32113 * RAD) * PI * 0.15;
    lw.xRot = rw.xRot;
    lw.yRot = rw.yRot;
    lw.zRot = -rw.zRot;
    p.front_legs!.xRot = PI / 4;
    p.middle_legs!.xRot = PI / 4;
    p.back_legs!.xRot = PI / 4;
    const f1 = Math.cos(a.ageInTicks * 0.18);
    bone.xRot = 0.1 + f1 * PI * 0.025;
    p.left_antenna!.xRot = f1 * PI * 0.03;
    p.right_antenna!.xRot = f1 * PI * 0.03;
    p.front_legs!.xRot = -f1 * PI * 0.1 + PI / 8;
    p.back_legs!.xRot = -f1 * PI * 0.05 + PI / 4;
    bone.y = 19 - f1 * 0.9;
  }
};

/** RabbitModel.setupAnim: head look and the hop (jump completion drives haunches and feet). */
const rabbitAnim = (p: Poses, a: MobAnim) => {
  const pitch = a.headPitch * RAD, yaw = a.netHeadYaw * RAD;
  p.nose!.xRot = p.head!.xRot = p.right_ear!.xRot = p.left_ear!.xRot = pitch;
  p.nose!.yRot = p.head!.yRot = yaw;
  p.right_ear!.yRot = yaw - 0.2617994;
  p.left_ear!.yRot = yaw + 0.2617994;
  const j = Math.sin(a.mob.jumpCompletion(a.partial) * PI);
  p.left_haunch!.xRot = p.right_haunch!.xRot = (j * 50 - 21) * RAD;
  p.left_hind_foot!.xRot = p.right_hind_foot!.xRot = j * 50 * RAD;
  p.left_front_leg!.xRot = p.right_front_leg!.xRot = (j * -40 - 11) * RAD;
};

/** TurtleModel.setupAnim (on land): slow paddling of the flippers. */
const turtleAnim = (p: Poses, a: MobAnim) => {
  const ls = a.limbSwing, amt = a.limbSwingAmount;
  p.head!.xRot = a.headPitch * RAD;
  p.head!.yRot = a.netHeadYaw * RAD;
  p.right_hind_leg!.xRot = Math.cos(ls * 0.6662 * 0.6) * 0.5 * amt;
  p.left_hind_leg!.xRot = Math.cos(ls * 0.6662 * 0.6 + PI) * 0.5 * amt;
  p.right_front_leg!.zRot = -Math.cos(ls * 0.6662 * 0.6 + PI) * 0.5 * amt;
  p.left_front_leg!.zRot = Math.cos(ls * 0.6662 * 0.6) * 0.5 * amt;
};

const none = () => {};

export const MOB_MODELS: Record<string, MobModelDef> = {
  zombie: { tex: [64, 64], parts: humanoidMesh(), headParts: ['head', 'hat'], baby: HUMANOID_BABY, anim: zombieAnim },
  drowned: { tex: [64, 64], parts: humanoidMesh(0, 0, true), headParts: ['head', 'hat'], baby: HUMANOID_BABY, anim: zombieAnim },
  skeleton: { tex: [64, 32], parts: skeletonMesh(), headParts: ['head', 'hat'], baby: HUMANOID_BABY, anim: skeletonAnim },
  /** the stray's ragged clothing layer (HumanoidModel.createMesh(0.25)) */
  stray_overlay: { tex: [64, 32], parts: humanoidMesh(0.25), headParts: ['head', 'hat'], baby: HUMANOID_BABY, anim: skeletonAnim },
  creeper: { tex: [64, 32], parts: creeperMesh(), anim: creeperAnim },
  spider: { tex: [64, 32], parts: spiderMesh(), anim: spiderAnim },
  pig: { tex: [64, 32], parts: pigMesh(), headParts: ['head'], baby: { scaleHead: false, yHead: 4, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: quadrupedAnim },
  pig_saddle: { tex: [64, 32], parts: pigMesh(0.5), headParts: ['head'], baby: { scaleHead: false, yHead: 4, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: quadrupedAnim },
  cow: { tex: [64, 32], parts: cowMesh(), headParts: ['head'], baby: { scaleHead: false, yHead: 10, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: quadrupedAnim },
  sheep: { tex: [64, 32], parts: sheepMesh(), headParts: ['head'], baby: { scaleHead: false, yHead: 8, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: sheepAnim },
  sheep_fur: { tex: [64, 32], parts: sheepFurMesh(), headParts: ['head'], baby: { scaleHead: false, yHead: 8, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: sheepAnim },
  chicken: { tex: [64, 32], parts: chickenMesh(), headParts: ['head', 'beak', 'red_thing'], baby: { scaleHead: false, yHead: 5, zHead: 2, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: chickenAnim },
  enderman: { tex: [64, 32], parts: endermanMesh(), anim: endermanAnim },
  slime: { tex: [64, 32], parts: slimeInnerMesh(), anim: none },
  slime_outer: { tex: [64, 32], parts: slimeOuterMesh(), anim: none },
  bat: { tex: [64, 64], parts: batMesh(), anim: batAnim },
  squid: { tex: [64, 32], parts: squidMesh(), anim: squidAnim },
  creeper_charged: { tex: [64, 32], parts: creeperMesh(2), anim: creeperAnim },
  villager: { tex: [64, 64], parts: villagerMesh(), anim: villagerAnim },
  witch: { tex: [64, 128], parts: witchMesh(), headParts: ['head'], anim: villagerAnim },
  zombie_villager: { tex: [64, 64], parts: zombieVillagerMesh(), headParts: ['head', 'hat'], baby: HUMANOID_BABY, anim: zombieAnim },
  iron_golem: { tex: [128, 128], parts: ironGolemMesh(), anim: ironGolemAnim },
  wolf: { tex: [64, 32], parts: wolfMesh(), headParts: ['head'], baby: { scaleHead: false, yHead: 5, zHead: 2, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: wolfAnim },
  phantom: { tex: [64, 64], parts: phantomMesh(), anim: phantomAnim },
  illager: { tex: [64, 64], parts: illagerMesh(), anim: illagerAnim },
  cod: { tex: [32, 32], parts: codMesh(), anim: codAnim },
  salmon: { tex: [32, 32], parts: salmonMesh(), anim: salmonAnim },
  horse: { tex: [64, 64], parts: horseMesh(), anim: horseAnim },
  donkey: { tex: [64, 64], parts: horseMesh(true), anim: horseAnim },
  feline: { tex: [64, 32], parts: felineMesh(), headParts: ['head'], baby: { scaleHead: true, yHead: 10, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: felineAnim },
  polar_bear: { tex: [128, 64], parts: polarBearMesh(), headParts: ['head'], baby: { scaleHead: true, yHead: 16, zHead: 4, headScale: 2.25, bodyScale: 2, bodyY: 24 }, anim: quadrupedAnim },
  snow_golem: { tex: [64, 64], parts: snowGolemMesh(), anim: snowGolemAnim },
  silverfish: { tex: [64, 32], parts: segmentedMesh(SILVERFISH_SIZES, SILVERFISH_TEXS, true), anim: segmentedAnim(0.05, 0.2) },
  endermite: { tex: [64, 32], parts: segmentedMesh(ENDERMITE_SIZES, ENDERMITE_TEXS, false), anim: segmentedAnim(0.01, 0.1) },
  bee: { tex: [64, 64], parts: beeMesh(), headParts: [], baby: { scaleHead: false, yHead: 24, zHead: 0, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: beeAnim },
  rabbit: { tex: [64, 32], parts: rabbitMesh(), anim: rabbitAnim },
  llama: { tex: [128, 64], parts: llamaMesh(), headParts: ['head'], baby: { scaleHead: false, yHead: 10, zHead: 4, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: quadrupedAnim },
  turtle: { tex: [128, 64], parts: turtleMesh(), headParts: ['head'], baby: { scaleHead: true, yHead: 120, zHead: 0, headScale: 9, bodyScale: 6, bodyY: 120 }, anim: turtleAnim },
  fox: { tex: [48, 32], parts: foxMesh(), headParts: ['head'], baby: { scaleHead: true, yHead: 8, zHead: 3.35, headScale: 2, bodyScale: 2, bodyY: 24 }, anim: quadrupedAnim },
  unknown: { tex: [64, 32], parts: [{ name: 'box', pivot: [0, 0, 0], boxes: [b(0, 0, -8, 8, -8, 16, 16, 16)] }], anim: none },
};

/** How each mob type is drawn: base model + texture, extra layers, render scale. */
export interface MobLayer {
  model: string;
  texture: string;
  /** when the layer is drawn */
  when?: (m: ClientMob) => boolean;
  /** RGB multiplier (sheep wool colour) */
  color?: (m: ClientMob) => [number, number, number];
  /** full-bright additive eyes (RenderType.eyes) */
  emissive?: boolean;
  /** translucent (slime outer body) */
  translucent?: boolean;
  /** scrolling repeat texture (charged creeper energy swirl; drawn additively) */
  scroll?: boolean;
}

export interface MobRenderDef {
  layers: MobLayer[];
  /** MobRenderer.scale */
  scale?: number;
  /** whole-model scale for babies (villagers shrink uniformly instead of using AgeableListModel) */
  babyScale?: number;
}

export const MOB_RENDER: Record<string, MobRenderDef> = {
  zombie: { layers: [{ model: 'zombie', texture: 'zombie' }] },
  husk: { layers: [{ model: 'zombie', texture: 'husk' }], scale: 1.0625 },
  drowned: { layers: [{ model: 'drowned', texture: 'drowned' }] },
  skeleton: { layers: [{ model: 'skeleton', texture: 'skeleton' }] },
  stray: { layers: [{ model: 'skeleton', texture: 'stray' }, { model: 'stray_overlay', texture: 'stray_overlay' }] },
  wither_skeleton: { layers: [{ model: 'skeleton', texture: 'wither_skeleton' }], scale: 1.2 },
  creeper: {
    layers: [
      { model: 'creeper', texture: 'creeper' },
      { model: 'creeper_charged', texture: 'creeper_armor', when: (m) => (m.data.get('charged') ?? 0) !== 0, emissive: true, scroll: true, color: () => [0.5, 0.5, 0.5] },
    ],
  },
  spider: { layers: [{ model: 'spider', texture: 'spider' }, { model: 'spider', texture: 'spider_eyes', emissive: true }] },
  cave_spider: { layers: [{ model: 'spider', texture: 'cave_spider' }, { model: 'spider', texture: 'spider_eyes', emissive: true }], scale: 0.7 },
  pig: { layers: [{ model: 'pig', texture: 'pig' }, { model: 'pig_saddle', texture: 'pig_saddle', when: (m) => (m.data.get('saddle') ?? 0) !== 0 }] },
  cow: { layers: [{ model: 'cow', texture: 'cow' }] },
  sheep: {
    layers: [
      { model: 'sheep', texture: 'sheep' },
      { model: 'sheep_fur', texture: 'sheep_fur', when: (m) => !(m.data.get('sheared') ?? 0), color: (m) => sheepColorOf(m) },
    ],
  },
  chicken: { layers: [{ model: 'chicken', texture: 'chicken' }] },
  enderman: { layers: [{ model: 'enderman', texture: 'enderman' }, { model: 'enderman', texture: 'enderman_eyes', emissive: true }] },
  slime: { layers: [{ model: 'slime', texture: 'slime' }, { model: 'slime_outer', texture: 'slime', translucent: true }], scale: 0.999 },
  bat: { layers: [{ model: 'bat', texture: 'bat' }], scale: 0.35 },
  squid: { layers: [{ model: 'squid', texture: 'squid' }] },
  glow_squid: { layers: [{ model: 'squid', texture: 'glow_squid' }, { model: 'squid', texture: 'glow_squid', emissive: true, color: () => [0.35, 0.35, 0.35] }] },
  villager: { layers: [{ model: 'villager', texture: 'villager' }], scale: 0.9375, babyScale: 0.5 },
  wandering_trader: { layers: [{ model: 'villager', texture: 'wandering_trader' }], scale: 0.9375 },
  witch: { layers: [{ model: 'witch', texture: 'witch' }], scale: 0.9375 },
  zombie_villager: { layers: [{ model: 'zombie_villager', texture: 'zombie_villager' }] },
  mooshroom: { layers: [{ model: 'cow', texture: 'mooshroom' }] },
  iron_golem: { layers: [{ model: 'iron_golem', texture: 'iron_golem' }] },
  wolf: { layers: [{ model: 'wolf', texture: 'wolf' }] },
  phantom: { layers: [{ model: 'phantom', texture: 'phantom' }, { model: 'phantom', texture: 'phantom_eyes', emissive: true }] },
  pillager: { layers: [{ model: 'illager', texture: 'pillager' }], scale: 0.9375 },
  vindicator: { layers: [{ model: 'illager', texture: 'vindicator' }], scale: 0.9375 },
  evoker: { layers: [{ model: 'illager', texture: 'evoker' }], scale: 0.9375 },
  cod: { layers: [{ model: 'cod', texture: 'cod' }] },
  salmon: { layers: [{ model: 'salmon', texture: 'salmon' }] },
  horse: { layers: [{ model: 'horse', texture: 'horse' }], scale: 1.1, babyScale: 0.5 },
  skeleton_horse: { layers: [{ model: 'horse', texture: 'skeleton_horse' }], scale: 1.1, babyScale: 0.5 },
  zombie_horse: { layers: [{ model: 'horse', texture: 'zombie_horse' }], scale: 1.1, babyScale: 0.5 },
  donkey: { layers: [{ model: 'donkey', texture: 'donkey' }], scale: 0.87, babyScale: 0.5 },
  mule: { layers: [{ model: 'donkey', texture: 'mule' }], scale: 0.92, babyScale: 0.5 },
  cat: { layers: [{ model: 'feline', texture: 'cat' }], scale: 0.8 },
  ocelot: { layers: [{ model: 'feline', texture: 'ocelot' }] },
  polar_bear: { layers: [{ model: 'polar_bear', texture: 'polar_bear' }], scale: 1.2 },
  snow_golem: { layers: [{ model: 'snow_golem', texture: 'snow_golem' }] },
  silverfish: { layers: [{ model: 'silverfish', texture: 'silverfish' }] },
  endermite: { layers: [{ model: 'endermite', texture: 'endermite' }] },
  bee: { layers: [{ model: 'bee', texture: 'bee' }] },
  rabbit: { layers: [{ model: 'rabbit', texture: 'rabbit' }] },
  llama: { layers: [{ model: 'llama', texture: 'llama' }], scale: 0.8 },
  trader_llama: { layers: [{ model: 'llama', texture: 'trader_llama' }], scale: 0.8 },
  turtle: { layers: [{ model: 'turtle', texture: 'turtle' }] },
  fox: { layers: [{ model: 'fox', texture: 'fox' }] },
  /** fallback for mobs without a model: a hit-box-sized box */
  unknown: { layers: [{ model: 'unknown', texture: 'unknown' }] },
};

/** Textures sampled with repeat wrapping (scrolling layers). */
export const MOB_SCROLLING = new Set(['creeper_armor']);

const sheepColorOf = (m: ClientMob): [number, number, number] => sheepColor(m.data.get('color') ?? 0);

/** Every entity texture the mob renderer loads. */
export const MOB_TEXTURES = [...new Set(Object.values(MOB_RENDER).flatMap((r) => r.layers.map((l) => l.texture)))];
