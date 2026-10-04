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
        const start = out.length;
        emitBox(out, mb, tw, th);
        for (let i = start; i < out.length; i += FLOATS_PER_VERTEX) {
          out[i + 1] = -out[i + 1]!;
          out[i + 2] = -out[i + 2]!;
          out[i + 6] = -out[i + 6]!;
          out[i + 7] = -out[i + 7]!;
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
  /** fallback for mobs without a model: a hit-box-sized box */
  unknown: { layers: [{ model: 'unknown', texture: 'unknown' }] },
};

/** Textures sampled with repeat wrapping (scrolling layers). */
export const MOB_SCROLLING = new Set(['creeper_armor']);

const sheepColorOf = (m: ClientMob): [number, number, number] => sheepColor(m.data.get('color') ?? 0);

/** Every entity texture the mob renderer loads. */
export const MOB_TEXTURES = [...new Set(Object.values(MOB_RENDER).flatMap((r) => r.layers.map((l) => l.texture)))];
