/**
 * 1.17.1 world-generation data (game facts, like minecraft-data): per-biome feature lists by
 * decoration step, carvers, structure starts and spawns; configured features/carvers/structures;
 * block tags they reference. Source: the vanilla data-generator reports published by
 * misode/mcmeta (branch 1.17.1-data), cached in tools/cache/. Writes
 * shared/src/data/generated/worldgen.json. Structure templates (.nbt) are NOT used.
 *
 * Usage: pnpm tsx tools/datagen/worldgen.ts
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const cache = join(root, 'tools/cache/mcmeta-1.17.1');
if (!existsSync(join(cache, 'data'))) {
  mkdirSync(join(root, 'tools/cache'), { recursive: true });
  execSync(`git clone -q --depth 1 --branch 1.17.1-data --filter=blob:none --sparse https://github.com/misode/mcmeta.git ${cache}`, { stdio: 'inherit' });
  execSync('git sparse-checkout set data/minecraft/worldgen data/minecraft/tags/blocks', { cwd: cache, stdio: 'inherit' });
}
const wg = join(cache, 'data/minecraft/worldgen');
const readDir = (dir: string) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), 'utf8'))]));

const biomes: Record<string, unknown> = {};
for (const [name, b] of Object.entries(readDir(join(wg, 'biome')))) {
  biomes[name] = {
    category: b.category, precipitation: b.precipitation, temperature: b.temperature, temperature_modifier: b.temperature_modifier,
    downfall: b.downfall, depth: b.depth, scale: b.scale, surface_builder: b.surface_builder, carvers: b.carvers,
    features: b.features, starts: b.starts, spawners: b.spawners, spawn_costs: b.spawn_costs, player_spawn_friendly: b.player_spawn_friendly,
    creature_spawn_probability: b.creature_spawn_probability,
  };
}

// block tags (resolved, with nested #tags expanded)
const tagDir = join(cache, 'data/minecraft/tags/blocks');
const rawTags = readDir(tagDir) as Record<string, { values: string[] }>;
const tags: Record<string, string[]> = {};
const resolve = (name: string, seen = new Set<string>()): string[] => {
  if (tags[name]) return tags[name]!;
  if (seen.has(name)) return [];
  seen.add(name);
  const out = new Set<string>();
  for (const v of rawTags[name]?.values ?? []) {
    if (v.startsWith('#')) for (const x of resolve(v.slice(1).replace('minecraft:', ''), seen)) out.add(x);
    else out.add(v.replace('minecraft:', ''));
  }
  return (tags[name] = [...out].sort());
};
for (const t of Object.keys(rawTags)) resolve(t);

const out = {
  source: 'misode/mcmeta 1.17.1-data (vanilla data generator reports)',
  biomes,
  configured_features: readDir(join(wg, 'configured_feature')),
  configured_carvers: readDir(join(wg, 'configured_carver')),
  configured_structure_features: readDir(join(wg, 'configured_structure_feature')),
  configured_surface_builders: readDir(join(wg, 'configured_surface_builder')),
  noise_settings: readDir(join(wg, 'noise_settings')),
  block_tags: tags,
};
const file = join(root, 'shared/src/data/generated/worldgen.json');
writeFileSync(file, JSON.stringify(out));
console.log(`worldgen: ${Object.keys(biomes).length} biomes, ${Object.keys(out.configured_features).length} configured features, ${Object.keys(tags).length} block tags → ${file}`);
