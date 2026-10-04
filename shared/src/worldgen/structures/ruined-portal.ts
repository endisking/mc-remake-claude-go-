/**
 * Ruined portals (vanilla 1.17.1 RuinedPortalFeature + RuinedPortalPiece): per biome portal type
 * the vertical placement, air pocket, mossiness, overgrowth and vines; 5% giant portals; the
 * height search (three of four corners in ground), the rule processors (gold → air 30%,
 * netherrack → magma 7%, lava → magma on the ocean floor), netherrack spreading with drip columns,
 * vines and leaves. The portal shapes are our own (10 regular, 3 giant).
 */
import type { JavaRandom } from '../../util/random';
import { IS_AIR, FLUID } from '../../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION } from '../../world/blockprops';
import { blockNameOf } from '../../world/blockstate';
import { S, type Piece, type PlaceContext } from './piece';
import { Model, TemplatePiece, VOID, positionRandom } from './template';
import type { StartContext } from './placement';

type Placement = 'ON_LAND_SURFACE' | 'PARTLY_BURIED' | 'ON_OCEAN_FLOOR' | 'IN_MOUNTAIN' | 'UNDERGROUND';
interface Props { placement: Placement; airPocket: boolean; mossiness: number; overgrown: boolean; vines: boolean; cold: boolean }

/** Portal designs: frame inner width/height, broken frame pattern, extras. */
function buildPortal(design: number, giant: boolean, airPocket: boolean): Model {
  const iw = giant ? 4 + (design % 2) : 2 + (design % 2);
  const ih = giant ? 7 + design : 3 + ((design >> 1) % 2);
  const pad = giant ? 3 : 2;
  const sx = iw + 2 + pad * 2, sy = ih + 3, sz = giant ? 7 : 5;
  const m = new Model(sx, sy, sz);
  const obsidian = S('obsidian'), crying = S('crying_obsidian'), rack = S('netherrack'), gold = S('gold_block');
  const fz = sz >> 1;
  const fx0 = pad, fx1 = pad + iw + 1;
  if (airPocket) m.fill(0, 1, 0, sx - 1, sy - 1, sz - 1, S('air'));
  // netherrack and stone-brick base under the frame
  for (let x = 0; x < sx; x++)
    for (let z = 0; z < sz; z++) {
      const d = Math.abs(x - (sx - 1) / 2) / (sx / 2) + Math.abs(z - fz) / (sz / 2 + 0.5);
      if (d < 1.05) m.set(x, 0, z, positionRandom(x, design, z).nextInt(5) === 0 ? S('stone_bricks') : rack);
    }
  // the frame (y 1 .. ih + 2), broken in places
  const rnd = (x: number, y: number) => positionRandom(x * 3 + design * 101, y + (giant ? 50 : 0), fz).nextInt(100);
  for (let y = 1; y <= ih + 2; y++)
    for (let x = fx0; x <= fx1; x++) {
      const edge = y === 1 || y === ih + 2 || x === fx0 || x === fx1;
      if (!edge) continue;
      const k = rnd(x, y);
      // the upper part is missing more often
      const threshold = (y > (ih + 2) * 0.6 ? 25 : 6) + design;
      const missing = k < threshold;
      if (missing) {
        // the fallen block lies at the foot of the frame
        if (k % 3 === 0) m.set(x, 1, fz + (k % 2 ? 1 : -1), k % 5 === 0 ? crying : obsidian);
        continue;
      }
      m.set(x, y, fz, k % 7 === 0 ? crying : obsidian);
    }
  // netherrack scattered on the frame's foot and a gold block
  m.set(fx0 - 1, 1, fz, rack);
  m.set(fx1 + 1, 1, fz + 1, rack);
  if (design % 3 === 0) m.set(fx1 + 1, 1, fz - 1, gold);
  // the chest beside the portal
  m.chest(fx0 - 1, 1, fz + 1, 'chests/ruined_portal', S('chest[facing=south]'));
  if (design % 4 === 1) m.set(fx1, 1, fz - 1, S('lava'));
  return m;
}

const PORTALS = Array.from({ length: 10 }, (_, i) => i);
const GIANTS = [0, 1, 2];

