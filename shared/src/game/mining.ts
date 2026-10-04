/**
 * Block breaking speed (vanilla BlockBehaviour.getDestroyProgress + Player.getDestroySpeed).
 */
import { BLOCKS, MATERIALS, ITEMS_BY_ID } from '../data';
import { STATE_TO_BLOCK } from '../world/blockstate';

/** Blocks with hardness −1 (unbreakable in survival). minecraft-data reports 0 for some of them. */
const UNBREAKABLE = new Set([
  'bedrock', 'barrier', 'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw',
  'end_portal', 'end_portal_frame', 'end_gateway', 'moving_piston', 'light', 'nether_portal',
]);

export function hardness(state: number): number {
  const b = BLOCKS[STATE_TO_BLOCK[state]!]!;
  if (UNBREAKABLE.has(b.name)) return -1;
  return b.hardness ?? -1;
}

/** Tool speed multiplier of an item against a block (1 for the hand / wrong tool). */
export function toolSpeed(itemId: number, state: number): number {
  const b = BLOCKS[STATE_TO_BLOCK[state]!]!;
  let best = 1;
  for (const tag of b.material.split(';')) {
    const v = MATERIALS[tag]?.[String(itemId)];
    if (v !== undefined && v > best) best = v;
  }
  return best;
}

/** Whether the held item allows the block to drop items (requiresCorrectToolForDrops). */
export function canHarvest(itemId: number, state: number): boolean {
  const b = BLOCKS[STATE_TO_BLOCK[state]!]!;
  return !b.harvestTools || b.harvestTools.includes(itemId);
}

export interface MinerState {
  /** held item id (or air) */
  item: number;
  efficiency: number;
  haste: number; // amplifier + 1, 0 = none
  miningFatigue: number;
  underwater: boolean;
  aquaAffinity: boolean;
  onGround: boolean;
}

/** Player.getDestroySpeed. */
export function destroySpeed(m: MinerState, state: number): number {
  let f = toolSpeed(m.item, state);
  if (f > 1 && m.efficiency > 0) f += m.efficiency * m.efficiency + 1;
  if (m.haste > 0) f *= 1 + m.haste * 0.2;
  if (m.miningFatigue > 0) f *= [0.3, 0.09, 0.0027, 8.1e-4][Math.min(3, m.miningFatigue - 1)]!;
  if (m.underwater && !m.aquaAffinity) f /= 5;
  if (!m.onGround) f /= 5;
  return f;
}

/** Fraction of the block broken per tick (≥ 1 means instant). */
export function destroyProgress(m: MinerState, state: number): number {
  // BambooBlock / BambooSaplingBlock.getDestroyProgress: swords cut bamboo instantly
  const bn = BLOCKS[STATE_TO_BLOCK[state]!]!.name;
  if ((bn === 'bamboo' || bn === 'bamboo_sapling') && /_sword$/.test(ITEMS_BY_ID[m.item]?.name ?? '')) return 1;
  const h = hardness(state);
  if (h === -1) return 0;
  if (h === 0) return 1;
  const div = canHarvest(m.item, state) ? 30 : 100;
  return destroySpeed(m, state) / h / div;
}

/** Ticks needed to break a block (vanilla rounds progress accumulation per tick). */
export function ticksToBreak(m: MinerState, state: number): number {
  const p = destroyProgress(m, state);
  if (p <= 0) return Infinity;
  return Math.ceil(1 / p);
}

export function isItem(name: string, id: number): boolean {
  return ITEMS_BY_ID[id]?.name === name;
}
