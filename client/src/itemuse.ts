/**
 * Client side of item use (vanilla LocalPlayer/LivingEntity using-item state): predicts eating,
 * drinking and bow drawing, releases the bow when the use key goes up, plays the local eating
 * sounds and item particles, and keeps the status effects / absorption / armour the server
 * sends for the HUD. The first-person renderer reads `useRemaining`, `ticksUsing`,
 * `usedHand`, `useAnimOf` and `bowPull()` (vanilla ItemInHandRenderer eat/drink bob, bow pull).
 */
import {
  useAnim, useDuration, canStartUsing, shouldTriggerUseEffects, bowPower, equipSlotFor, armorTotals, isArrow, nameOf,
  type UseAnim,
} from '@shared/game/items';
import { EFFECT_NAME } from '@shared/game/effects';
import type { Inventory, ItemStack } from '@shared/item/stack';
import type { C2S, S2C } from '@shared/protocol/packets';

export interface ItemUseHost {
  send(p: C2S): void;
  gameMode(): number;
  foodLevel(): number;
  /** play a sound at the local player */
  playLocal(event: string, volume: number, pitch: number): void;
  /** eye position and rotation of an entity (the local player = own id) */
  entityView(id: number): { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  /** spawn one item particle (BreakingItemParticle) */
  itemParticle(item: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void;
  readonly selfId: number;
}

export interface ActiveEffect {
  id: number;
  name: string;
  amplifier: number;
  duration: number;
  ambient: boolean;
  visible: boolean;
  showIcon: boolean;
}

/** A remote living entity's use state (DATA_LIVING_ENTITY_FLAGS). */
interface RemoteUse {
  hand: number;
  item: number;
  remaining: number;
}

export class ClientItemUse {
  /** local player using state */
  usedHand: 0 | 1 = 0;
  useItem = 0;
  useRemaining = 0;
  private using = false;
  readonly effects = new Map<number, ActiveEffect>();
  absorption = 0;
  private readonly remote = new Map<number, RemoteUse>();
  private readonly rand = Math.random;

  constructor(private readonly host: ItemUseHost) {}

  get isUsing(): boolean {
    return this.using;
  }

  /** LivingEntity.getTicksUsingItem. */
  get ticksUsing(): number {
    return this.using ? useDuration(this.useItem) - this.useRemaining : 0;
  }

  /** Item.getUseAnimation of the item being used. */
  get useAnimOf(): UseAnim {
    return this.using ? useAnim(this.useItem) : 'none';
  }

  /** Bow pull 0–1 for the item model "pulling" predicate ((duration − remaining + partial) / 20). */
  bowPull(partial: number): number {
    if (!this.using || nameOf(this.useItem) !== 'bow') return 0;
    return Math.min(1, (this.ticksUsing + partial) / 20);
  }

  /** BowItem.getPowerForTime of the current draw (FOV zoom). */
  bowPower(partial: number): number {
    return this.using && nameOf(this.useItem) === 'bow' ? bowPower(this.ticksUsing + partial) : 0;
  }

  /** Remote player use state, for third-person poses. */
  remoteUse(id: number): { hand: number; item: number; ticks: number } | null {
    const r = this.remote.get(id);
    return r ? { hand: r.hand, item: r.item, ticks: useDuration(r.item) - r.remaining } : null;
  }

  /** Armour points of the worn pieces (HUD armour row). */
  armorPoints(inv: Inventory): number {
    return armorTotals([inv.get(36), inv.get(37), inv.get(38), inv.get(39)]).armor;
  }

  /** Amplifier of an active effect, −1 when absent. */
  amplifier(name: string): number {
    for (const e of this.effects.values()) if (e.name === name) return e.amplifier;
    return -1;
  }

  hasEffect(name: string): boolean {
    for (const e of this.effects.values()) if (e.name === name) return true;
    return false;
  }

  /**
   * Right click with an item (Item.use). Returns 'consume' when using starts, 'swing' for
   * instant uses (armour, buckets), 'pass' when the item does nothing on use.
   */
  tryUse(hand: 0 | 1, stack: ItemStack, inv: Inventory): 'consume' | 'swing' | 'pass' {
    if (this.using || this.host.gameMode() === 3) return 'pass';
    const n = nameOf(stack.id);
    const eq = equipSlotFor(stack.id);
    if (eq) {
      const slot = { feet: 36, legs: 37, chest: 38, head: 39 }[eq];
      if (inv.get(slot)) return 'pass';
      this.host.send({ t: 'useItem', hand });
      return 'swing';
    }
    if (n === 'bucket' || n === 'water_bucket' || n === 'lava_bucket' || n === 'snowball' || n === 'egg' || n === 'ender_pearl' || n === 'splash_potion' || n === 'lingering_potion' || n === 'glass_bottle' || n === 'experience_bottle' || n === 'ender_eye' || n.endsWith('_boat') || n === 'carrot_on_a_stick') {
      this.host.send({ t: 'useItem', hand });
      return 'swing';
    }
    let hasArrows = false;
    for (let i = 0; i < 41 && !hasArrows; i++) hasArrows = !!inv.get(i) && isArrow(inv.get(i)!.id);
    if (useDuration(stack.id) > 0 && canStartUsing(stack.id, { foodLevel: this.host.foodLevel(), creative: this.host.gameMode() === 1, hasArrows })) {
      this.host.send({ t: 'useItem', hand });
      this.using = true;
      this.usedHand = hand;
      this.useItem = stack.id;
      this.useRemaining = useDuration(stack.id);
      return 'consume';
    }
    return 'pass';
  }

  /** Called every client tick (Minecraft.handleKeybinds + LivingEntity.updatingUsingItem). */
  tick(useDown: boolean, inv: Inventory): void {
    if (this.using) {
      const stack = inv.get(this.usedHand === 1 ? 40 : inv.selected);
      if (!stack || stack.id !== this.useItem) this.stop();
      else if (!useDown) {
        // releaseUsingItem: the server shoots the bow
        this.host.send({ t: 'releaseUseItem' });
        this.stop();
      } else {
        if (shouldTriggerUseEffects(this.useItem, this.useRemaining)) this.useEffects(this.host.selfId, this.useItem, 5, true);
        if (--this.useRemaining === 0 && nameOf(this.useItem) !== 'bow') {
          // completeUsingItem (the server sends the results)
          this.useEffects(this.host.selfId, this.useItem, 16, true);
          this.stop();
        }
      }
    }
    for (const [id, r] of this.remote) {
      if (shouldTriggerUseEffects(r.item, r.remaining)) this.useEffects(id, r.item, 5, false);
      if (r.remaining > 0) r.remaining--;
    }
    for (const e of this.effects.values()) if (e.duration > 0) e.duration--;
  }

  private stop(): void {
    this.using = false;
    this.useRemaining = 0;
  }

  /** LivingEntity.triggerItemUseEffects: sounds for the local player, item particles for anyone eating. */
  private useEffects(entity: number, item: number, count: number, local: boolean): void {
    const anim = useAnim(item);
    if (anim === 'eat') this.spawnItemParticles(entity, item, count);
    if (!local) return;
    const r = this.rand;
    if (anim === 'drink') this.host.playLocal(nameOf(item) === 'honey_bottle' ? 'item.honey_bottle.drink' : 'entity.generic.drink', 0.5, r() * 0.1 + 0.9);
    else if (anim === 'eat') this.host.playLocal('entity.generic.eat', 0.5 + 0.5 * Math.floor(r() * 2), (r() - r()) * 0.2 + 1);
  }

  /** LivingEntity.spawnItemParticles: crumbs in front of the mouth. */
  spawnItemParticles(entity: number, item: number, count: number): void {
    const v = this.host.entityView(entity);
    if (!v) return;
    const r = this.rand, D = Math.PI / 180;
    const xr = -v.pitch * D, yr = -v.yaw * D;
    const rot = (x: number, y: number, z: number): [number, number, number] => {
      // Vec3.xRot then yRot
      const c = Math.cos(xr), s = Math.sin(xr);
      const y1 = y * c + z * s, z1 = z * c - y * s;
      const c2 = Math.cos(yr), s2 = Math.sin(yr);
      return [x * c2 + z1 * s2, y1, z1 * c2 - x * s2];
    };
    for (let i = 0; i < count; i++) {
      const [vx, vy, vz] = rot((r() - 0.5) * 0.1, r() * 0.1 + 0.1, 0);
      const [px, py, pz] = rot((r() - 0.5) * 0.3, -r() * 0.6 - 0.3, 0.6);
      this.host.itemParticle(item, v.x + px, v.y + py, v.z + pz, vx, vy + 0.05, vz);
    }
  }

  /** Server packets this module owns; returns true when handled. */
  handle(p: S2C): boolean {
    switch (p.t) {
      case 'mobEffect':
        if (p.id !== this.host.selfId) return true;
        this.effects.set(p.effect, {
          id: p.effect, name: EFFECT_NAME[p.effect] ?? String(p.effect), amplifier: p.amplifier, duration: p.duration,
          ambient: (p.flags & 1) !== 0, visible: (p.flags & 2) !== 0, showIcon: (p.flags & 4) !== 0,
        });
        return true;
      case 'removeMobEffect':
        if (p.id === this.host.selfId) this.effects.delete(p.effect);
        return true;
      case 'absorption':
        this.absorption = p.amount;
        return true;
      case 'livingUse':
        if (p.id === this.host.selfId) {
          // the server's verdict wins (a refused use stops the prediction)
          if (!p.using) this.stop();
          else if (!this.using) {
            this.using = true;
            this.usedHand = p.hand === 1 ? 1 : 0;
            this.useItem = p.item;
            this.useRemaining = useDuration(p.item);
          }
        } else if (p.using) this.remote.set(p.id, { hand: p.hand, item: p.item, remaining: useDuration(p.item) });
        else this.remote.delete(p.id);
        return true;
      case 'entityEvent':
        // 9 (finished using) needs nothing: the client completes on its own countdown, and a
        // use it already restarted must not be cut short by the previous one's event
        return false;
      case 'respawn':
        this.effects.clear();
        this.absorption = 0;
        this.stop();
        return false;
      case 'removeEntities':
        for (const id of p.ids) this.remote.delete(id);
        return false;
    }
    return false;
  }
}
