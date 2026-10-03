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
