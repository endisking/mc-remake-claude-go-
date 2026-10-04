/** Server-side player state. */
import { PlayerPhysics, type Pose } from '@shared/entity/playerphysics';
import type { BlockWorld } from '@shared/world/world';
import type { Connection } from './server';
import { Inventory, type ItemStack } from '@shared/item/stack';
import { LivingState } from './survival';
import { StepTracker } from '@shared/entity/steps';

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
  /** entity this spectator looks through (vanilla ServerPlayer.camera), null = itself */
  camera: ServerPlayer | null = null;
  flying = false;
  sneaking = false;
  sprinting = false;
  pose: Pose = 'standing';
  living = new LivingState();
  readonly steps = new StepTracker();
  onFire = false;
  fallDistance = 0;
  /** position at the previous survival tick (sweet berry bush movement check) */
  prevTickX = 0;
  prevTickZ = 0;
  /** Dimension the player is in (GameServer.levels key: overworld, the_nether, the_end). */
  dimension = 'overworld';
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
  sentMainHand = -1;
  /** Player.attackStrengthTicker and the item it was measured with */
  attackStrengthTicker = 0;
  lastMainHandItem = 0;
  walkDist = 0;
  /** velocity from knockback (players otherwise move client-side) */
  vx = 0;
  vy = 0;
  vz = 0;
  knockbackDirty = false;
  /** bed head position while sleeping */
  sleepingPos: [number, number, number] | null = null;
  sleepCounter = 0;
  /** Player.takeXpDelay and the tick of the last level-up chime */
  takeXpDelay = 0;
  lastLevelUpTick = -1000;
  /** respawn point (bed head) and the yaw it was set with */
  respawn: { x: number; y: number; z: number; angle: number; dimension?: string } | null = null;
  walkDistO = 0;
  sentOffHand = -1;
  readonly inventory = new Inventory();
  /** PlayerEnderChestContainer: 27 slots, saved with the player */
  readonly enderChest: (ItemStack | null)[] = new Array(27).fill(null);
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

  /**
   * ServerPlayer.broadcastToPlayer: spectators see everyone not looking through someone else's
   * eyes; everybody else never sees spectators.
   */
  broadcastTo(viewer: ServerPlayer): boolean {
    if (viewer.gameMode === 3) return this.camera === null;
    return this.gameMode !== 3;
  }

  /** Shared entity flags byte (vanilla DATA_SHARED_FLAGS_ID bits). */
  flags(): number {
    return (this.onFire ? 1 : 0) | (this.pose === 'crouching' ? 2 : 0) | (this.sprinting ? 8 : 0) | (this.pose === 'swimming' ? 16 : 0) | (this.gameMode === 3 ? 32 : 0);
  }

  /** Recompute the pose from the latest state, as vanilla does server-side. */
  updatePose(): void {
    if (this.sleepingPos) {
      if (this.pose !== 'sleeping') {
        this.pose = 'sleeping';
        this.stateDirty = true;
      }
      return;
    }
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
