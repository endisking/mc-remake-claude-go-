/**
 * Passengers and vehicles (vanilla Entity.startRiding / stopRiding / positionRider and
 * ServerboundPlayerInputPacket steering). Players ride mobs (horses, donkeys, mules, pigs);
 * the server is authoritative: the client sends its steering input (C2S steerVehicle) and the
 * vehicle moves on the server, carrying the rider's seat with it.
 */
import { AABB, noCollision } from '@shared/entity/aabb';
import { stack, itemName } from '@shared/item/stack';
import { raycastBlocks } from '@shared/world/raycast';
import { Boat, BOAT_WOODS } from './boat';
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import type { Mob } from './mobs/mob';

/** Steering input of the controlling passenger (vanilla Player xxa/zza, jumping, shift, ride jump). */
export interface SteerInput {
  /** −1..1, forward positive (zza) */
  forward: number;
  /** −1..1, left positive (xxa) */
  strafe: number;
  jump: boolean;
  sneak: boolean;
  /** pending ride jump (PlayerRideableJumping.onPlayerJump power 0–100), −1 = none */
  jumpPower: number;
  /** the rider's rotation */
  yaw: number;
  pitch: number;
}

/** Anything that can carry passengers: mobs (horses, pigs) and boats. */
export interface Vehicle {
  readonly id: number;
  readonly type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  readonly width: number;
  readonly height: number;
  removed: boolean;
  dead?: boolean;
  /** the controlling (first) passenger's input */
  steer: SteerInput | null;
  passengersRidingOffset(): number;
  /** seats (Entity.canAddPassenger): 1 unless overridden (boats 2) */
  maxPassengers?(): number;
  /** horizontal seat offset along the vehicle's facing for passenger `i` of `n` (Boat.positionRider) */
  seatOffset?(i: number, n: number): number;
}

/** Player.getMyRidingOffset */
export const PLAYER_RIDING_OFFSET = -0.35;

export class Riding {
  /** passenger (player) id → vehicle */
  private readonly vehicleOf = new Map<number, Vehicle>();
  private readonly inputs = new Map<number, SteerInput>();

  constructor(private readonly s: GameServer) {}

  vehicle(p: ServerPlayer): Vehicle | null {
    return this.vehicleOf.get(p.id) ?? null;
  }

  isPassenger(p: ServerPlayer): boolean {
    return this.vehicleOf.has(p.id);
  }

