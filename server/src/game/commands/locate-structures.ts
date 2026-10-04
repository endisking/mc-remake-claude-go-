/** Registers the overworld structure searches (shared/worldgen/structures) as /locate hooks. */
import { commandHooks } from './hooks';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { LOCATABLE_STRUCTURES, locateStructure } from '@shared/worldgen/structures/placement';

for (const name of LOCATABLE_STRUCTURES)
  commandHooks.locate.set(name, (server, x, z) => {
    const gen = server.generator;
    if (!(gen instanceof OverworldGenerator)) return null;
    const p = locateStructure(gen, name, x, z);
    return p ? [p.x, p.z] : null;
  });
