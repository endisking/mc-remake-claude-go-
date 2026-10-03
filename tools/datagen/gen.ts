/**
 * Phase 0 data generator.
 *
 * Reads PrismarineJS minecraft-data (MIT) for Java Edition 1.17.1 and writes
 * compact JSON tables into /shared/src/data. These are *facts* about the game
 * (hardness, recipes, hitboxes, ...), not assets. Display strings are the plain
 * generic English names from minecraft-data, never Mojang lang files.
 *
 * Run: pnpm datagen
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');
const md = mcData('1.17.1');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'shared', 'src', 'data', 'generated');
mkdirSync(outDir, { recursive: true });

function write(name: string, value: unknown): void {
  const file = join(outDir, `${name}.json`);
  writeFileSync(file, JSON.stringify(value) + '\n');
  console.log(`wrote ${file}`);
}

// ---------------------------------------------------------------- blocks
const shapes = md.blockCollisionShapes;
write(
  'blocks',
  md.blocksArray.map((b: any) => ({
    id: b.id,
    name: b.name,
    displayName: b.displayName,
    hardness: b.hardness,
    resistance: b.resistance,
    stackSize: b.stackSize,
    diggable: b.diggable,
    material: b.material ?? 'default',
    transparent: b.transparent,
    emitLight: b.emitLight,
    filterLight: b.filterLight,
    defaultState: b.defaultState,
    minStateId: b.minStateId,
    maxStateId: b.maxStateId,
    states: b.states ?? [],
    harvestTools: b.harvestTools ? Object.keys(b.harvestTools).map(Number) : null,
    drops: b.drops ?? [],
    boundingBox: b.boundingBox,
    // collision shape ids: a single number for all states, or one per state
    shape: shapes.blocks[b.name] ?? 0,
  })),
);
write('collisionShapes', shapes.shapes);

// ---------------------------------------------------------------- items
write(
  'items',
  md.itemsArray.map((i: any) => ({
    id: i.id,
    name: i.name,
    displayName: i.displayName,
    stackSize: i.stackSize,
    maxDurability: i.maxDurability ?? 0,
    enchantCategories: i.enchantCategories ?? [],
    repairWith: i.repairWith ?? [],
  })),
);

write('foods', md.foodsArray);
write('materials', md.materials);

// ---------------------------------------------------------------- entities
write(
  'entities',
  md.entitiesArray.map((e: any) => ({
    id: e.id,
    name: e.name,
    displayName: e.displayName,
    width: e.width,
    height: e.height,
    type: e.type,
    category: e.category ?? null,
  })),
);

// ---------------------------------------------------------------- world
write('biomes', md.biomesArray);
write('tints', md.tints);

// ---------------------------------------------------------------- gameplay
write('enchantments', md.enchantmentsArray);
write('effects', md.effectsArray);
write('attributes', md.attributesArray);
write('instruments', md.instrumentsArray);
write('particles', md.particlesArray);
write('sounds', md.soundsArray);
write('blockLoot', md.blockLootArray);
write('entityLoot', md.entityLootArray);

// ---------------------------------------------------------------- recipes
// minecraft-data stores recipes keyed by result item id. Flatten to a list.
const recipes: unknown[] = [];
for (const [resultId, list] of Object.entries<any[]>(md.recipes)) {
  for (const r of list) {
    recipes.push({
      result: { id: r.result.id, count: r.result.count ?? 1 },
      inShape: r.inShape ?? null,
      outShape: r.outShape ?? null,
      ingredients: r.ingredients ?? null,
      resultKey: Number(resultId),
    });
  }
}
write('recipes', recipes);

// ---------------------------------------------------------------- summary
write('meta', {
  version: '1.17.1',
  source: 'PrismarineJS/minecraft-data ' + require('minecraft-data/package.json').version,
  counts: {
    blocks: md.blocksArray.length,
    blockStates: md.blocksArray.reduce((n: number, b: any) => Math.max(n, b.maxStateId + 1), 0),
    items: md.itemsArray.length,
    entities: md.entitiesArray.length,
    biomes: md.biomesArray.length,
    enchantments: md.enchantmentsArray.length,
    effects: md.effectsArray.length,
    recipes: recipes.length,
    sounds: md.soundsArray.length,
    particles: md.particlesArray.length,
  },
});
