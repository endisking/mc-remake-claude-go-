/**
 * Mob network contract (server simulation → client rendering).
 *
 * Per-mob state: `mobData { id, key, value }` with the keys of MOB_DATA_KEYS (packets.ts):
 *   baby, aggressive (zombie arms up / skeleton aiming / enderman creepy), color + sheared
 *   (sheep), swell_dir −1/1 + charged (creeper; the client advances swell 0..30 itself), saddle
 *   (pig), size 1/2/4 (slime), carried (enderman block state), hanging (bat), bow (skeleton).
 *   All keys of a mob are sent right after addEntity; afterwards only changed keys.
 *   Explosions: `explode { x, y, z, power, destroy }` (particles; the sound comes as `sound`).
 *   Right-click on a mob: client sends C2S `interactEntity { id, hand }` (breeding food, shears,
 *   bucket, saddle, flint and steel).
 *
 * Spawning: `addEntity { id, type, x, y, z, vx, vy, vz, data }` where `type` is the minecraft-data
 *   1.17.1 entity name ("zombie", "skeleton", "creeper", "spider", "pig", "cow", "sheep",
 *   "chicken", "husk", "stray", "drowned", "enderman", "slime", "squid", "bat", "arrow").
 *   `data`: for arrows the shooter's entity id (shared server/src/game/arrow.ts); 0 for mobs.
 *   Immediately after addEntity the server sends `mobData` (mobs only), `entityState` (fire
 *   flag) and `equipment` when the mob holds something (skeleton bow: mainHand = bow item id).
 * Movement: `entityMove { id, x, y, z, yaw, pitch, headYaw, onGround }` whenever position or
 *   rotation changes (interpolate over 3 ticks like players). `yaw` = entity yRot (the client derives body yaw like vanilla), head yaw =
 *   `headYaw`, pitch = head pitch, all in degrees (vanilla convention: yaw 0 faces +Z).
 *   Arrows: yaw/pitch follow the flight direction. `entityMotion` carries velocity (knockback).
 * Events: `entityEvent { id, event }` with vanilla ids:
 *   2 hurt (red flash + hurt sound on the client is optional; the server sends the sound),
 *   3 death (fall-over animation; the entity is removed 20 ticks later),
 *   10 sheep eats grass (head-down animation for 40 ticks),
 *   18 love-mode heart particles, 7/6 tame success/fail (unused yet),
 *   21 guardian/…; 60 death smoke poof (sent when a dead mob is removed).
 * Attack swing: `animate { id, action: 0 }` (zombies swing arms when they hit).
 */

/** Server-internal mob state bits (translated to mobData keys by MobManager.mobDataOf). */
export const MOB_FLAG = {
  /** baby (zombie / animals): render at the vanilla baby scale */
  BABY: 1,
  /** zombie arms raised (Mob.isAggressive) / skeleton drawing its bow / enderman screaming (creepy) */
  AGGRESSIVE: 2,
  /** sheep has been sheared */
  SHEARED: 4,
  /** creeper is swelling (swellDir = 1); the client advances swell 0..30 per tick itself (−1 otherwise) */
  SWELLING: 8,
  /** charged creeper (lightning) */
  POWERED: 16,
  /** creeper ignited with flint and steel */
  IGNITED: 32,
  /** spider climbing a wall */
  CLIMBING: 64,
  /** bat hanging upside down */
  RESTING: 128,
  /** zombie converting to drowned / husk converting to zombie (shake) */
  CONVERTING: 256,
  /** left-handed mob (mirror arm poses) */
  LEFT_HANDED: 512,
  /** pig is saddled */
  SADDLED: 1024,
  /** in love mode (breeding) */
  IN_LOVE: 2048,
  /** drawing a bow (LivingEntity.isUsingItem): animate the pull over 20 ticks from when it was set */
  USING_ITEM: 4096,
} as const;

/**
 * Server-internal variant per type:
 *   sheep → wool colour (vanilla DyeColor id 0 white … 15 black)
 *   slime → size (1, 2 or 4)
 *   enderman → carried block state id (0 = nothing)
 *   everything else → 0
 */
export type MobVariant = number;

/** Vanilla DyeColor order (sheep wool colours). */
export const DYE_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;

/** Vanilla entity event ids used by mobs. */
export const ENTITY_EVENT = {
  HURT: 2,
  DEATH: 3,
  ATTACK: 4,
  TAMING_FAILED: 6,
  TAMING_SUCCEEDED: 7,
  EAT_GRASS: 10,
  IN_LOVE_HEARTS: 18,
  POOF: 60,
} as const;