  passengers(v: Vehicle): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const [pid, m] of this.vehicleOf) {
      if (m !== v) continue;
      const p = this.s.allPlayers.find((o) => o.id === pid);
      if (p) out.push(p);
    }
    return out;
  }

  isVehicle(v: Vehicle): boolean {
    for (const m of this.vehicleOf.values()) if (m === v) return true;
    return false;
  }

  /** whether another passenger fits (Entity.canAddPassenger) */
  hasRoom(v: Vehicle): boolean {
    return this.passengers(v).length < (v.maxPassengers?.() ?? 1);
  }

  /** Entity.startRiding: one passenger per mob (horses, pigs), two per boat. */
  mount(p: ServerPlayer, v: Vehicle): boolean {
    if (v.dead || v.removed || p.living.dead || !this.hasRoom(v)) return false;
    if (this.vehicleOf.has(p.id)) this.dismount(p, false);
    this.vehicleOf.set(p.id, v);
    this.inputs.set(p.id, { forward: 0, strafe: 0, jump: false, sneak: false, jumpPower: -1, yaw: p.yaw, pitch: p.pitch });
    p.sneaking = false;
    p.fallDistance = 0;
    (v as Partial<Mob>).navigation?.stop();
    this.positionRider(p, v);
    this.sync(v);
    return true;
  }

  /** Entity.stopRiding + LivingEntity.dismountVehicle (placed beside the vehicle). */
  dismount(p: ServerPlayer, teleport = true): void {
    const v = this.vehicleOf.get(p.id);
    if (!v) return;
    this.vehicleOf.delete(p.id);
    this.inputs.delete(p.id);
    v.steer = null;
    if ('xxa' in v) (v as Mob).xxa = (v as Mob).zza = 0;
    if (teleport) {
      const [x, y, z] = this.dismountLocation(p, v);
      p.x = x;
      p.y = y;
      p.z = z;
      p.fallDistance = 0;
      this.s.send(p, { t: 'teleport', x, y, z, yaw: p.yaw, pitch: p.pitch });
    }
    this.sync(v, p);
  }

  /** ServerboundPlayerInputPacket (+ PlayerCommand START_RIDING_JUMP). */
  steer(p: ServerPlayer, m: { forward: number; strafe: number; jump: boolean; sneak: boolean; jumpPower: number }): void {
    const inp = this.inputs.get(p.id);
    if (!inp) return;
    const clamp = (n: number) => (Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0);
    inp.forward = clamp(m.forward);
    inp.strafe = clamp(m.strafe);
    inp.jump = m.jump;
    inp.sneak = m.sneak;
    if (m.jumpPower >= 0) inp.jumpPower = Math.min(100, m.jumpPower);
    // Player.rideTick: wantsToStopRiding (sneak) dismounts
    if (m.sneak) this.dismount(p);
  }

  /** Player.rideTick for every passenger: steer the vehicle, then sit on its seat. */
  tick(): void {
    for (const [pid, v] of [...this.vehicleOf]) {
      const p = this.s.allPlayers.find((o) => o.id === pid);
      if (!p) {
        this.vehicleOf.delete(pid);
        this.inputs.delete(pid);
        v.steer = null;
        this.sync(v);
        continue;
      }
      if (v.dead || v.removed || p.living.dead || p.dimension !== 'overworld' || p.gameMode === 3) {
        this.dismount(p, !p.living.dead && !v.removed);
        continue;
      }
      const inp = this.inputs.get(pid)!;
      inp.yaw = p.yaw;
      inp.pitch = p.pitch;
      // only the first passenger steers (Entity.getControllingPassenger)
      if (this.passengers(v)[0] === p) v.steer = inp;
    }
  }

  /** After the vehicles moved: place riders on their seats (Entity.positionRider). */
  positionRiders(): void {
    for (const [pid, v] of this.vehicleOf) {
      const p = this.s.allPlayers.find((o) => o.id === pid);
      if (!p) continue;
      this.positionRider(p, v);
      const inp = this.inputs.get(pid);
      if (inp) inp.jumpPower = -1;
      // late trackers learn about the passenger once a second
      if (this.s.gameTime % 20 === 0) this.sync(v);
    }
  }

  positionRider(p: ServerPlayer, v: Vehicle): void {
    let off = 0;
    if (v.seatOffset) {
      const ps = this.passengers(v);
      off = v.seatOffset(Math.max(0, ps.indexOf(p)), ps.length);
    }
    // Vec3(off, 0, 0).yRot(−yRot·π/180 − π/2)
    const a = (-v.yaw * Math.PI) / 180 - Math.PI / 2;
    p.x = v.x + off * Math.cos(a);
    p.y = v.y + v.passengersRidingOffset() + PLAYER_RIDING_OFFSET;
    p.z = v.z - off * Math.sin(a);
    p.vx = p.vy = p.vz = 0;
    p.fallDistance = 0;
    p.onGround = false;
  }

  /** LivingEntity.getDismountLocationForPassenger: a free spot beside, else on top of the vehicle. */
  dismountLocation(p: ServerPlayer, v: Vehicle): [number, number, number] {
    const d = (v.width + 0.6) / 2 + 0.05;
    const yaw = (p.yaw * Math.PI) / 180;
    // right of the rider first, then left, behind, in front
    const dirs: [number, number][] = [
      [-Math.cos(yaw), -Math.sin(yaw)],
      [Math.cos(yaw), Math.sin(yaw)],
      [Math.sin(yaw), -Math.cos(yaw)],
      [-Math.sin(yaw), Math.cos(yaw)],
    ];
    for (const [dx, dz] of dirs) {
      const x = v.x - dx * d, z = v.z + dz * d;
      for (const y of [v.y, Math.floor(v.y) + 1, v.y - 1]) {
        const bb = new AABB(x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3);
        const below = new AABB(x - 0.3, y - 0.5, z - 0.3, x + 0.3, y, z + 0.3);
        if (noCollision(this.s.world, bb) && !noCollision(this.s.world, below)) return [x, y, z];
      }
    }
    return [v.x, v.y + v.height, v.z];
  }

  /**
   * FoodOnAStickItem.use (carrot on a stick): boost the steered pig, costing 7 durability; a
   * broken stick leaves a fishing rod. Returns true when the use was consumed.
   */
  useSteeringItem(p: ServerPlayer, hand: 0 | 1): boolean {
    const v = this.vehicle(p);
    if (!v || v.type !== 'pig' || !v.steer) return false;
    const pig = v as Mob & { boost(): boolean };
    if (!pig.boost()) return false;
    const slot = hand === 1 ? 40 : p.inventory.selected;
    this.s.items.damageHeld(p, hand, 7);
    if (!p.inventory.get(slot) && p.gameMode !== 1) {
      p.inventory.set(slot, stack('fishing_rod'));
      this.s.syncSlot(p, slot);
    }
    return true;
  }

  /**
   * BoatItem.use: aim (fluids included) within 5 blocks and put a boat there facing the player's
   * way, if it fits. Returns true when placed.
   */
  placeBoat(p: ServerPlayer, hand: 0 | 1): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const st = p.inventory.get(slot);
    if (!st) return false;
    const wood = BOAT_WOODS.indexOf(itemName(st.id).replace(/_boat$/, '') as (typeof BOAT_WOODS)[number]);
    if (wood < 0) return false;
    const D = Math.PI / 180;
    const dx = -Math.sin(p.yaw * D) * Math.cos(p.pitch * D), dy = -Math.sin(p.pitch * D), dz = Math.cos(p.yaw * D) * Math.cos(p.pitch * D);
    const hit = raycastBlocks(this.s.world, p.x, p.y + p.phys.eyeHeight, p.z, dx, dy, dz, 5, true);
    if (!hit) return false;
    const b = new Boat(this.s.allocateEntityId());
    b.wood = wood;
    b.x = hit.px;
    b.y = hit.py;
    b.z = hit.pz;
    b.yaw = p.yaw;
    if (!noCollision(this.s.world, b.bb().inflate(-0.1, -0.1, -0.1))) return false;
    this.s.spawnEntity(b);
    if (p.gameMode !== 1) {
      st.count--;
      if (st.count <= 0) p.inventory.set(slot, null);
      this.s.syncSlot(p, slot);
    }
    return true;
  }

  /** Boat.interact: right-clicking a boat boards it (not while sneaking, not after a minute underwater). */
  interactVehicle(p: ServerPlayer, id: number): boolean {
    const e = this.s.entities.get(id);
    if (!(e instanceof Boat) || e.removed || p.gameMode === 3) return false;
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2 >= 36) return true;
    if (p.sneaking || e.outOfControlTicks >= 60) return true;
    this.mount(p, e);
    return true;
  }

  /** Boat.hurt from a player's attack: breaks after 40 damage (creative at once), dropping its item. */
  attackVehicle(p: ServerPlayer, id: number, amount = 1): boolean {
    const e = this.s.entities.get(id);
    if (!(e instanceof Boat) || e.removed) return false;
    if (p.gameMode === 3 || this.vehicle(p) === e) return true;
    this.s.playSound(null, 'entity.player.attack.nodamage', 'player', p.x, p.y, p.z, 1, 1);
    if (e.hit(amount, p.gameMode === 1)) {
      for (const r of this.passengers(e)) this.dismount(r);
      if (p.gameMode !== 1 && this.s.mobs.doMobLoot) {
        this.s.mobs.spawnAtLocation(e as unknown as Mob, stack(e.itemName()));
      }
      e.removed = true;
    }
    return true;
  }

  /** ClientboundSetPassengersPacket to everyone who sees the vehicle (and the passengers). */
  sync(v: Vehicle, extra?: ServerPlayer): void {
    const ids = this.passengers(v).map((p) => p.id);
    const pk = { t: 'setPassengers' as const, vehicle: v.id, passengers: ids };
    for (const o of this.s.allPlayers) if (o.tracking.has(v.id) || ids.includes(o.id) || o === extra) this.s.send(o, pk);
  }
}