function propsFor(type: string, r: JavaRandom): Props {
  const p: Props = { placement: 'ON_LAND_SURFACE', airPocket: false, mossiness: 0.2, overgrown: false, vines: false, cold: false };
  switch (type) {
    case 'desert': p.placement = 'PARTLY_BURIED'; p.mossiness = 0; break;
    case 'jungle': p.airPocket = r.nextFloat() < 0.5; p.mossiness = 0.8; p.overgrown = true; p.vines = true; break;
    case 'swamp': p.placement = 'ON_OCEAN_FLOOR'; p.mossiness = 0.5; p.vines = true; break;
    case 'mountain': {
      const b = r.nextFloat() < 0.5;
      p.placement = b ? 'IN_MOUNTAIN' : 'ON_LAND_SURFACE';
      p.airPocket = b || r.nextFloat() < 0.5;
      break;
    }
    case 'ocean': p.placement = 'ON_OCEAN_FLOOR'; p.mossiness = 0.8; break;
    default: {
      const b = r.nextFloat() < 0.5;
      p.placement = b ? 'UNDERGROUND' : 'ON_LAND_SURFACE';
      p.airPocket = b || r.nextFloat() < 0.5;
    }
  }
  return p;
}

const opaqueOcean = (s: number) => MATERIAL_BLOCKS_MOTION[s] === 1;
const opaqueSurface = (s: number) => IS_AIR[s] !== 1;

class RuinedPortalPiece extends TemplatePiece {
  constructor(model: Model, x: number, z: number, rot: number, readonly props: Props, readonly u: number) {
    super(model, x, 90, z, rot, null, null);
  }

  private heightType(): 'OCEAN_FLOOR_WG' | 'WORLD_SURFACE_WG' {
    return this.props.placement === 'ON_OCEAN_FLOOR' ? 'OCEAN_FLOOR_WG' : 'WORLD_SURFACE_WG';
  }

