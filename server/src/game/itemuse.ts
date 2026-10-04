/**
 * Server-side item behaviour (vanilla Item.use / useOn / finishUsingItem / releaseUsing and
 * LivingEntity.updatingUsingItem): eating and drinking with their effects, milk, buckets,
 * flint and steel, armour equipping, bows shooting arrows, durability loss with the break
 * event, armour damage, status effect syncing and item entity hazards (lava, fire, cactus).
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { Arrow, Pickup, type ArrowHost, type ArrowTarget } from './arrow';
import { ItemEntity } from './entity';
import { AABB, noCollision } from '@shared/entity/aabb';
import { raycastBlocks } from '@shared/world/raycast';
import { outlineBoxes, collisionBoxes, type Box } from '@shared/world/shapes';
import { blockNameOf, getProp, withProp, stateOf, defaultState } from '@shared/world/blockstate';
import { FLUID, FULL_COLLISION } from '@shared/world/blockinfo';
import { isReplaceable, DX, DY, DZ } from '@shared/game/placement';
import { blockDrops } from '@shared/game/loot';
import { ITEMS_BY_NAME } from '@shared/data';
import { isEmpty, maxStackSize, type ItemStack } from '@shared/item/stack';
import {
  nameOf, hurtItem, mineBlockCost, hurtEnemyCost, BREAK_EVENT, armorInfo, armorTotals, equipSlotFor, ARMOR_INV_SLOT,
  armorDurabilityLoss, foodProps, useAnim, useDuration, canStartUsing, shouldTriggerUseEffects, useRemainder, bowPower, isArrow,
  type ArmorSlot,
} from '@shared/game/items';
import { EFFECT_NAME, type EffectInstance, type EffectTarget } from '@shared/game/effects';
import { DAMAGE, type DamageSource } from './survival';

interface UseState {
  hand: 0 | 1;
  item: number;
  remaining: number;
}

const ARMOR_SLOTS: ArmorSlot[] = ['feet', 'legs', 'chest', 'head'];
const FULL: Box[] = [[0, 0, 0, 1, 1, 1]];
const id = (n: string) => ITEMS_BY_NAME.get(n)!.id;

/** Netherite items and ancient debris survive fire and lava (Item.isFireResistant). */
export function isFireResistant(itemId: number): boolean {
  const n = nameOf(itemId);
  return n.startsWith('netherite_') || n === 'ancient_debris';
}

export class ItemUse {
  private readonly using = new Map<number, UseState>();
  /** ItemCooldowns (chorus fruit): player id → item id → tick it ends */
  private readonly cooldowns = new Map<number, Map<number, number>>();
  /** armour last broadcast per player (feet, legs, chest, head) */
  private readonly sentArmor = new Map<number, string>();
  /** last using flag broadcast per player */
  private readonly sentUse = new Map<number, string>();
  readonly arrowHost: ArrowHost;

  constructor(private readonly s: GameServer) {
    const srv = s;
    this.arrowHost = {
      arrowTargets: () => this.arrowTargets(),
      ownerBox: (oid) => {
        const o = srv.players.find((p) => p.id === oid);
        return o ? AABB.ofSize(o.x, o.y, o.z, 0.6, 1.8) : null;
      },
      playSound: (ev, x, y, z, v, pi) => srv.playSound(null, ev, 'neutral', x, y, z, v, pi),
      dropItem: (x, y, z, st) => {
        const e = new ItemEntity(srv.newEntityId(), st);
        e.x = x;
        e.y = y;
        e.z = z;
        srv.spawnEntity(e);
      },
      canHarm: (oid, t) => {
        const owner = srv.players.find((p) => p.id === oid);
        const victim = srv.players.find((p) => p.id === t.id);
        return !(owner && victim && owner !== victim && !srv.pvp);
      },
      get rand() {
        return srv.rand;
      },
    };
  }

  // ---------------------------------------------------------------- using state

  isUsing(p: ServerPlayer): boolean {
    return this.using.has(p.id);
  }

  /** Remaining use ticks (for tests / animations), 0 when not using. */
  useRemaining(p: ServerPlayer): number {
    return this.using.get(p.id)?.remaining ?? 0;
  }

  private handSlot(p: ServerPlayer, hand: 0 | 1): number {
    return hand === 1 ? 40 : p.inventory.selected;
  }

  private stop(p: ServerPlayer): void {
    this.using.delete(p.id);
  }

