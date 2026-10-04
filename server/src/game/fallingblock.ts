/**
 * Falling block entity (vanilla 1.17.1 FallingBlockEntity): spawned at the block's position
 * (x + 0.5, y, z + 0.5), removes the block on its first tick, falls with gravity 0.04 and drag 0.98,
 * and on landing places itself (or drops as an item when the spot can't take it). Landing logic
 * lives in the server's block behaviours, which this entity calls back into each tick.
 */
import { ServerEntity } from './entity';
import type { BlockWorld } from '@shared/world/world';

export class FallingBlockEntity extends ServerEntity {
  readonly type = 'falling_block';
  readonly width = 0.98;
  readonly height = 0.98;
  /** clientTrackingRange 10 chunks */
  readonly trackRange = 160;
  /** FallingBlockEntity.time */
  time = 0;
  dropItem = true;
  /** anvils: hurtsEntities(2, 40) */
  hurtsEntities = false;
  fallDamagePerDistance = 0;
  fallDamageMax = 40;
  /** previous position (concrete powder water check) */
  xo = 0;
  yo = 0;
  zo = 0;

  constructor(
    id: number,
    public state: number,
    /** server-side landing / first-tick logic */
    private readonly onTick: (e: FallingBlockEntity, world: BlockWorld, phase: 'start' | 'moved') => boolean,
  ) {
    super(id);
  }

  tick(world: BlockWorld): void {
    if (this.removed) return;
    this.xo = this.x;
    this.yo = this.y;
    this.zo = this.z;
    if (this.time++ === 0 && !this.onTick(this, world, 'start')) return;
    this.vy -= 0.04;
    const fall = this.fallDistance, y0 = this.y;
    this.moveWithCollision(world, this.vx, this.vy, this.vz);
    // moveWithCollision resets fallDistance on landing; keep it for anvil damage
    if (this.onGround) {
      this.fallDistance = fall + (y0 - this.y);
      this.vy = 0;
    }
    this.onTick(this, world, 'moved');
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.vz *= 0.98;
  }
}