  /** RuinedPortalFeature.findSuitableY */
  private findY(c: PlaceContext): number {
    const b = this.box, h = b.ySpan;
    const surface = c.lv.getHeight(this.heightType(), b.centerX, b.centerZ) - 1;
    const k = 15;
    const between = (lo: number, hi: number) => (hi < lo ? lo : lo + Math.floor(this.u * (hi - lo + 1)));
    let l: number;
    switch (this.props.placement) {
      case 'IN_MOUNTAIN': l = surface - h < 70 ? surface - h : between(70, surface - h); break;
      case 'UNDERGROUND': l = between(k, surface - h); break;
      case 'PARTLY_BURIED': l = surface - h + between(2, 8); break;
      default: l = surface;
    }
    const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]] as const;
    const opaque = this.props.placement === 'ON_OCEAN_FLOOR' ? opaqueOcean : opaqueSurface;
    let m: number;
    for (m = l; m > k; m--) {
      let n = 0;
      for (const [x, z] of corners) if (c.lv.world.isLoaded(x, z) && opaque(c.lv.getState(x, m, z)) && ++n === 3) return m;
    }
    return m;
  }

  private placedOnce = false;
  override postProcess(c: PlaceContext): boolean {
    // vanilla places the whole portal when the chunk holding its centre is decorated
    if (!this.placedOnce) {
      this.placedOnce = true;
      this.box.move(0, this.findY(c) - this.box.y0, 0);
    }
    if (!c.chunk.inside(this.box.centerX, 64, this.box.centerZ)) return true;
    const wide = c.chunk.copy().encapsulate(this.box);
    const ctx: PlaceContext = { ...c, chunk: wide };
    const props = this.props;
    const procs = (s: number, x: number, y: number, z: number, here: number) => {
      const name = blockNameOf(s);
      const pr = positionRandom(x, y, z);
      if (name === 'gold_block' && pr.nextFloat() < 0.3) return S('air');
      if (name === 'netherrack' && !props.cold && pr.nextFloat() < 0.07) return S('magma_block');
      if (name === 'lava' && props.placement === 'ON_OCEAN_FLOOR') return S('magma_block');
      if (name === 'stone_bricks' && pr.nextFloat() < props.mossiness) return S('mossy_stone_bricks');
      if (name === 'air' && FLUID[here] !== 0) return VOID;
      return s;
    };
    this.placeModel(ctx, procs);
    this.spreadNetherrack(ctx);
    if (props.vines || props.overgrown)
      for (let y = this.box.y0; y <= this.box.y1; y++)
        for (let x = this.box.x0; x <= this.box.x1; x++)
          for (let z = this.box.z0; z <= this.box.z1; z++) {
            if (props.vines) this.maybeAddVines(ctx, x, y, z);
            if (props.overgrown) this.maybeAddLeavesAbove(ctx, x, y, z);
          }
    return true;
  }

  private placeModel(c: PlaceContext, proc: (s: number, x: number, y: number, z: number, here: number) => number): void {
    const tp = new TemplatePiece(this.model, 0, 0, 0, this.rot, null, proc);
    tp.box = this.box;
    tp.postProcess(c);
  }

  private surfaceY(c: PlaceContext, x: number, z: number): number {
    return c.lv.getHeight(this.props.placement === 'ON_LAND_SURFACE' ? 'WORLD_SURFACE_WG' : 'OCEAN_FLOOR_WG', x, z) - 1;
  }

  private replaceable(c: PlaceContext, x: number, y: number, z: number): boolean {
    const s = c.lv.getState(x, y, z);
    const n = blockNameOf(s);
    return IS_AIR[s] !== 1 && n !== 'obsidian' && n !== 'crying_obsidian' && n !== 'chest' && n !== 'bedrock' && FLUID[s] === 0 && !n.endsWith('_leaves') && !n.endsWith('_log');
  }

  private rackOrMagma(c: PlaceContext, x: number, y: number, z: number): void {
    c.lv.setState(x, y, z, !this.props.cold && c.rand.nextFloat() < 0.07 ? S('magma_block') : S('netherrack'));
  }

  /** RuinedPortalPiece.spreadNetherrack */
  private spreadNetherrack(c: PlaceContext): void {
    const onSurface = this.props.placement === 'ON_LAND_SURFACE' || this.props.placement === 'ON_OCEAN_FLOOR';
    const cx = this.box.centerX, cz = this.box.centerZ;
    const fs = [1, 1, 1, 1, 1, 1, 1, 0.9, 0.9, 0.8, 0.7, 0.6, 0.4, 0.2];
    const k = fs.length;
    const l = Math.trunc((this.box.xSpan + this.box.zSpan) / 2);
    const m = c.rand.nextInt(Math.max(1, 8 - Math.trunc(l / 2)));
    for (let o = cx - k; o <= cx + k; o++)
      for (let p = cz - k; p <= cz + k; p++) {
        const r = Math.max(0, Math.abs(o - cx) + Math.abs(p - cz) + m);
        if (r >= k) continue;
        if (c.rand.nextDouble() >= Math.fround(fs[r]!)) continue;
        if (!c.lv.canWrite(o, p)) continue;
        const s = this.surfaceY(c, o, p);
        const t = onSurface ? s : Math.min(this.box.y0, s);
        if (Math.abs(t - this.box.y0) <= 3 && this.replaceable(c, o, t, p)) {
          this.rackOrMagma(c, o, t, p);
          if (this.props.overgrown) this.maybeAddLeavesAbove(c, o, t, p);
          // addNetherrackDripColumn
          let y = t - 1;
          this.rackOrMagma(c, o, y, p);
          for (let i = 0; i < 8 && c.rand.nextFloat() < 0.5; i++) {
            y--;
            if (!this.replaceable(c, o, y, p)) break;
            this.rackOrMagma(c, o, y, p);
          }
        }
      }
  }

  private maybeAddVines(c: PlaceContext, x: number, y: number, z: number): void {
    const s = c.lv.getState(x, y, z);
    if (IS_AIR[s] === 1 || blockNameOf(s) === 'vine' || c.rand.nextFloat() >= 0.2) return;
    const dir = c.rand.nextInt(4);
    const [dx, dz, face] = ([[0, -1, 'south'], [1, 0, 'west'], [0, 1, 'north'], [-1, 0, 'east']] as const)[dir]!;
    if (c.lv.isAir(x + dx, y, z + dz) && MATERIAL_BLOCKS_MOTION[s] === 1) c.lv.setState(x + dx, y, z + dz, S(`vine[${face}=true]`));
  }

  private maybeAddLeavesAbove(c: PlaceContext, x: number, y: number, z: number): void {
    if (c.rand.nextFloat() < 0.5 && MATERIAL_BLOCKS_MOTION[c.lv.getState(x, y, z)] === 1 && c.lv.isAir(x, y + 1, z)) c.lv.setState(x, y + 1, z, S('jungle_leaves[persistent=true]'));
  }
}

export function ruinedPortal(s: StartContext): Piece[] {
  const r = s.rand;
  const type = (s.config.portal_type as string) ?? 'standard';
  if (type === 'nether') return [];
  const props = propsFor(type, r);
  const giant = r.nextFloat() < 0.05;
  const design = giant ? GIANTS[r.nextInt(3)]! : PORTALS[r.nextInt(10)]!;
  const rot = r.nextInt(4);
  r.nextFloat(); // mirror
  const model = buildPortal(design, giant, props.airPocket);
  const u = r.nextFloat();
  return [new RuinedPortalPiece(model, s.cx << 4, s.cz << 4, rot, props, u)];
}
