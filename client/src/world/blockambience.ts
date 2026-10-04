/**
 * Sound part of Block.animateTick (vanilla 1.17.1) for the random cells ClientLevel.animateTick
 * visits each tick: fire crackle, lit furnace / blast furnace / smoker, campfires, candles, nether
 * portal hum and bubble columns. Particles are handled elsewhere (or not yet).
 */
import type { JavaRandom } from '@shared/util/random';
import { blockNameOf, getProp } from '@shared/world/blockstate';
import { BLOCK_STATE_COUNT } from '@shared/data';
import type { PlayBlockSound } from './fluidambience';

const enum Kind {
  None = 0,
  Fire,
  Furnace,
  BlastFurnace,
  Smoker,
  Campfire,
  Candle,
  Portal,
  BubbleColumn,
}

/** per state: what (if anything) its animateTick plays; lit-only blocks are only tagged when lit */
const KIND = new Uint8Array(BLOCK_STATE_COUNT);
for (let s = 0; s < BLOCK_STATE_COUNT; s++) {
  const n = blockNameOf(s);
  const lit = getProp(s, 'lit') === true || getProp(s, 'lit') === 'true';
  if (n === 'fire' || n === 'soul_fire') KIND[s] = Kind.Fire;
  else if (n === 'furnace' && lit) KIND[s] = Kind.Furnace;
  else if (n === 'blast_furnace' && lit) KIND[s] = Kind.BlastFurnace;
  else if (n === 'smoker' && lit) KIND[s] = Kind.Smoker;
  else if ((n === 'campfire' || n === 'soul_campfire') && lit) KIND[s] = Kind.Campfire;
  else if ((n === 'candle' || n.endsWith('_candle') || n.endsWith('candle_cake')) && lit) KIND[s] = Kind.Candle;
  else if (n === 'nether_portal') KIND[s] = Kind.Portal;
  else if (n === 'bubble_column') KIND[s] = Kind.BubbleColumn;
}

export function hasBlockAmbience(state: number): boolean {
  return KIND[state] !== Kind.None;
}

export function animateBlockSound(state: number, x: number, y: number, z: number, r: JavaRandom, play: PlayBlockSound): void {
  switch (KIND[state]) {
    case Kind.Fire: // BaseFireBlock.animateTick
      if (r.nextInt(24) === 0) play('block.fire.ambient', x + 0.5, y + 0.5, z + 0.5, 1 + r.nextFloat(), r.nextFloat() * 0.7 + 0.3);
      break;
    case Kind.Furnace: // FurnaceBlock.animateTick
      if (r.nextDouble() < 0.1) play('block.furnace.fire_crackle', x + 0.5, y, z + 0.5, 1, 1);
      break;
    case Kind.BlastFurnace:
      if (r.nextDouble() < 0.1) play('block.blastfurnace.fire_crackle', x + 0.5, y, z + 0.5, 1, 1);
      break;
    case Kind.Smoker:
      if (r.nextDouble() < 0.1) play('block.smoker.smoke', x + 0.5, y, z + 0.5, 1, 1);
      break;
    case Kind.Campfire: // CampfireBlock.animateTick
      if (r.nextInt(10) === 0) play('block.campfire.crackle', x + 0.5, y + 0.5, z + 0.5, 0.5 + r.nextFloat(), r.nextFloat() * 0.7 + 0.6);
      break;
    case Kind.Candle: {
      // AbstractCandleBlock.addParticlesAndSound (one flame per block here)
      const f = r.nextFloat();
      if (f < 0.17) play('block.candle.ambient', x + 0.5, y + 0.5, z + 0.5, 1 + r.nextFloat(), r.nextFloat() * 0.7 + 0.3);
      break;
    }
    case Kind.Portal: // NetherPortalBlock.animateTick
      if (r.nextInt(100) === 0) play('block.portal.ambient', x + 0.5, y + 0.5, z + 0.5, 0.5, r.nextFloat() * 0.4 + 0.8);
      break;
    case Kind.BubbleColumn: {
      // BubbleColumnBlock.animateTick
      const down = getProp(state, 'drag') === true || getProp(state, 'drag') === 'true';
      if (r.nextInt(200) === 0) {
        play(down ? 'block.bubble_column.whirlpool_ambient' : 'block.bubble_column.upwards_ambient', x, y, z, 0.2 + r.nextFloat() * 0.2, 0.9 + r.nextFloat() * 0.15);
      }
      break;
    }
  }
}
