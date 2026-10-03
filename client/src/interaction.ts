/**
 * Local player block interaction (vanilla Minecraft.startAttack/continueAttack/startUseItem
 * + MultiPlayerGameMode): digging with progress and crack stages, creative instant break,
 * placing with client-side prediction, pick block, item drops, hotbar selection.
 */
import { destroyProgress } from '@shared/game/mining';
import { stateForPlacement, isReplaceable, companionPlacement, DX, DY, DZ } from '@shared/game/placement';
import { canSurvive } from '@shared/game/support';
import { blockForItem, itemForBlock } from '@shared/game/loot';
import { Inventory } from '@shared/item/stack';
import { getProp, blockNameOf, stateOf } from '@shared/world/blockstate';

const WATER = stateOf('water');
import { FLUID } from '@shared/world/blockinfo';
import type { BlockHit } from '@shared/world/raycast';
import type { C2S } from '@shared/protocol/packets';
import type { ClientWorld } from './world/clientworld';
import type { PlayerPhysics } from '@shared/entity/playerphysics';

export interface InteractionHost {
  world: ClientWorld;
  player: PlayerPhysics;
  gameMode: number;
  yaw: number;
  pitch: number;
  send(p: C2S): void;
  /** spawn break particles for a block state at a position */
  onBlockBroken(x: number, y: number, z: number, state: number): void;
  /** crack particles on the face being hit */
  onBlockHit(x: number, y: number, z: number, face: number, state: number): void;
  swing(): void;
  /** attack at nothing: swing and reset the attack strength (vanilla startAttack miss) */
  missSwing(): void;
}

export class Interaction {
  readonly inventory = new Inventory();
  destroyDelay = 0;
  isDestroying = false;
  destroyX = 0;
  destroyY = 0;
  destroyZ = 0;
  destroyProgress = 0;
  destroyTicks = 0;
  rightClickDelay = 0;
  missTime = 0;

  /** Per tick housekeeping (Minecraft.tick: missTime). */
  tick(): void {
    if (this.missTime > 0) this.missTime--;
  }

  constructor(private host: InteractionHost) {}

  /** Crack stage to render (−1 none). */
  get crackStage(): number {
    return this.isDestroying && this.destroyProgress > 0 ? Math.min(9, Math.floor(this.destroyProgress * 10)) : -1;
  }

  private miner() {
    const p = this.host.player;
    const held = this.inventory.selectedStack;
    const eye = this.host.world.getState(Math.floor(p.x), Math.floor(p.y + p.eyeHeight), Math.floor(p.z));
    return { item: held?.id ?? 0, efficiency: 0, haste: 0, miningFatigue: 0, underwater: FLUID[eye] === 1, aquaAffinity: false, onGround: p.onGround };
  }

  private breakLocally(x: number, y: number, z: number): void {
    const w = this.host.world;
    const st = w.getState(x, y, z);
    if (st === 0) return;
    const waterlogged = getProp(st, 'waterlogged') === true;
    w.setStateRaw(x, y, z, waterlogged ? WATER : 0);
    w.markBlockDirty(x, y, z);
    this.host.onBlockBroken(x, y, z, st);
  }

  /** Attack key pressed this tick. */
  startAttack(target: BlockHit | null): void {
    if (this.missTime > 0) return;
    if (!target) {
      // vanilla: a miss swings, resets the attack cooldown and (in survival) blocks attacking for 10 ticks
      if (this.host.gameMode !== 1) this.missTime = 10;
      this.host.missSwing();
      return;
    }
    this.host.swing();
    if (this.host.gameMode === 3) return;
    const { x, y, z, face } = target;
    if (this.host.gameMode === 1) {
      // creative: swords can't break blocks
      if (this.heldIsSword()) return;
      this.host.send({ t: 'dig', action: 3, x, y, z, face });
      this.breakLocally(x, y, z);
      this.destroyDelay = 5;
      return;
    }
    if (this.host.gameMode === 2) return;
    if (this.isDestroying && (x !== this.destroyX || y !== this.destroyY || z !== this.destroyZ)) {
      this.host.send({ t: 'dig', action: 1, x: this.destroyX, y: this.destroyY, z: this.destroyZ, face });
    }
    const state = this.host.world.getState(x, y, z);
    this.host.send({ t: 'dig', action: 0, x, y, z, face });
    if (destroyProgress(this.miner(), state) >= 1) {
      this.breakLocally(x, y, z);
      this.isDestroying = false;
      return;
    }
    this.isDestroying = true;
    this.destroyX = x;
    this.destroyY = y;
    this.destroyZ = z;
    this.destroyProgress = 0;
    this.destroyTicks = 0;
  }