  private onCooldown(p: ServerPlayer, item: number): boolean {
    const end = this.cooldowns.get(p.id)?.get(item);
    return end !== undefined && end > this.s.gameTime;
  }

  /** ServerboundUseItem: right click with an item (in the air, or after a block passed). */
  useItem(p: ServerPlayer, hand: 0 | 1): void {
    if (p.gameMode === 3 || p.living.dead || this.using.has(p.id)) return;
    const slot = this.handSlot(p, hand);
    const stack = p.inventory.get(slot);
    if (isEmpty(stack)) return;
    if (this.onCooldown(p, stack.id)) return;
    const n = nameOf(stack.id);
    const creative = p.gameMode === 1;
    // ArmorItem.use / ElytraItem.use: equip into an empty slot
    const eq = equipSlotFor(stack.id);
    if (eq) {
      const inv = ARMOR_INV_SLOT[eq];
      if (p.inventory.get(inv)) return;
      p.inventory.set(inv, { ...stack, count: 1 });
      // vanilla 1.17 moves the item even in creative (ArmorItem.use: setCount(0))
      stack.count--;
      if (stack.count <= 0) p.inventory.set(slot, null);
      this.s.syncSlot(p, slot);
      this.s.syncSlot(p, inv);
      const a = armorInfo(stack.id);
      this.s.playSound(null, a ? a.equipSound : n === 'elytra' ? 'item.armor.equip_elytra' : 'item.armor.equip_generic', 'player', p.x, p.y, p.z, 1, 1);
      this.swing(p, hand);
      return;
    }
    if (n === 'bucket' || n === 'water_bucket' || n === 'lava_bucket') {
      if (this.useBucket(p, hand, slot, stack)) this.swing(p, hand);
      return;
    }
    if (canStartUsing(stack.id, { foodLevel: p.living.food.foodLevel, creative, hasArrows: this.findArrows(p) >= 0 })) {
      this.using.set(p.id, { hand, item: stack.id, remaining: useDuration(stack.id) });
    }
  }

  /** ServerboundPlayerAction RELEASE_USE_ITEM (Player.releaseUsingItem). */
  release(p: ServerPlayer): void {
    const st = this.using.get(p.id);
    if (!st) return;
    this.stop(p);
    const slot = this.handSlot(p, st.hand);
    const stack = p.inventory.get(slot);
    if (isEmpty(stack) || stack.id !== st.item) return;
    if (nameOf(stack.id) === 'bow') this.releaseBow(p, st, slot, stack);
  }

  /** Per-tick: LivingEntity.updatingUsingItem, armour/use broadcasts. */
  tick(p: ServerPlayer): void {
    const st = this.using.get(p.id);
    if (st) {
      const slot = this.handSlot(p, st.hand);
      const stack = p.inventory.get(slot);
      if (p.living.dead || isEmpty(stack) || stack.id !== st.item) this.stop(p);
      else {
        if (shouldTriggerUseEffects(stack.id, st.remaining)) this.useEffects(p, stack, false);
        if (--st.remaining === 0 && nameOf(stack.id) !== 'bow') this.complete(p, st, slot, stack);
      }
    }
    this.broadcastState(p);
  }

  /** triggerItemUseEffects sounds (heard by others; the user's client plays its own). */
  private useEffects(p: ServerPlayer, stack: ItemStack, complete: boolean): void {
    const r = this.s.rand;
    const anim = useAnim(stack.id);
    const honey = nameOf(stack.id) === 'honey_bottle';
    if (anim === 'drink') this.s.playSound(p, honey ? 'item.honey_bottle.drink' : 'entity.generic.drink', 'player', p.x, p.y, p.z, 0.5, r.nextFloat() * 0.1 + 0.9);
    else if (anim === 'eat') this.s.playSound(p, 'entity.generic.eat', 'player', p.x, p.y, p.z, 0.5 + 0.5 * r.nextInt(2), (r.nextFloat() - r.nextFloat()) * 0.2 + 1);
    void complete;
  }

