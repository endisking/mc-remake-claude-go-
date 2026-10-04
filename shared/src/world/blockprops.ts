/** Derived block behaviour flags (vanilla BlockBehaviour.Properties predicates). */
import { FULL_COLLISION } from './blockinfo';
import { blockNameOf } from './blockstate';

/**
 * isSuffocating / isViewBlocking: full collision cubes, except glass and leaves which opt out
 * (isSuffocating(never), isViewBlocking(never)).
 */
export function isSuffocating(state: number): boolean {
  if (FULL_COLLISION[state] !== 1) return false;
  const n = blockNameOf(state);
  return !(n === 'glass' || n === 'tinted_glass' || n.endsWith('_stained_glass') || n.endsWith('_leaves'));
}

export const isViewBlocking = isSuffocating;

/**
 * Blocks whose BlockState.use consumes a right click (so nothing is placed against them unless
 * sneaking with an item in hand). Grows as block interactions are implemented.
 */
export function isInteractive(state: number): boolean {
  return blockNameOf(state).endsWith('_bed');
}