  /** Attack key held (every tick). */
  continueAttack(held: boolean, target: BlockHit | null): void {
    if (!held) this.missTime = 0;
    if (this.missTime > 0) return;
    if (!held || !target) {
      this.stopDestroy();
      if (this.destroyDelay > 0) this.destroyDelay--;
      return;
    }
    if (this.destroyDelay > 0) {
      this.destroyDelay--;
      return;
    }
    const { x, y, z, face } = target;
    if (this.host.gameMode === 1) {
      if (this.heldIsSword()) return;
      this.destroyDelay = 5;
      this.host.swing();
      this.host.send({ t: 'dig', action: 3, x, y, z, face });
      this.breakLocally(x, y, z);
      return;
    }
    if (this.host.gameMode !== 0) return;
    if (!this.isDestroying || x !== this.destroyX || y !== this.destroyY || z !== this.destroyZ) {
      this.startAttack(target);
      return;
    }
    const state = this.host.world.getState(x, y, z);
    if (state === 0) {
      this.isDestroying = false;
      return;
    }
    this.destroyProgress += destroyProgress(this.miner(), state);
    this.destroyTicks++;
    if (this.destroyTicks % 4 === 0) this.host.onBlockHit(x, y, z, face, state);
    this.host.swing();
    if (this.destroyProgress >= 1) {
      this.isDestroying = false;
      this.host.send({ t: 'dig', action: 2, x, y, z, face });
      this.breakLocally(x, y, z);
      this.destroyProgress = 0;
      this.destroyTicks = 0;
      this.destroyDelay = 5;
    }
  }

  stopDestroy(): void {
    if (this.isDestroying) this.host.send({ t: 'dig', action: 1, x: this.destroyX, y: this.destroyY, z: this.destroyZ, face: 0 });
    this.isDestroying = false;
    this.destroyProgress = 0;
  }

  private heldIsSword(): boolean {
    const h = this.inventory.selectedStack;
    return !!h && /_sword$/.test(itemNameOf(h.id));
  }

  /** Use key: pressed (fresh) or held (repeats every 4 ticks). */
  use(pressed: boolean, held: boolean, target: BlockHit | null): void {
    if (this.rightClickDelay > 0) this.rightClickDelay--;
    if (!(pressed || (held && this.rightClickDelay === 0))) return;
    this.rightClickDelay = 4;
    if (!target || this.host.gameMode === 3) return;
    const stack = this.inventory.selectedStack;
    const block = stack ? blockForItem(stack.id) : null;
    const { x, y, z, face } = target;
    const hx = target.px - x, hy = target.py - y, hz = target.pz - z;
    this.host.send({ t: 'useOn', x, y, z, face, cx: hx, cy: hy, cz: hz, hand: 0 });
    if (!block || this.host.gameMode === 2) return;
    this.host.swing();
    // client-side prediction of the placement (server corrects with block updates)
    const w = this.host.world;
    const clicked = w.getState(x, y, z);
    let px = x, py = y, pz = z;
    const slabMerge = block.endsWith('_slab') && blockNameOf(clicked) === block && getProp(clicked, 'type') !== 'double' &&
      (getProp(clicked, 'type') === 'bottom' ? face === 1 || (face > 1 && hy > 0.5) : face === 0 || (face > 1 && hy <= 0.5));
    if (!(isReplaceable(clicked, block) || slabMerge)) {
      px += DX[face]!;
      py += DY[face]!;
      pz += DZ[face]!;
    }
    if (py < 0 || py > 255) return;
    const existing = w.getState(px, py, pz);
    if (!(isReplaceable(existing, block) || (block.endsWith('_slab') && blockNameOf(existing) === block))) return;
    const state = stateForPlacement(block, { world: w, x: px, y: py, z: pz, face, hx, hy, hz, yaw: this.host.yaw, pitch: this.host.pitch, sneaking: this.host.player.shiftDown }, existing);
    if (state === null || !canSurvive(w, px, py, pz, state)) return;
    w.setStateRaw(px, py, pz, state);
    w.markBlockDirty(px, py, pz);
    for (const e of companionPlacement(block, state)) {
      w.setStateRaw(px + e.dx, py + e.dy, pz + e.dz, e.state);
      w.markBlockDirty(px + e.dx, py + e.dy, pz + e.dz);
    }
    if (this.host.gameMode === 0 && stack) {
      stack.count--;
      if (stack.count <= 0) this.inventory.set(this.inventory.selected, null);
    }
  }

  pickBlock(target: BlockHit | null): void {
    if (!target) return;
    const item = itemForBlock(target.state);
    if (!item) return;
    const slot = this.inventory.find(item);
    if (slot >= 0 && slot < 9) {
      this.select(slot);
      return;
    }
    if (this.host.gameMode === 3) return;
    // owned elsewhere in the inventory (survival or creative), or creative: the server picks it
    if (slot >= 9 || this.host.gameMode === 1) this.host.send({ t: 'pickBlock', x: target.x, y: target.y, z: target.z });
  }

  select(slot: number): void {
    if (slot === this.inventory.selected) return;
    this.inventory.selected = slot;
    this.host.send({ t: 'heldSlot', slot });
    this.stopDestroy();
  }

  scroll(delta: number): void {
    this.select((((this.inventory.selected + delta) % 9) + 9) % 9);
  }

  drop(all: boolean): void {
    const h = this.inventory.selectedStack;
    if (!h) return;
    this.host.send({ t: 'dropItem', all });
    h.count -= all ? h.count : 1;
    if (h.count <= 0) this.inventory.set(this.inventory.selected, null);
    this.host.swing();
  }
}

import { itemName } from '@shared/item/stack';
function itemNameOf(id: number): string {
  return itemName(id);
}
