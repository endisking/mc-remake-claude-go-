/** Server-side player state. */
import { PlayerPhysics, type Pose } from '@shared/entity/playerphysics';
import type { BlockWorld } from '@shared/world/world';
import type { Connection } from './server';
import { Inventory } from '@shared/item/stack';
import { LivingState } from './survival';

export class ServerPlayer {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  headYaw = 0;
  onGround = false;
  viewDistance = 8;
  simulationDistance = 10;
  name = 'Player';
  skin = '';
  /** 0 survival, 1 creative, 2 adventure, 3 spectator */
  gameMode = 0;
  flying = false;
  sneaking = false;
  sprinting = false;
  pose: Pose = 'standing';
  living = new LivingState();
  onFire = false;
  fallDistance = 0;
  /** position at the previous survival tick (sweet berry bush movement check) */
  prevTickX = 0;
  prevTickZ = 0;
  /** The world's host in single-player/LAN: exempt from "moved too quickly". */
  isOwner = false;
  /** Chunks this client currently has. */
  readonly sent = new Set<number>();
  /** Entity ids this client currently tracks. */
  readonly tracking = new Set<number>();
  /** Last position broadcast to trackers. */
  lastSentX = NaN;
  lastSentY = NaN;
  lastSentZ = NaN;
  lastSentYaw = NaN;
  lastSentPitch = NaN;
  stateDirty = true;
  readonly inventory = new Inventory();
  /** Block being dug in survival: position and start tick. */
  digging: { x: number; y: number; z: number; start: number } | null = null;
  /** Number of move packets rejected recently (for diagnostics/tests). */
  rejectedMoves = 0;
  /** Physics instance used to validate client movement against collisions. */
  readonly phys: PlayerPhysics;

  constructor(
    readonly id: number,
    readonly conn: Connection,
    world: BlockWorld,
  ) {
    this.phys = new PlayerPhysics(world);
  }

  get mayFly(): boolean {
    return this.gameMode === 1 || this.gameMode === 3;
  }

  /** Shared entity flags byte (vanilla DATA_SHARED_FLAGS_ID bits). */
  flags(): number {
    return (this.onFire ? 1 : 0) | (this.pose === 'crouching' ? 2 : 0) | (this.sprinting ? 8 : 0) | (this.pose === 'swimming' ? 16 : 0);
  }

  /** Recompute the pose from the latest state, as vanilla does server-side. */
  updatePose(): void {
    const p = this.phys;
    p.x = this.x;
    p.y = this.y;
    p.z = this.z;
    p.shiftDown = this.sneaking;
    p.sprinting = this.sprinting;
    p.abilities.flying = this.flying;
    p.abilities.noPhysics = this.gameMode === 3;
    // swimming: sprinting with eyes in water (approximation of the client-side state machine)
    p.swimming = this.sprinting && !this.flying && this.isInWater();
    const before = this.pose;
    p.updatePose();
    this.pose = p.pose;
    if (this.pose !== before) this.stateDirty = true;
  }

  private isInWater(): boolean {
    const w = this.phys.world;
    return FLUID[w.getState(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z))] === 1;
  }
}

import { FLUID } from '@shared/world/blockinfo';