  /** LivingEntity.completeUsingItem → Item.finishUsingItem. */
  private complete(p: ServerPlayer, st: UseState, slot: number, stack: ItemStack): void {
    this.stop(p);
    this.useEffects(p, stack, true);
    // entity event 9: the client finishes its own use animation
    this.s.send(p, { t: 'entityEvent', id: p.id, event: 9 });
    const creative = p.gameMode === 1;
    const n = nameOf(stack.id);
    const r = this.s.rand;
    const l = p.living;
    const target = this.effectTarget(p);
    if (n === 'milk_bucket') {
      l.effects.clear(target);
    } else {
      const f = foodProps(stack.id);
      if (f) {
        // Player.eat: food, burp, the eat sound and the food's effects
        l.food.eat(f.nutrition, f.saturationModifier);
        this.s.playSound(null, 'entity.player.burp', 'player', p.x, p.y, p.z, 0.5, r.nextFloat() * 0.1 + 0.9);
        this.s.playSound(null, honeyOr(n, 'entity.generic.eat'), 'neutral', p.x, p.y, p.z, 1, 1 + (r.nextFloat() - r.nextFloat()) * 0.4);
        for (const e of f.effects) if (r.nextFloat() < e.probability) l.effects.add(e.effect, e.duration, e.amplifier, target);
        if (n === 'honey_bottle') l.effects.remove('poison', target);
        if (n === 'chorus_fruit') this.chorusTeleport(p);
      }
    }
    // consume and hand back the container (bowl / bucket / glass bottle)
    const rem = useRemainder(stack.id);
    if (!creative) {
      stack.count--;
      if (stack.count <= 0) p.inventory.set(slot, rem ? { id: id(rem), count: 1, damage: 0 } : null);
      else if (rem) this.give(p, { id: id(rem), count: 1, damage: 0 });
    }
    this.s.syncSlot(p, slot);
    this.s.survival.sync(p);
    void st;
  }

  /** ChorusFruitItem: up to 16 random teleport attempts within 8 blocks, then a 20-tick cooldown. */
  private chorusTeleport(p: ServerPlayer): void {
    const r = this.s.rand, w = this.s.world;
    const ox = p.x, oy = p.y, oz = p.z;
    for (let i = 0; i < 16; i++) {
      const x = p.x + (r.nextDouble() - 0.5) * 16;
      let y = Math.max(0, Math.min(255, p.y + (r.nextInt(16) - 8)));
      const z = p.z + (r.nextDouble() - 0.5) * 16;
      // LivingEntity.randomTeleport: drop to the first block that blocks motion
      let by = Math.floor(y), found = false;
      if (!w.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) continue;
      while (!found && by > 0) {
        if (collisionBoxes(w.getState(Math.floor(x), by - 1, Math.floor(z))).length > 0) found = true;
        else {
          y--;
          by--;
        }
      }
      if (!found) continue;
      const bb = AABB.ofSize(x, y, z, 0.6, 1.8).deflate(1e-5);
      if (!noCollision(w, bb) || this.containsLiquid(bb)) continue;
      p.x = x;
      p.y = y;
      p.z = z;
      p.fallDistance = 0;
      this.s.send(p, { t: 'teleport', x, y, z, yaw: p.yaw, pitch: p.pitch });
      this.s.playSound(null, 'item.chorus_fruit.teleport', 'player', ox, oy, oz, 1, 1);
      this.s.playSound(null, 'item.chorus_fruit.teleport', 'player', x, y, z, 1, 1);
      break;
    }
    let m = this.cooldowns.get(p.id);
    if (!m) this.cooldowns.set(p.id, (m = new Map()));
    m.set(id('chorus_fruit'), this.s.gameTime + 20);
  }

