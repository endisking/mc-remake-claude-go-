/**
 * Extension points for commands whose game systems live elsewhere (mobs, effects,
 * enchantments, structures). Other modules register into these at import time, e.g.
 *
 *   commandHooks.summon.set('zombie', (server, x, y, z) => new Zombie(server.nextEntityId++, ...));
 *   commandHooks.locate.set('village', (server, x, z) => findNearestVillage(...));
 */
import type { GameServer } from '../server';
import type { ServerEntity } from '../entity';
import type { Target } from './source';

/** Builds (and may already spawn) an entity at a position; `nbt` is the raw SNBT text or null. */
export type SummonHook = (server: GameServer, x: number, y: number, z: number, nbt: string | null) => ServerEntity | null;

/** Nearest structure start [x, z] from a block position (search radius is the hook's business). */
export type LocateHook = (server: GameServer, x: number, z: number) => [number, number] | null;

export interface CommandHooks {
  /** entity type (registry path, e.g. "zombie") → factory */
  summon: Map<string, SummonHook>;
  /** structure name (1.17.1 /locate literal, e.g. "village") → search */
  locate: Map<string, LocateHook>;
  /** MobEffect application: true when the effect was added/updated (LivingEntity.addEffect) */
  applyEffect: ((target: Target, effect: string, durationTicks: number, amplifier: number, showParticles: boolean) => boolean) | null;
  /** remove one effect (or every effect when null); true when something was removed */
  removeEffect: ((target: Target, effect: string | null) => boolean) | null;
  /** add an enchantment to the target's main-hand item; returns the vanilla failure kind or 'ok' */
  enchant: ((target: Target, enchantment: string, level: number) => 'ok' | 'entity' | 'itemless' | 'incompatible') | null;
}

export const commandHooks: CommandHooks = {
  summon: new Map(),
  locate: new Map(),
  applyEffect: null,
  removeEffect: null,
  enchant: null,
};

/** The 1.17.1 /locate structure names (StructureFeature registry). */
export const STRUCTURE_NAMES = [
  'bastion_remnant', 'buried_treasure', 'desert_pyramid', 'endcity', 'fortress', 'igloo', 'jungle_pyramid', 'mansion',
  'mineshaft', 'monument', 'nether_fossil', 'ocean_ruin', 'pillager_outpost', 'ruined_portal', 'shipwreck', 'stronghold',
  'swamp_hut', 'village',
];

/** Display names used in the /locate success message (vanilla uses the literal name). */
export function structureDisplay(name: string): string {
  return name;
}
