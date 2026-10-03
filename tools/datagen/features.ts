/**
 * Generates FEATURES.md: one checkbox per block, item, mob, mechanic, screen and
 * sound event, grouped by phase. Re-running preserves existing [x] marks (matched
 * by the checkbox's ID tag `<!--id-->`), so the file can be regenerated safely.
 *
 * Run: pnpm tsx tools/datagen/features.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKS, ITEMS, ENTITIES, BIOMES, ENCHANTMENTS, EFFECTS, SOUND_EVENTS, RECIPES, PARTICLES,
} from '../../shared/src/data';
import { NOT_SURVIVAL_OBTAINABLE, NOT_NATURAL_MOBS } from './obtainability';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFile = join(root, 'FEATURES.md');

const done = new Set<string>();
if (existsSync(outFile)) {
  for (const line of readFileSync(outFile, 'utf8').split('\n')) {
    const m = /^\s*- \[x\] .*<!--([^>]+)-->\s*$/.exec(line);
    if (m) done.add(m[1]!);
  }
}

const out: string[] = [];
let total = 0;
let checked = 0;
function h(level: number, text: string): void {
  out.push('', `${'#'.repeat(level)} ${text}`, '');
}
function item(id: string, text: string): void {
  const isDone = done.has(id);
  total++;
  if (isDone) checked++;
  out.push(`- [${isDone ? 'x' : ' '}] ${text} <!--${id}-->`);
}
function list(prefix: string, entries: string[]): void {
  for (const e of entries) item(`${prefix}:${slug(e)}`, e);
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
const mark = (name: string) => (NOT_SURVIVAL_OBTAINABLE.has(name) ? ' ⊘' : '');

// ============================================================ Phase 0
h(2, 'Phase 0 — Research & data');
list('p0', [
  'pnpm monorepo (/client, /server, /shared, /tools) with Vite, TypeScript, Vitest, Playwright',
  'Typed 1.17.1 data tables in /shared/data (blocks, items, entities, biomes, enchantments, effects, recipes, foods, materials, loot, sounds, particles, tints)',
  'Block state palette codec (1.17.1 state ids, property encode/decode, state strings)',
  'FEATURES.md generated from minecraft-data with survival-obtainability marks',
  'PROGRESS.md, ASSET_SOURCES.md, NAMES.md created',
]);

// ============================================================ Phase 1
h(2, 'Phase 1 — Engine core');
h(3, 'Rendering');
list('p1', [
  'WebGL2 context, resize handling, device-pixel-ratio aware canvas',
  'Shader program system (compile, link, uniform cache)',
  '2D texture array for block textures with nearest filtering and mipmaps',
  'Chunk sections 16×16×16 with paletted storage',
  'Chunk column storage (world height 0–255, 16 sections)',
  'Chunk loading/unloading by render distance (spiral order)',
  'Meshing in Web Workers (worker pool, transferable buffers)',
  'Face culling between opaque neighbors, cross-section neighbor lookup',
  'Opaque / cutout / translucent render passes',
  'Translucent faces sorted back-to-front',
  'Frustum culling of chunk sections',
  'Cave/occlusion culling (section visibility graph flood fill)',
  'Incremental GPU mesh upload with per-frame budget',
  'Pooled vertex buffers; no per-frame allocations in render loop',
  'Block model system: own JSON format (cubes, per-face UVs, rotations, multipart)',
  'Models: full cube, slab, stairs (all shapes), fence, wall, pane, door, trapdoor, torch, rail, cross plant, crop, carpet, pressure plate, button, lever, ladder, vine, snow layers, farmland/path, cactus, fluid',
  'Biome tint (grass, foliage, water) via generated colormaps',
  'Animated textures (frame strips + timing metadata)',
  'Smooth lighting with ambient occlusion',
  'Flat lighting (smooth lighting off)',
  'Block outline box on targeted block',
  'Block crack overlay (10 stages)',
  'Fast / Fancy graphics (leaves opacity, etc.)',
  'Mipmap levels setting (0–4)',
]);
h(3, 'Lighting engine');
list('p1', [
  'Sky light propagation (0–15) with flood fill',
  'Block light propagation (0–15) with flood fill and removal',
  'Per-block light emission and opacity from data',
  'Light updates on block place/break across chunk borders',
]);
h(3, 'Textures');
list('p1', [
  'Deterministic texture generator /tools/texgen → /client/public/textures',
  'Palette + pixel-grid / seeded-noise texture DSL',
  'Grayscale grass/leaves/water + generated grass/foliage colormaps',
  'Ore texture builder (stone base + 2–4 px clusters)',
  'Animated textures: water, lava, fire, soul fire, nether portal, sea lantern, magma, prismarine, kelp, seagrass, etc.',
  'Texture overrides from /client/public/textures/overrides/',
  'Atlas viewer /tools/atlas-viewer.html (8× zoom)',
]);
h(3, 'Sky, fog, weather visuals');
list('p1', [
  '24000-tick day cycle driving sky color',
  'Sun and moon with 8 moon phases',
  'Stars',
  'Sunrise/sunset fog colors',
  'Clouds: off / fast / fancy',
  'Distance fog matched to render distance',
  'Biome-dependent sky and fog colors',
  'Rain particles and rain sheet rendering',
  'Snow rendering',
  'Thunderstorm darkening and lightning flashes',
  'Underwater fog and view',
  'Lava fog',
]);
h(3, 'Frame loop & settings basics');
list('p1', [
  'Fixed 20 TPS simulation loop with interpolated rendering',
  'Frame rate limit: VSync / 30 / 60 / 120 / Unlimited',
  'Render distance 2–32',
  'Simulation distance setting',
  'Entity distance setting',
  'FOV setting (default 70)',
  'Brightness (gamma) setting',
  'GUI scale setting',
  'View bobbing toggle',
  'Particles: all / decreased / minimal',
  'Settings persisted to localStorage',
  'Performance benchmark /tools/bench (avg FPS, 1% lows, chunk build time)',
  'F3 debug screen',
  'F1 hide HUD',
  'F11 fullscreen',
  'Pointer lock handling',
]);

// ============================================================ Phase 2
h(2, 'Phase 2 — Player');
h(3, 'Movement physics');
list('p2', [
  'Gravity 0.08 and vertical drag 0.98 per tick',
  'Ground friction from block slipperiness (0.6 default, ice 0.98, slime 0.8, blue ice 0.989)',
  'Air friction 0.91 and air acceleration',
  'Walking ≈4.317 m/s',
  'Sprinting ≈5.612 m/s, double-tap W, sprint key',
  'Sprint-jumping boost',
  'Sneaking (0.3× speed), stops at edges',
  'Jump height ≈1.25 blocks (jump velocity 0.42)',
  'Step-up 0.6 blocks',
  'Hitbox 0.6×1.8 (1.5 tall when sneaking), eye height 1.62 (1.27 sneaking)',
  'AABB collision against block collision shapes',
  'Swimming (sprint underwater) and 0.6-tall swim pose',
  'Crawling in 1-block gaps',
  'Water physics (drag 0.8, buoyancy, current push)',
  'Lava physics (drag 0.5)',
  'Ladders, vines, twisting/weeping vines, scaffolding climbing',
  'Soul sand slowdown, soul speed',
  'Honey block slowdown and slide',
  'Cobweb slowdown',
  'Sweet berry bush slowdown',
  'Powder snow sinking, freezing, leather boots walking',
  'Bubble columns (up/down)',
  'Slime block bounce',
  'Bed bounce',
  'Elytra flight physics and firework boost',
  'Creative flight (double-tap space), flying speed',
  'Spectator noclip flight',
]);
h(3, 'Camera & controls');
list('p2', [
  'First-person camera with mouse look and sensitivity setting',
  'Sprint FOV change, FOV effects (speed/slowness)',
  'View bobbing',
  'Hand sway and swing animation',
  'F5 three perspectives',
  'F3+B hitboxes',
  'Rebindable keys',
  'Scroll / number-key hotbar selection',
  'Q drop / Ctrl+Q drop stack',
  'F swap offhand',
  'Middle-click pick block',
  'Hurt camera tilt and red flash',
  'Hunger HUD shake',
  'First-person hand and held item rendering',
  'Nausea/portal screen wobble',
]);
h(3, 'Interaction');
list('p2', [
  'Block raycast targeting (reach 4.5 survival, 5 creative)',
  'Entity targeting (reach 3)',
  'Exact mining time: hardness, tool, tier, Efficiency, Haste, Mining Fatigue, underwater, airborne',
  'Block break particles',
  'Block placement (against faces, orientation rules)',
  'Item drops: pop out, spin, bob, merge, pickup delay',
  'XP orbs: fly to player, merge, values',
]);
h(3, 'Game modes');
list('p2', ['Survival', 'Creative', 'Adventure', 'Spectator']);
h(3, 'Health, food, XP');
list('p2', [
  'Health (20 HP) and HUD hearts (incl. absorption, poison, wither, frozen variants)',
  'Natural regeneration (saturation-based fast regen, food ≥18 slow regen)',
  'Hunger (food level), saturation, exhaustion values per action',
  'Starvation damage by difficulty',
  'Eating (32 ticks, particles, sounds)',
  'XP levels formula and XP bar',
  'Breathing / air bubbles / drowning',
  'Fall damage (incl. water, hay bale, slime, honey, bed, powder snow, feather falling)',
  'Fire and burning damage, extinguishing',
  'Lava damage',
  'Void damage',
  'Suffocation damage',
  'Cactus damage',
  'Sweet berry bush damage',
  'Magma block damage',
  'Freezing damage (powder snow)',
  'Lightning damage',
  'Damage immunity frames (10 ticks)',
]);
h(3, 'Beds, spawn, death');
list('p2', [
  'Beds: sleeping, skipping night, phantom reset, "You may not rest now"',
  'Bed explosion in Nether/End',
  'Spawn point setting and world spawn radius',
  'Death screen with score and respawn',
  'Dropped inventory and XP on death',
  'Death messages (all 1.17.1 variants, original text where needed)',
]);

// ============================================================ Phase 3
h(2, 'Phase 3 — World generation (1.17.1 rules, Y 0–255)');
h(3, 'Core');
list('p3', [
  'Seeded deterministic noise (Perlin octaves matching 1.17.1 structure)',
  '1.17.1 biome layer system (biome placement)',
  'Large biomes world type',
  'Amplified world type',
  'Superflat world type with presets',
  'Single biome (buffet) world type',
  'Terrain density generation (depth/scale per biome)',
  'Surface builders (grass/dirt, sand, gravel, badlands bands, mountains, swamp, etc.)',
  'Bedrock floor pattern (0–4)',
  'Sea level 63, oceans and rivers',
  'Cave carver',
  'Ravine (canyon) carver',
  'Underwater caves and underwater ravines',
  'Lakes (water and lava)',
  'Springs (water and lava)',
  'Ice and snow placement by temperature',
]);
h(3, 'Ores & underground (1.17.1 heights)');
list('p3', [
  'Coal ore', 'Iron ore', 'Gold ore (incl. badlands extra)', 'Redstone ore', 'Diamond ore', 'Lapis ore',
  'Emerald ore (mountains)', 'Copper ore', 'Deepslate layer (Y 0–16) and deepslate ore variants', 'Tuff blobs',
  'Dirt, gravel, granite, diorite, andesite blobs', 'Infested stone (mountains)', 'Amethyst geodes',
  'Glow lichen in caves', 'Fossils', 'Dungeons (monster rooms)', 'Dripstone clusters (rare, in caves)',
  'Nether quartz ore', 'Nether gold ore', 'Ancient debris', 'Magma, soul sand, gravel, blackstone blobs (Nether)',
]);
h(3, 'Overworld biomes');
for (const b of BIOMES.filter((x) => x.dimension === 'overworld')) {
  item(`biome:${b.name}`, `Biome: ${b.displayName} (\`${b.name}\`)`);
}
h(3, 'Trees & vegetation');
list('p3', [
  'Oak tree', 'Large (fancy) oak tree', 'Birch tree', 'Tall birch tree', 'Spruce tree', 'Pine tree',
  'Mega spruce tree', 'Mega pine tree', 'Jungle tree', 'Mega jungle tree', 'Jungle bush', 'Acacia tree',
  'Dark oak tree', 'Swamp oak tree (with vines)', 'Huge red mushroom', 'Huge brown mushroom', 'Azalea tree (bone meal only in 1.17.1)',
  'Bee nests on trees', 'Cocoa pods', 'Vines', 'Grass and ferns', 'Tall grass and large ferns', 'Flowers by biome',
  'Flower forest flowers', 'Sunflower plains', 'Sugar cane', 'Cacti', 'Pumpkins', 'Melons', 'Sweet berry bushes',
  'Lily pads', 'Dead bushes', 'Mushrooms', 'Bamboo and podzol', 'Kelp', 'Seagrass', 'Sea pickles', 'Coral reefs',
  'Icebergs', 'Blue ice', 'Ice spikes', 'Desert wells', 'Boulders (mossy cobblestone)', 'Pointed dripstone in caves',
]);
h(3, 'Overworld structures');
list('p3', [
  'Plains village', 'Desert village', 'Savanna village', 'Taiga village', 'Snowy village', 'Zombie village variants',
  'Desert pyramid', 'Jungle pyramid', 'Swamp hut', 'Igloo (with basement)', 'Shipwrecks', 'Ocean ruins (cold/warm)',
  'Ocean monument', 'Mineshafts (normal and badlands)', 'Strongholds (ring placement, End portal room)',
  'Woodland mansion', 'Pillager outpost', 'Ruined portals (all variants)', 'Buried treasure', 'Structure loot tables',
]);
h(3, 'Nether');
for (const b of BIOMES.filter((x) => x.dimension === 'the_nether')) {
  item(`biome:${b.name}`, `Biome: ${b.displayName} (\`${b.name}\`)`);
}
list('p3n', [
  'Nether terrain (Y 0–127, bedrock roof)', 'Lava ocean at Y 31', 'Nether fortresses', 'Bastion remnants (all 4 types)',
  'Nether ruined portals', 'Crimson/warped huge fungi', 'Glowstone clusters', 'Basalt pillars and deltas', 'Nether fires',
  'Weeping and twisting vines', 'Nether fossils',
]);
h(3, 'End');
for (const b of BIOMES.filter((x) => x.dimension === 'the_end')) {
  item(`biome:${b.name}`, `Biome: ${b.displayName} (\`${b.name}\`)`);
}
list('p3e', [
  'Main island', 'Obsidian pillars with crystals and cages', 'Outer islands', 'End cities', 'End ships with elytra',
  'End gateways', 'Chorus plants',
]);

// ============================================================ Phase 4
h(2, 'Phase 4 — Blocks & interaction');
h(3, 'Mechanics');
list('p4', [
  'Gravity blocks (sand, gravel, concrete powder, anvil, dragon egg, scaffolding, pointed dripstone)',
  'Water flow, sources, infinite sources', 'Lava flow (faster in Nether)', 'Waterlogging',
  'Lava + water → cobblestone / stone / obsidian', 'Basalt generator (lava + soul soil + blue ice)',
  'Random ticks (randomTickSpeed 3)', 'Crop growth (wheat, carrots, potatoes, beetroot, melon/pumpkin stems, nether wart)',
  'Saplings and tree growth', 'Bone meal on every applicable block', 'Grass and mycelium spread', 'Leaf decay',
  'Fire spread and burnout', 'Soul fire', 'TNT', 'Explosions (ray-based, resistance, drops)', 'Doors', 'Trapdoors', 'Fence gates',
  'Editable signs (and glowing ink, dyes)', 'Item frames and glow item frames', 'Paintings',
  'Copper oxidation', 'Copper waxing and scraping', 'Lightning rods', 'Amethyst growth', 'Pointed dripstone (growth, dripping, falling, damage)',
  'Powder snow', 'Candles and candle cakes', 'Cauldrons (water, lava, powder snow, dyeing, washing)', 'Composters',
  'Note blocks (all instruments by block below)', 'Jukebox and music discs', 'Beacons', 'Conduits', 'Respawn anchors',
  'Lodestones', 'Bells', 'Campfires (cooking, signal smoke, damage)', 'Beehives and bee nests', 'Chests and double chests',
  'Ender chests', 'Shulker boxes', 'Barrels', 'Snow layers', 'Ice melting and frosted ice', 'Sugar cane, cactus, bamboo, kelp growth',
  'Vines growth', 'Chorus growth', 'Farmland trampling and hydration', 'Coral death outside water', 'Sponge absorption',
  'Turtle eggs', 'Sculk sensor (creative-only in 1.17.1)', 'Big dripleaf tilting', 'Scaffolding', 'Flower pots', 'Banners on blocks',
  'Mob heads', 'End portal frames and eyes', 'Nether portal block behavior', 'Spawners',
]);
h(3, 'Redstone (exact)');
list('p4r', [
  'Redstone dust: signal strength and decay', 'Redstone dust: connection shapes and dot/line toggle',
  'Redstone torches (incl. burnout)', 'Repeaters (delay 1–4, locking)', 'Comparators (compare/subtract, container levels, other inputs)',
  'Pistons (12-block push limit)', 'Sticky pistons', 'Quasi-connectivity', 'Block dropping / spitting', 'Slime and honey block movement',
  'Immovable and breakable blocks for pistons', 'Observers', 'Hoppers', 'Droppers', 'Dispensers (every behavior)',
  'Rails', 'Powered rails', 'Detector rails', 'Activator rails', 'Daylight sensors', 'Target blocks', 'Tripwire and hooks',
  'Pressure plates (all types, weighted)', 'Buttons (stone/wood/polished blackstone)', 'Levers', 'Redstone lamps', 'Trapped chests',
  'Lecterns', 'Note block triggering', 'Doors/trapdoors/fence gates powered', 'TNT ignition', 'Lightning rod output',
  'Sculk sensor output', 'Correct tick delays and update order (block events, scheduled ticks)',
  'Contraption tests: clocks', 'Contraption tests: T flip-flop', 'Contraption tests: piston doors', 'Contraption tests: item sorter',
]);
h(3, 'Blocks (every 1.17.1 block; ⊘ = exists but not obtainable in survival)');
for (const b of BLOCKS) {
  if (b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air') continue;
  item(`block:${b.name}`, `${b.displayName} (\`${b.name}\`)${mark(b.name)}`);
}

// ============================================================ Phase 5
h(2, 'Phase 5 — Items, inventory, crafting');
h(3, 'Inventory & screens');
list('p5', [
  'Player inventory screen (2×2 crafting, armor, offhand)', 'Shift-click quick move', 'Click-drag splitting (left and right)',
  'Right-click halves / place one', 'Number-key hotbar swaps', 'Double-click collect', 'Drop outside window', 'Offhand slot',
  'Creative inventory with tabs', 'Creative search', 'Creative survival-inventory tab and destroy-item slot', 'Hotbar saving (creative)',
  'Crafting table', 'Furnace', 'Blast furnace', 'Smoker', 'Campfire cooking', 'Stonecutter', 'Smithing table (netherite upgrades)',
  'Loom (banner patterns)', 'Cartography table', 'Grindstone', 'Anvil (repair, combine, rename, XP cost, prior-work penalty, Too Expensive!)',
  'Enchanting table screen', 'Brewing stand screen', 'Chest / double chest / barrel / shulker screens', 'Hopper screen', 'Dispenser/dropper screen',
  'Beacon screen', 'Horse / llama inventory', 'Villager trading screen', 'Lectern book screen', 'Book and quill editing', 'Recipe book',
  'Durability and item breaking', 'Fuel values', 'Smelting recipes (furnace, blast furnace, smoker, campfire) with XP',
  'Stonecutting recipes', 'Special recipes (dyeing, banners, fireworks, maps, books, shields, suspicious stew, tipped arrows, repair)',
  'Maps (filling, zooming, locking, markers, banners)', 'Compass', 'Lodestone compass', 'Clock', 'Spyglass',
  'Fishing (bobber physics, bite timing, loot tables, Luck of the Sea, Lure)', 'Bundle (1.17.1: exists, not obtainable in survival)',
  'Bows and arrows', 'Food eating effects', 'Tooltips (names, enchantments, durability, lore)',
]);
h(3, 'Items (every 1.17.1 non-block item)');
const blockNames = new Set(BLOCKS.map((b) => b.name));
for (const i of ITEMS) {
  if (blockNames.has(i.name)) continue;
  item(`item:${i.name}`, `${i.displayName} (\`${i.name}\`)${mark(i.name)}`);
}
h(3, 'Crafting recipes (per result item)');
const itemById = new Map(ITEMS.map((i) => [i.id, i]));
const resultIds = [...new Set(RECIPES.map((r) => r.result.id))].sort((a, b) => a - b);
for (const id of resultIds) {
  const it = itemById.get(id);
  if (it) item(`recipe:${it.name}`, `Recipe → ${it.displayName}`);
}

// ============================================================ Phase 6
h(2, 'Phase 6 — Mobs & AI');
h(3, 'Systems');
list('p6', [
  'Entity system (server-side ticking, interpolation client-side)', 'Mob model/animation system matching vanilla body-part layout',
  'Pathfinding: walking', 'Pathfinding: swimming', 'Pathfinding: flying', 'Pathfinding: climbing', 'Goal-based AI framework',
  'Natural spawning: light levels', 'Natural spawning: biome rules', 'Natural spawning: structure rules (fortress, monument, witch hut, outpost)',
  'Mob caps per category', 'Despawning (instant 128, random 32+)', 'Spawners', 'Raids (waves by difficulty, Bad Omen, Hero of the Village)',
  'Patrols', 'Phantoms (insomnia)', 'Slime chunks', 'Zombie sieges', 'Fleeing / panic', 'Tempting with food', 'Breeding and baby mobs',
  'Taming', 'Sitting / following owner', 'Hunting', 'Door opening / breaking', 'Avoiding sunlight / burning in daylight',
  'Picking up items', 'Wearing armor and equipment chances', 'Mob drops with Looting', 'Riding: horses/donkeys/mules (taming, saddles, chests, jump strength)',
  'Riding: pigs + carrot on a stick', 'Riding: striders + warped fungus on a stick', 'Boats', 'Minecarts (all types)', 'Leads',
  'Villager professions by workstation', 'Villager levels and trade tables (1.17.1)', 'Villager restocking', 'Gossip/reputation',
  'Curing zombie villagers', 'Iron golem spawning by villagers', 'Villager beds and schedules', 'Villager breeding', 'Wandering trader and llamas',
  'Piglin bartering and gold rules', 'Wither boss (summoning, phases, skulls, boss bar)', 'Ender Dragon (fight, crystals, perching, breath, egg, exit portal, gateways, respawning)',
  'Name tags', 'Mob sounds (ambient/hurt/death/step)', 'Mob death animation and particles', 'Mob hurt red tint',
]);
h(3, 'Mobs (every 1.17.1 mob; ⊘ = does not spawn naturally)');
for (const e of ENTITIES) {
  if (!['animal', 'ambient', 'hostile', 'water_creature', 'mob', 'passive'].includes(e.type)) continue;
  item(`mob:${e.name}`, `${e.displayName} (\`${e.name}\`, ${e.width}×${e.height})${NOT_NATURAL_MOBS.has(e.name) ? ' ⊘' : ''}`);
}
h(3, 'Other entities');
for (const e of ENTITIES) {
  if (['animal', 'ambient', 'hostile', 'water_creature', 'mob', 'passive', 'player'].includes(e.type)) continue;
  item(`entity:${e.name}`, `${e.displayName} (\`${e.name}\`)`);
}

// ============================================================ Phase 7
h(2, 'Phase 7 — Combat, enchanting, brewing, effects');
h(3, 'Combat');
list('p7', [
  'Attack cooldown and indicator', 'Attack damage per weapon (1.9+ values)', 'Sweep attacks', 'Critical hits', 'Knockback (and sprint knockback)',
  'Shields: blocking', 'Shields: disabled by axes', 'Armor points formula', 'Armor toughness formula', 'Protection enchantment EPF',
  'Invulnerability frames', 'Bows (charge, power, crits)', 'Crossbows (charging, multishot, piercing, fireworks)',
  'Tridents (throw, Loyalty, Riptide, Channeling, Impaling)', 'Totem of Undying', 'PvP damage', 'Difficulty scaling of mob damage',
]);
h(3, 'Enchanting');
list('p7', [
  'Enchanting table bookshelf counting', 'Exact 1.17.1 enchantment selection algorithm', 'Enchanted books', 'Treasure-only enchantments', 'Curses',
  'Enchantment glint rendering', 'Lapis cost and XP level cost',
]);
for (const e of ENCHANTMENTS) item(`ench:${e.name}`, `Enchantment: ${e.displayName} (max ${e.maxLevel})${e.treasureOnly ? ' [treasure]' : ''}${e.curse ? ' [curse]' : ''}`);
h(3, 'Brewing & effects');
list('p7', [
  'Brewing stand (blaze powder fuel, 400-tick brew)', 'Every potion recipe (base, extended, enhanced, corrupted)', 'Splash potions', 'Lingering potions',
  'Tipped arrows', 'Status effect HUD icons and inventory list', 'Effect particles (ambient for beacons)', 'Milk clears effects',
  'Beacon effects', 'Conduit power and attack', 'Suspicious stew effects',
]);
for (const e of EFFECTS) item(`effect:${e.name}`, `Effect: ${e.displayName}`);
h(3, 'Advancements (full 1.17.1 tree)');
list('adv', ADVANCEMENTS());

// ============================================================ Phase 8
h(2, 'Phase 8 — Dimensions');
list('p8', [
  'Nether portals: any frame size (2×3 to 21×21)', 'Portal linking with 8:1 coordinate scaling', 'Portal search radius (128 overworld / 16 nether)',
  'Portal creation when no link', 'Portal travel delay and nausea overlay', 'End portals in strongholds', 'Eyes of Ender (flight, shatter chance)',
  'End gateways (teleport to outer islands)', 'End exit portal and credits', 'Credits / poem screen (original text)', 'Nether sky and fog by biome',
  'End sky', 'Dimension-specific music and ambience', 'Bed/respawn anchor dimension rules', 'Compass/clock behavior per dimension',
]);

// ============================================================ Phase 9
h(2, 'Phase 9 — Multiplayer');
list('p9', [
  'Binary protocol in /shared/protocol', 'Dedicated Node.js server over WebSocket (wss on 443)', 'Join with URL + room code',
  'Open-to-LAN style browser hosting over WebRTC data channels', 'Signaling server', 'Authoritative server, client prediction and reconciliation',
  'Entity sync and interpolation', 'Block update sync', 'Chunk streaming', 'Player list (Tab)', 'Chat', 'Nameplates', 'Skins (defaults + upload)',
  'PvP toggle', 'Ops / permissions', 'Whitelist', 'Kick / ban', 'Spawn protection (off by default)', 'Per-player inventories and spawns',
  'Saves: region-like format', 'Saves: IndexedDB for single-player', 'Saves: disk for dedicated server', 'Autosave every 5 minutes', 'World export/import as zip',
]);
h(3, 'Commands');
list('cmd', [
  '/gamemode', '/tp', '/give', '/time', '/weather', '/gamerule', '/difficulty', '/seed', '/kill', '/effect', '/enchant', '/summon', '/setblock',
  '/fill', '/clone', '/locate', '/spawnpoint', '/setworldspawn', '/xp', '/help', '/me', '/msg (/tell, /w)', '/list', '/op', '/deop', '/kick',
  '/ban', '/pardon', '/whitelist', '/clear', '/say', 'Target selectors (@p @a @r @s @e with arguments)', 'Relative and local coordinates (~ ^)',
]);
h(3, 'Gamerules (all 1.17.1)');
list('gamerule', [
  'announceAdvancements', 'commandBlockOutput', 'disableElytraMovementCheck', 'disableRaids', 'doDaylightCycle', 'doEntityDrops', 'doFireTick',
  'doImmediateRespawn', 'doInsomnia', 'doLimitedCrafting', 'doMobLoot', 'doMobSpawning', 'doPatrolSpawning', 'doTileDrops', 'doTraderSpawning',
  'doWeatherCycle', 'drowningDamage', 'fallDamage', 'fireDamage', 'forgiveDeadPlayers', 'freezeDamage', 'keepInventory', 'logAdminCommands',
  'maxCommandChainLength', 'maxEntityCramming', 'mobGriefing', 'naturalRegeneration', 'playersSleepingPercentage', 'randomTickSpeed',
  'reducedDebugInfo', 'sendCommandFeedback', 'showDeathMessages', 'spawnRadius', 'spectatorsGenerateChunks', 'universalAnger',
]);

// ============================================================ Phase 10
h(2, 'Phase 10 — Audio');
list('p10', [
  'Sound engine (Web Audio buffers, pooled sources)', 'Positional 3D audio with vanilla-like linear attenuation (16 blocks default)',
  'Randomized pitch/volume variants per event', 'Volume sliders: master, music, jukebox/note blocks, weather, blocks, hostile, friendly, players, ambient, voice',
  'Music rules: random delay between tracks', 'Music sets: menu, overworld (game), creative, underwater, Nether biomes, End, boss fight, credits',
  'Cave ambience (mood)', 'Underwater muffling and ambience', 'Nether biome mood loops and additions', 'Subtitles',
  'Block sound groups (step/place/break/hit/fall) for every group',
]);
h(3, 'Sound events (every 1.17.1 sound event)');
for (const s of SOUND_EVENTS) item(`sound:${s.name}`, `\`${s.name}\``);
h(3, 'Particles (every 1.17.1 particle type)');
for (const p of PARTICLES) item(`particle:${p.name}`, `\`${p.name}\``);

// ============================================================ Phase 11
h(2, 'Phase 11 — Menus & polish');
list('p11', [
  'Title screen with rotating panorama from our own world', 'Random splash text (original lines)', 'Single-player world list',
  'Create world: name, seed, game mode, difficulty, world type (default/superflat/large biomes/amplified), cheats toggle', 'Edit/delete/re-create world',
  'Multiplayer server list (add/edit/remove, ping)', 'Options screen', 'Video settings screen', 'Controls screen with rebinding', 'Mouse settings',
  'Sound settings screen', 'Accessibility settings', 'Chat settings', 'Skin customization screen (skin layers, main hand)', 'Language file system (English first)',
  'Pause menu', 'Statistics screen (general, items, mobs)', 'Advancements screen', 'Loading / generating world screen', 'Saving screen', 'Toasts (advancements, recipes, tutorial)',
  'Subtitles option', 'Screenshots (F2)', 'Original pixel font', 'Player skins: original default skins', 'Player skin upload',
]);

// ============================================================ Feel pass
h(2, 'Final feel pass (§7)');
list('feel', [
  'Movement feel', 'Mining speed', 'Combat timing', 'Mob behavior', 'Sound timing and variety', 'UI click/drag behavior', 'Lighting', 'Sky colors',
  'Fog', 'Water/lava look', 'Day/night pacing',
]);

function ADVANCEMENTS(): string[] {
  return [
    // Minecraft (story)
    'Minecraft', 'Stone Age', 'Getting an Upgrade', 'Acquire Hardware', 'Suit Up', 'Hot Stuff', "Isn't It Iron Pick?", 'Not Today, Thank You',
    'Ice Bucket Challenge', 'Diamonds!', 'We Need to Go Deeper', 'Cover Me with Diamonds', 'Enchanter', 'Zombie Doctor', 'Eye Spy', 'The End?',
    // Nether
    'Nether', 'Return to Sender', 'Those Were the Days', 'Hidden in the Depths', 'Subspace Bubble', 'A Terrible Fortress', 'Who is Cutting Onions?',
    'Oh Shiny', 'This Boat Has Legs', 'Uneasy Alliance', 'War Pigs', 'Cover Me in Debris', 'Spooky Scary Skeleton', 'Into Fire', 'Not Quite "Nine" Lives',
    'Hot Tourist Destinations', 'Withering Heights', 'Local Brewery', 'Bring Home the Beacon', 'A Furious Cocktail', 'Beaconator', 'How Did We Get Here?',
    // The End
    'The End', 'Free the End', 'The Next Generation', 'Remote Getaway', 'The End... Again...', 'You Need a Mint', 'The City at the End of the Game',
    "Sky's the Limit", 'Great View From Up Here',
    // Adventure
    'Adventure', 'Voluntary Exile', 'Country Lode, Take Me Home', 'Is It a Bird?', 'Monster Hunter', 'What a Deal!', 'Sticky Situation', "Ol' Betsy",
    'Surge Protector', 'Sweet Dreams', 'Hero of the Village', 'Is It a Balloon?', 'A Throwaway Joke', 'Take Aim', 'Monsters Hunted', 'Postmortal',
    'Hired Help', 'Two Birds, One Arrow', "Who's the Pillager Now?", 'Arbalistic', 'Adventuring Time', 'Light as a Rabbit', 'Is It a Plane?',
    'Very Very Frightening', 'Sniper Duel', 'Bullseye',
    // Husbandry
    'Husbandry', 'Bee Our Guest', 'The Parrots and the Bats', 'Whatever Floats Your Goat!', 'Best Friends Forever', 'Glow and Behold!', 'Fishy Business',
    'Total Beelocation', 'A Seedy Place', 'Wax On', 'Two by Two', 'A Complete Catalogue', 'Tactical Fishing', 'A Balanced Diet', 'Serious Dedication',
    'Wax Off', 'The Cutest Predator', 'The Healing Power of Friendship!',
  ];
}

const header = [
  '# FEATURES — Blockcraft (Minecraft Java Edition 1.17.1 parity)',
  '',
  'Generated by `tools/datagen/features.ts` from minecraft-data 1.17.1 plus hand-written mechanic lists.',
  'Re-running the generator keeps existing `[x]` marks. Work top to bottom: phases are in priority order.',
  '',
  '- `⊘` = exists in 1.17.1 but is **not obtainable in survival** (blocks/items) or **does not spawn naturally** (mobs).',
  '- Every checkbox follows the Definition of Done in CLAUDE.md §6.',
  '',
  `**Progress: ${checked} / ${total}**`,
];
writeFileSync(outFile, header.concat(out).join('\n') + '\n');
console.log(`FEATURES.md: ${checked}/${total} checked`);