  private containsLiquid(bb: AABB): boolean {
    const w = this.s.world;
    for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) if (FLUID[w.getState(x, y, z)]) return true;
    return false;
  }

  /** Inventory.add, dropping what doesn't fit (ItemUtils.createFilledResult). */
  give(p: ServerPlayer, st: ItemStack): void {
    const left = p.inventory.add(st);
    if (left > 0) this.s.tossItem(p, { ...st, count: left });
    for (let i = 0; i < 36; i++) this.s.syncSlot(p, i);
  }

  private swing(p: ServerPlayer, hand: 0 | 1): void {
    this.s.broadcastToTrackers(p, { t: 'animate', id: p.id, action: hand === 1 ? 3 : 0 });
  }

  // ---------------------------------------------------------------- buckets

  private useBucket(p: ServerPlayer, hand: 0 | 1, slot: number, stack: ItemStack): boolean {
    const w = this.s.world;
    const n = nameOf(stack.id);
    const empty = n === 'bucket';
    const eyeY = p.y + p.phys.eyeHeight;
    const D = Math.PI / 180;
    const dx = -Math.sin(p.yaw * D) * Math.cos(p.pitch * D), dy = -Math.sin(p.pitch * D), dz = Math.cos(p.yaw * D) * Math.cos(p.pitch * D);
    // Item.getPlayerPOVHitResult: 5 blocks; an empty bucket also hits fluid sources (SOURCE_ONLY)
    const hit = raycastBlocks(w, p.x, eyeY, p.z, dx, dy, dz, 5, false, undefined, empty ? (st) => (isFluidSource(st) ? FULL : outlineBoxes(st)) : outlineBoxes);
    if (!hit) return false;
    const creative = p.gameMode === 1;
    if (empty) {
      const st = hit.state;
      const name = blockNameOf(st);
      let filled: string | null = null, sound = 'item.bucket.fill';
      if ((name === 'water' || name === 'lava') && getProp(st, 'level') === 0) {
        filled = `${name}_bucket`;
        if (name === 'lava') sound = 'item.bucket.fill_lava';
        this.s.setBlock(hit.x, hit.y, hit.z, 0);
      } else if (name === 'bubble_column') {
        filled = 'water_bucket';
        this.s.setBlock(hit.x, hit.y, hit.z, 0);
      } else if (getProp(st, 'waterlogged') === true) {
        filled = 'water_bucket';
        this.s.setBlock(hit.x, hit.y, hit.z, withProp(st, 'waterlogged', false));
      } else if (name === 'powder_snow') {
        filled = 'powder_snow_bucket';
        sound = 'item.bucket.fill_powder_snow';
        this.s.setBlock(hit.x, hit.y, hit.z, 0);
      }
      if (!filled) return false;
      this.s.updateNeighbors(hit.x, hit.y, hit.z);
      this.s.playSound(null, sound, 'neutral', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, 1);
      const full = { id: id(filled), count: 1, damage: 0 };
      if (creative) {
        if (p.inventory.find(full.id) < 0) this.give(p, full);
      } else {
        stack.count--;
        if (stack.count <= 0) {
          p.inventory.set(slot, full);
          this.s.syncSlot(p, slot);
        } else {
          this.s.syncSlot(p, slot);
          this.give(p, full);
        }
      }
      return true;
    }
    const lava = n === 'lava_bucket';
    const clicked = w.getState(hit.x, hit.y, hit.z);
    let tx = hit.x, ty = hit.y, tz = hit.z;
    if (!(getProp(clicked, 'waterlogged') !== undefined && !lava)) {
      tx += DX[hit.face]!;
      ty += DY[hit.face]!;
      tz += DZ[hit.face]!;
    }
    if (!this.emptyBucket(lava, tx, ty, tz) && !this.emptyBucket(lava, hit.x + DX[hit.face]!, hit.y + DY[hit.face]!, hit.z + DZ[hit.face]!)) return false;
    if (!creative) {
      p.inventory.set(slot, { id: id('bucket'), count: 1, damage: 0 });
      this.s.syncSlot(p, slot);
    }
    void hand;
    return true;
  }

  /** BucketItem.emptyContents at a position. */
  private emptyBucket(lava: boolean, x: number, y: number, z: number): boolean {
    if (y < 0 || y > 255) return false;
    const w = this.s.world;
    const st = w.getState(x, y, z);
    const name = blockNameOf(st);
    const fluid = lava ? 'lava' : 'water';
    const sound = lava ? 'item.bucket.empty_lava' : 'item.bucket.empty';
    if (!lava && getProp(st, 'waterlogged') === false) {
      this.s.setBlock(x, y, z, withProp(st, 'waterlogged', true));
      this.s.updateNeighbors(x, y, z);
      this.s.playSound(null, sound, 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      return true;
    }
    const isLiquid = FLUID[st] !== 0 && (name === 'water' || name === 'lava');
    const replaceable = st === 0 || isLiquid || isReplaceable(st) || collisionBoxes(st).length === 0;
    if (!replaceable || getProp(st, 'waterlogged') === true) return false;
    if (st !== 0 && !isLiquid && name !== 'air' && name !== 'cave_air') {
      // level.destroyBlock(pos, true): plants and other non-solid blocks pop off
      this.s.setBlock(x, y, z, 0);
      for (const o of this.s.players) this.s.send(o, { t: 'levelEvent', event: 2001, x, y, z, data: st });
      for (const it of blockDrops(st, { silkTouch: false, canHarvest: true, random: () => this.s.rand.nextFloat() })) this.s.popResource(x, y, z, it);
    }
    this.s.setBlock(x, y, z, defaultState(fluid));
    this.s.updateNeighbors(x, y, z);
    this.s.playSound(null, sound, 'block', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }

  // ---------------------------------------------------------------- use on block

  /** Item.useOn for non-block items (flint and steel). Returns true when the click was used. */
  useOn(p: ServerPlayer, hand: 0 | 1, x: number, y: number, z: number, face: number): boolean {
    const slot = this.handSlot(p, hand);
    const stack = p.inventory.get(slot);
    if (isEmpty(stack) || p.gameMode === 2) return false;
    const n = nameOf(stack.id);
    if (n !== 'flint_and_steel') return false;
    const w = this.s.world;
    const r = this.s.rand;
    const st = w.getState(x, y, z);
    const name = blockNameOf(st);
    // FlintAndSteelItem: light campfires, candles and candle cakes
    const lightable = (name === 'campfire' || name === 'soul_campfire') ? getProp(st, 'waterlogged') !== true : name.endsWith('candle') || name.endsWith('candle_cake');
    if (lightable && getProp(st, 'lit') === false) {
      this.s.playSound(null, 'item.flintandsteel.use', 'block', x + 0.5, y + 0.5, z + 0.5, 1, r.nextFloat() * 0.4 + 0.8);
      this.s.setBlock(x, y, z, withProp(st, 'lit', true));
      this.damageHeld(p, hand, 1);
      return true;
    }
    const fx = x + DX[face]!, fy = y + DY[face]!, fz = z + DZ[face]!;
    if (fy < 0 || fy > 255) return false;
    const fire = this.fireStateAt(fx, fy, fz);
    if (fire === null) return false;
    this.s.playSound(null, 'item.flintandsteel.use', 'block', fx + 0.5, fy + 0.5, fz + 0.5, 1, r.nextFloat() * 0.4 + 0.8);
    this.s.setBlock(fx, fy, fz, fire);
    this.s.updateNeighbors(fx, fy, fz);
    this.damageHeld(p, hand, 1);
    return true;
  }

  /** BaseFireBlock.canBePlacedAt + getState: soul fire on soul soil, fire on solid ground or next to flammables. */
  fireStateAt(x: number, y: number, z: number): number | null {
    const w = this.s.world;
    const here = w.getState(x, y, z);
    const hn = blockNameOf(here);
    if (here !== 0 && hn !== 'cave_air' && hn !== 'void_air') return null;
    const below = w.getState(x, y - 1, z);
    const bn = blockNameOf(below);
    if (bn === 'soul_sand' || bn === 'soul_soil') return defaultState('soul_fire');
    if (FULL_COLLISION[below] === 1) return defaultState('fire');
    let st = defaultState('fire'), any = false;
    const props: [string, number, number, number][] = [['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0], ['up', 0, 1, 0]];
    for (const [prop, ox, oy, oz] of props) {
      if (isFlammable(w.getState(x + ox, y + oy, z + oz))) {
        st = withProp(st, prop, true);
        any = true;
      }
    }
    return any ? st : null;
  }

  // ---------------------------------------------------------------- bows and arrows

  /** Player.getProjectile: off hand, main hand, then the inventory in slot order. */
  private findArrows(p: ServerPlayer): number {
    const inv = p.inventory;
    if (inv.get(40) && isArrow(inv.get(40)!.id)) return 40;
    if (inv.get(inv.selected) && isArrow(inv.get(inv.selected)!.id)) return inv.selected;
    for (let i = 0; i < 36; i++) if (inv.get(i) && isArrow(inv.get(i)!.id)) return i;
    return -1;
  }

  /** BowItem.releaseUsing. */
  private releaseBow(p: ServerPlayer, st: UseState, slot: number, bow: ItemStack): void {
    const creative = p.gameMode === 1;
    const ammoSlot = this.findArrows(p);
    if (ammoSlot < 0 && !creative) return;
    const ammo = ammoSlot >= 0 ? p.inventory.get(ammoSlot)! : { id: id('arrow'), count: 1, damage: 0 };
    const ticks = useDuration(bow.id) - st.remaining;
    const f = bowPower(ticks);
    if (f < 0.1) return;
    const arrowItem: ItemStack = { id: nameOf(ammo.id) === 'arrow' ? ammo.id : id('arrow'), count: 1, damage: 0 };
    const a = new Arrow(this.s.newEntityId(), this.arrowHost, arrowItem);
    a.x = p.x;
    a.y = p.y + p.phys.eyeHeight - 0.1;
    a.z = p.z;
    a.ownerId = p.id;
    a.shootFromRotation(p.pitch, p.yaw, f * 3, 1);
    if (f === 1) a.crit = true;
    a.pickup = creative ? Pickup.CreativeOnly : Pickup.Allowed;
    this.s.spawnEntity(a);
    this.damageHeld(p, st.hand, 1);
    const r = this.s.rand;
    this.s.playSound(null, 'entity.arrow.shoot', 'player', p.x, p.y, p.z, 1, 1 / (r.nextFloat() * 0.4 + 1.2) + f * 0.5);
    if (!creative && ammoSlot >= 0) {
      ammo.count--;
      if (ammo.count <= 0) p.inventory.set(ammoSlot, null);
      this.s.syncSlot(p, ammoSlot);
    }
    void slot;
  }

  private *arrowTargets(): Iterable<ArrowTarget> {
    const self = this;
    for (const p of this.s.players) {
      if (p.gameMode === 3 || p.living.dead) continue;
      yield {
        id: p.id,
        bb: () => AABB.ofSize(p.x, p.y, p.z, 0.6, p.pose === 'crouching' ? 1.5 : p.pose === 'swimming' || p.pose === 'sleeping' ? 0.6 : 1.8),
        hurtByArrow: (arrow, dmg) => {
          const owner = self.s.players.find((o) => o.id === arrow.ownerId) ?? null;
          const src: DamageSource = { id: 'arrow', ...(owner ? {} : { entity: { name: 'Arrow', player: false } }) };
          const ok = self.s.survival.hurt(p, src, dmg, owner && owner !== p ? owner : null);
          if (ok && owner && owner !== p) self.s.send(owner, { t: 'sound', event: soundIdSafe('entity.arrow.hit_player'), category: 7, x: owner.x, y: owner.y, z: owner.z, volume: 0.18, pitch: 0.45 });
          return ok;
        },
      };
    }
    // mobs and other entities opt in by implementing hurtByArrow
    for (const e of this.s.entities.values()) {
      const t = e as unknown as Partial<ArrowTarget>;
      if (!e.removed && typeof t.hurtByArrow === 'function') yield e as unknown as ArrowTarget;
    }
  }

  /** Arrow pickups (Player.touch → AbstractArrow.playerTouch). */
  touchArrows(p: ServerPlayer): void {
    if (p.gameMode === 3 || p.living.dead) return;
    const bb = AABB.ofSize(p.x, p.y, p.z, 0.6, 1.8).inflate(1, 0.5, 1);
    for (const e of this.s.entities.values()) {
      if (!(e instanceof Arrow) || e.removed || !e.bb().intersects(bb)) continue;
      if (!e.canPickUp(p.gameMode === 1)) continue;
      if (e.pickup === Pickup.Allowed && p.inventory.add({ ...e.item }) > 0) continue;
      for (const o of this.s.players) if (o === p || o.tracking.has(e.id)) this.s.send(o, { t: 'takeItem', itemId: e.id, collectorId: p.id, count: 1 });
      e.removed = true;
      for (let i = 0; i < 36; i++) this.s.syncSlot(p, i);
    }
  }

  // ---------------------------------------------------------------- durability

  /** ItemStack.hurtAndBreak on the item in a hand (creative players don't wear items). */
  damageHeld(p: ServerPlayer, hand: 0 | 1, amount: number): void {
    if (p.gameMode === 1 || amount <= 0) return;
    const slot = this.handSlot(p, hand);
    this.damageSlot(p, slot, amount, hand === 1 ? BREAK_EVENT.offHand : BREAK_EVENT.mainHand);
  }

  private damageSlot(p: ServerPlayer, slot: number, amount: number, event: number): void {
    const stack = p.inventory.get(slot);
    if (isEmpty(stack)) return;
    if (hurtItem(stack, amount, this.s.rand, 0)) {
      // broadcastBreakEvent before the stack shrinks: the clients still see the item
      this.s.broadcastToTrackers(p, { t: 'entityEvent', id: p.id, event }, true);
      stack.count--;
      stack.damage = 0;
      if (stack.count <= 0) p.inventory.set(slot, null);
    }
    this.s.syncSlot(p, slot);
  }

  /** Item.mineBlock after a survival player broke a block. */
  onBlockMined(p: ServerPlayer, state: number): void {
    const held = p.inventory.selectedStack;
    if (!held) return;
    this.damageHeld(p, 0, mineBlockCost(held.id, state));
  }

  /** Item.hurtEnemy after a successful melee hit. */
  onAttackHit(p: ServerPlayer): void {
    const held = p.inventory.selectedStack;
    if (!held) return;
    this.damageHeld(p, 0, hurtEnemyCost(held.id));
  }

  // ---------------------------------------------------------------- armour

  worn(p: ServerPlayer): (ItemStack | null)[] {
    return ARMOR_SLOTS.map((s) => p.inventory.get(ARMOR_INV_SLOT[s]));
  }

  armorOf(p: ServerPlayer): { armor: number; toughness: number; knockbackResistance: number } {
    return armorTotals(this.worn(p));
  }

  /** Player.hurtArmor → Inventory.hurtArmor: every armour piece loses max(1, damage/4). */
  hurtArmor(p: ServerPlayer, src: DamageSource, damage: number): void {
    const loss = armorDurabilityLoss(damage);
    if (loss <= 0 || p.gameMode === 1) return;
    const events = [BREAK_EVENT.feet, BREAK_EVENT.legs, BREAK_EVENT.chest, BREAK_EVENT.head];
    ARMOR_SLOTS.forEach((s, i) => {
      const slot = ARMOR_INV_SLOT[s];
      const st = p.inventory.get(slot);
      if (!st || !armorInfo(st.id)) return;
      if (src.fire && isFireResistant(st.id)) return;
      this.damageSlot(p, slot, loss, events[i]!);
    });
  }

  /** Leather armour stops freezing in powder snow (LivingEntity.canFreeze). */
  canFreeze(p: ServerPlayer): boolean {
    return !this.worn(p).some((s) => s && nameOf(s.id).startsWith('leather_'));
  }

  // ---------------------------------------------------------------- effects

  /** The EffectTarget view of a player's survival state. */
  effectTarget(p: ServerPlayer): EffectTarget {
    const s = this.s;
    return {
      get health() { return p.living.health; },
      get maxHealth() { return p.living.maxHealth; },
      get absorption() { return p.living.absorption; },
      set absorption(v: number) { p.living.absorption = v; },
      heal: (a) => s.survival.heal(p, a),
      hurtMagic: (a) => { s.survival.hurt(p, DAMAGE.magic, a); },
      hurtWither: (a) => { s.survival.hurt(p, DAMAGE.wither, a); },
      addExhaustion: (a) => p.living.food.addExhaustion(a),
      eat: (n, m) => p.living.food.eat(n, m),
    };
  }

  /** UpdateMobEffect / RemoveMobEffect to the player itself. */
  sendEffect(p: ServerPlayer, e: EffectInstance, removed: boolean): void {
    if (removed) this.s.send(p, { t: 'removeMobEffect', id: p.id, effect: e.id });
    else this.s.send(p, { t: 'mobEffect', id: p.id, effect: e.id, amplifier: e.amplifier, duration: e.duration, flags: (e.ambient ? 1 : 0) | (e.visible ? 2 : 0) | (e.showIcon ? 4 : 0) });
    void EFFECT_NAME;
  }

  // ---------------------------------------------------------------- tracking

  private armorKey(p: ServerPlayer): string {
    return this.worn(p).map((s) => s?.id ?? 0).join(',');
  }

  /** Send armour and use state to a player that just started tracking `o`. */
  sendStateTo(viewer: ServerPlayer, o: ServerPlayer): void {
    const [f, l, c, h] = this.worn(o).map((s) => s?.id ?? 0);
    this.s.send(viewer, { t: 'armorEquipment', id: o.id, feet: f!, legs: l!, chest: c!, head: h! });
    const u = this.using.get(o.id);
    this.s.send(viewer, { t: 'livingUse', id: o.id, using: !!u, hand: u?.hand ?? 0, item: u?.item ?? 0 });
  }

  /** LivingEntity.detectEquipmentUpdates (armour) and the DATA_LIVING_ENTITY_FLAGS using bit. */
  private broadcastState(p: ServerPlayer): void {
    const key = this.armorKey(p);
    if (this.sentArmor.get(p.id) !== key) {
      this.sentArmor.set(p.id, key);
      const [f, l, c, h] = key.split(',').map(Number);
      for (const o of this.s.players) if (o.tracking.has(p.id)) this.s.send(o, { t: 'armorEquipment', id: p.id, feet: f!, legs: l!, chest: c!, head: h! });
    }
    const u = this.using.get(p.id);
    const ukey = u ? `${u.hand}:${u.item}` : '';
    if (this.sentUse.get(p.id) !== ukey) {
      this.sentUse.set(p.id, ukey);
      // the user too: corrects a client that predicted wrongly (e.g. full hunger)
      this.s.broadcastToTrackers(p, { t: 'livingUse', id: p.id, using: !!u, hand: u?.hand ?? 0, item: u?.item ?? 0 }, true);
    }
  }

  forget(p: ServerPlayer): void {
    this.using.delete(p.id);
    this.cooldowns.delete(p.id);
    this.sentArmor.delete(p.id);
    this.sentUse.delete(p.id);
  }

  // ---------------------------------------------------------------- item entity hazards

  /**
   * ItemEntity health (5): lava (4 per tick plus 15 s of burning), fire blocks (1/2 per tick),
   * burning (1 per second) and cactus (1 per tick) destroy dropped items; netherite survives fire.
   */
  itemHazards(e: ItemEntity): void {
    const w = this.s.world;
    const fireproof = isFireResistant(e.stack.id);
    const bb = e.bb().deflate(1e-7);
    let lava = false, fire = 0, cactus = false;
    for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
          const n = blockNameOf(w.getState(x, y, z));
          if (n === 'lava') lava = true;
          else if (n === 'fire') fire = Math.max(fire, 1);
          else if (n === 'soul_fire') fire = 2;
          else if (n === 'cactus') cactus = true;
        }
    const h = e;
    const hurt = (amount: number, isFire: boolean) => {
      if (isFire && fireproof) return;
      h.health -= amount;
      if (h.health <= 0) e.removed = true;
    };
    if (FLUID[w.getState(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))] === 1) h.fireTicks = 0;
    if (h.fireTicks > 0) {
      if (h.fireTicks % 20 === 0 && !lava) hurt(1, true);
      h.fireTicks--;
    }
    if (lava && !fireproof) {
      h.fireTicks = Math.max(h.fireTicks, 300);
      const r = this.s.rand;
      hurt(4, true);
      this.s.playSound(null, 'entity.generic.burn', 'neutral', e.x, e.y, e.z, 0.4, 2 + r.nextFloat() * 0.4);
    } else if (lava && fireproof) {
      // fire-resistant items float up out of lava
      e.vy = Math.max(e.vy, 0.06);
    }
    if (fire > 0) {
      h.fireTicks = Math.max(h.fireTicks, 160);
      hurt(fire, true);
    }
    if (cactus) hurt(1, false);
  }
}

function honeyOr(n: string, ev: string): string {
  return n === 'honey_bottle' ? 'item.honey_bottle.drink' : ev;
}

function isFluidSource(st: number): boolean {
  const n = blockNameOf(st);
  if (n === 'bubble_column') return true;
  return (n === 'water' || n === 'lava') && getProp(st, 'level') === 0;
}

const FLAMMABLE_RE = /(_planks|_log|_wood|_leaves|_wool|_carpet|bookshelf|_fence|_fence_gate|_stairs|_slab|hay_block|tnt|vine|grass|fern|dead_bush|_flower|dandelion|poppy|tulip|scaffolding|bamboo|dried_kelp_block|target|beehive|bee_nest|coal_block|azalea|lectern|composter|_banner)$/;

/** FireBlock flammability (rough: wooden, woollen and plant blocks; not nether wood). */
function isFlammable(st: number): boolean {
  if (st === 0) return false;
  const n = blockNameOf(st);
  if (n.startsWith('crimson') || n.startsWith('warped') || n.includes('stone') || n.includes('brick') || n.includes('deepslate')) return false;
  return FLAMMABLE_RE.test(n);
}

import { soundId } from '@shared/sound/events';
function soundIdSafe(ev: string): number {
  return soundId(ev);
}

void stateOf;
void maxStackSize;
