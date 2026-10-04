# PROGRESS — Blockcraft

Work loop: see `CLAUDE.md` §0. Each entry: what was done, deviations from vanilla 1.17.1, what's next.

## Missing sounds

Every event the game currently plays has real CC0 audio (`tools/soundgen/missing.txt` lists hooked events that
are still silent — currently none). Stand-ins that should get dedicated recordings later:
- 1.17 block groups without their own recordings reuse stone/grass/gravel/cloth clips at different pitches
  (deepslate, tuff, calcite, dripstone, amethyst, copper, nether blocks, moss, azalea, dripleaf, sculk…).
- All player hurt variants (`hurt_on_fire`, `hurt_drown`, `hurt_sweet_berry_bush`, `hurt_freeze`) and `death` share
  the two "oof" clips; vanilla has distinct burn/drown/berry sounds.
- Metal, glass (step/place), anvil, lantern and chain use pitched stone clips — this mirrors vanilla, which also
  builds these groups from the stone sounds.
- Not yet hooked (later features): every mob, item use, containers, redstone, ambience, music.

## Known gaps vs vanilla

- Block outline draws every box of a shape; vanilla merges edges of multi-box shapes (stairs show an inner edge).
- Weighted random model variants (e.g. grass block top rotation) use our own position hash, not vanilla's exact
  per-position random, so a given block may show a different rotation than in vanilla (purely cosmetic).
- Fluid surfaces use our implementation of the vanilla corner-height averaging; flow texture rotation is derived
  from the height gradient instead of the server flow vector.
- minecraft-data's `blockLoot` is lossy (halves silk-touch alternatives, ignores leaf/grass chance conditions), so
  block drops use each block's default drop item plus curated rules from minecraft.wiki (`shared/src/game/loot.ts`).
  Fortune, explosion decay and table-driven structure loot are not modelled yet.
- Chunk storage keeps flat 16-bit arrays per non-empty section (empty sections store nothing); palette compression
  is used only on the wire and in saves.
- F3+F4 (game mode switcher) waits for item textures (its icons are a sword, map and ender eye); F3+L (profiler
  capture) is not implemented. F3+I asks no server query yet: no block entities exist, so the answer would match.
- Spectators: mob view shaders (creeper/spider/enderman) and view-only containers arrive with mobs and containers.

## Benchmarks

| Date | Phase | Avg FPS | 1% low | Chunk build (ms) | Notes |
|---|---|---|---|---|---|
| 2026-10-03 | 1 | 9.3 | 4.6 | 0.50 | RD 6, 1280×720, SwiftShader (software GL in the CI container). JS CPU per frame 2.2 ms, 304 visible sections. |
| 2026-10-04 | 2 | 8.9 | 5.0 | 0.43 | Same setup. JS CPU per frame 2.07 ms (down from 2.2); the frame rate is bound by SwiftShader fill rate. |

---

## 2026-10-03 — Phase 0: research & data

Done:
- pnpm monorepo: `/client` (Vite), `/server`, `/shared`, `/tools`. TypeScript everywhere, Vitest for logic,
  Playwright 1.56 against the preinstalled Chromium.
- `tools/datagen/gen.ts` writes typed 1.17.1 tables (minecraft-data 3.117.0, MIT) into
  `shared/src/data/generated`: 898 blocks, 20342 block states, 1099 items, 113 entities, 81 biomes,
  38 enchantments, 32 effects, 1297 crafting recipes, 40 foods, 1190 sound events, 89 particles,
  block/entity loot, collision shapes, tints. `shared/src/data/index.ts` gives typed access.
- `shared/src/world/blockstate.ts`: global block-state palette codec using the vanilla 1.17.1 state ids
  (encode/decode properties, `withProp`, state strings). Tested.
- `tools/datagen/features.ts` generates `FEATURES.md` (4140 checkboxes) and preserves checked boxes on
  regeneration. `tools/datagen/obtainability.ts` lists things not obtainable in survival in 1.17.1,
  curated from minecraft.wiki History sections.
- `ASSET_SOURCES.md`, `NAMES.md` created.

Decisions / deviations:
- minecraft-data has no mob health/damage/speed, smelting/stonecutting recipes, structure loot or
  advancements. Those get curated from minecraft.wiki when their phase comes up.
- The advancement list (93 entries) was curated from the wiki's advancement table, dropping
  anything added in 1.18+ ("Feels Like Home", "Caves & Cliffs", "Star Trader", "Sound of Music", and
  all 1.19+ ones).
- 1.17.1 facts that matter later: lush caves and dripstone caves do **not** generate naturally;
  deepslate and tuff only as blobs at Y 0–16; copper ore 0–96; bundles and sculk sensors not obtainable.
- Invented brand-character names are renamed (see `NAMES.md`); mechanics unchanged.

Next: Phase 1 — WebGL2 renderer, chunk storage, meshing workers, lighting, texture generator.

## 2026-10-03 — Phase 1: engine core (in progress)

Done (each verified with unit tests and/or Playwright screenshots in `tools/bench/out/shots/`):
- Light engine (`shared/src/world/light.ts`): sky + block light flood fill and removal, vanilla rules (15 straight
  down, max(1, opacity) loss, shape occlusion for slabs/stairs/snow). Test: random edits match a full recompute.
- Binary protocol (`shared/src/protocol`), paletted chunk codec, integrated server in a Web Worker
  (`client/src/server.worker.ts`) running `server/src/game/server.ts` at 20 TPS with a weather cycle.
- Texture generator (`tools/texgen`, 119 textures, animated strips incl. water, lava, fire, soul fire, portal, sea
  lantern, magma, prismarine, kelp, seagrass), generated colormaps, atlas viewer (`pnpm atlas`).
  Second texture pass after feedback: grainy pixel noise instead of smooth blobs, new lava, rounded cobblestone,
  bigger shaded ore clusters, rippled water, wobbly log rings, leafier leaves, thin grass blades.
- Model system: own JSON format (`client/src/models/format.ts`), base library (cubes, cross plants, torches,
  slabs, stairs, fences, walls, panes, doors, trapdoors, rails, ladders, vines, crops, carpets, plates, buttons,
  levers, snow layers, cactus, farmland), blockstate variants + multipart, baking with element/state rotations and
  uvlock.
- Mesher in workers: culling incl. border cells, solid/cutout/translucent passes, vanilla AO + smooth lighting,
  biome tint blending, fluids (corner heights, flow textures), cave-culling visibility graph.
- WebGL2 renderer: texture array with alpha-aware mipmaps, vanilla lightmap formula, frustum + cave culling,
  translucent back-to-front sorting, sky (sky/fog colour formulas, sunrise fan, sun, 8 moon phases, stars), clouds
  (fast/fancy), rain/snow sheets, block outline (screen-space lines), crack overlay.
- GUI layer: original bitmap font (`tools/fontgen`), vanilla GUI scale, buttons/sliders, pause menu, Options, Video
  Settings; F3 debug screen with targeted block state; F1, F11.
- Benchmark tool (`pnpm bench`), screenshot runner (`tools/shots.ts`), contact sheets (`tools/contact.ts`).
- Multiplayer groundwork pulled forward at the user's request (LAN is a priority): Node dedicated server with
  WebSocket rooms + static hosting (`pnpm server`), WebRTC "Open to LAN" host/guest transports with a signaling
  relay, tested with two in-process clients and a real WebSocket client.

Deviations / notes:
- The dev terrain (`shared/src/worldgen/devgen.ts`) is a stand-in until the Phase 3 generator.
- Showcase scene `?scene=models` places one of every model shape for visual checks.

Remaining Phase 1: pooled buffers in all render paths, texture override verification, snow check in a cold biome,
lightning flashes, simulation/entity distance, view bobbing, particle setting (the last few depend on Phase 2).

## 2026-10-03 — Phase 1 wrap-up and Phase 2: player

Done (verified with unit/server tests and Playwright screenshots — `tools/e2e/interact.ts`, `survival.ts`,
`environment.ts`, `sounds.ts`, `tools/shots.ts hand*`):
- Interaction (client `Interaction` ≈ vanilla `MultiPlayerGameMode`): survival digging with progress, crack stages
  and crack particles every tick, creative instant break, placement prediction, pick block (vanilla creative
  `setPickedItem` / survival `pickSlot` swap), Q / Ctrl+Q, number keys and scroll, miss-swing cooldown.
- Rendering: terrain break particles, dropped items (bob/spin/stack copies/pickup fly-in), 3D block items and
  extruded flat item sprites (ItemModelGenerator), GUI item icon atlas, first-person hand and held block with the
  vanilla ItemInHandRenderer transforms (equip dip, swing, view-lag sway), other players' crack overlays.
- HUD (vanilla `Gui`): hotbar with icons and counts, selected item name fade, hearts (blink, low-health shake,
  regen wave, variant rows), armour row, hunger with the saturation shake, air bubbles, XP bar and level.
- Survival server logic: FoodData (exhaustion/saturation/regen/starvation by difficulty), damage with vanilla
  invulnerability frames, fall damage (hay/honey/bed/slime multipliers, landing tick not counted like vanilla),
  fire/lava/burning, drowning, suffocation, void, cactus, sweet berries, magma, campfires, lightning; death drops,
  death messages, death screen, respawn; XP levels with the 1.17 formula. Commands: /give /clear /kill /difficulty
  /gamerule /xp /setblock /summon lightning_bolt.
- Effects: hurt camera tilt (hurtDir is 0 in 1.17, so it always tilts the same way), death roll, red hurt tint on
  other players, first-person fire, underwater and in-wall overlays, water vision (underwater fog adapts over 30 s).
- Weather: thunderstorm lightning (vanilla odds/targeting), bolt renderer port, sky flash.
- Settings: simulation distance (entities freeze outside it; the host's setting applies in single-player/LAN),
  entity distance (vanilla bounding-box × 64 × scale).
- Sound system: WebAudio engine with vanilla semantics (weighted variants, volume ≤ 1, pitch 0.5–2, linear
  attenuation over max(volume,1)×16 blocks, categories), event registry ids from minecraft-data, server sound
  packets (excluding the player who caused it), vanilla SoundType table for every block. Hooked: break, place,
  dig hits, footsteps/swimming, landing, hurt/death, item pickup, UI clicks, thunder, rain. Audio comes from CC0
  Kenney packs and CC0 Freesound recordings cut and normalized by `pnpm soundgen` (credits in ASSET_SOURCES.md).

Deviations / notes:
- Lightning does not start fires yet: fire spread/burn-out arrives with Phase 4 fire ticking, and permanent fires
  would be worse than none.
- Non-block items (tools, food, materials) have no textures until Phase 5, so they show the missing-texture icon
  and no held model.
- XP orbs (and dropping XP on death) arrive with the XP orb entity.

Next: F5 perspectives, F3+B hitboxes, controls screen with key rebinding and mouse settings, offhand swap, beds and
spawn points, eating, XP orbs, then Phase 3 world generation.

## 2026-10-04 — Phase 2: player (continued) and phase summary

Done (unit/server tests plus Playwright screenshots; e2e scripts `tools/e2e/pvp.ts`, `bed.ts`, `spectator.ts`):
- Camera & controls: F5 third person front/back with vanilla Camera.getMaxZoom, F3+B hitboxes, entity picking
  (3 blocks survival, 6 creative), Controls screen with key rebinding (vanilla KeyMapping ids/defaults), mouse
  settings (sensitivity, invert, wheel sensitivity, discrete scroll), toggle sneak/sprint, auto-jump
  (LocalPlayer.updateAutoJump), accessibility (FOV effects), sound options.
- F3 key combos ported from KeyboardHandler.handleDebugKeys, handled at key press: A reload chunks, B hitboxes,
  C copy location, D clear chat, F render distance, G chunk borders (ChunkBorderRenderer), H advanced tooltips,
  I copy block/entity as a command, N spectator ↔ previous mode, P pause on lost focus, Q help, T reload, Esc
  pause without menu.
- Off hand: F swap, off-hand slot in the HUD, both hands rendered in first and third person, use falls back to
  the off hand.
- PvP: Player.attack (attack strength, crits, sprint knockback), invulnerability frames, held items on other
  players, pvp setting.
- Beds: sleeping (time window from the exact sky-darken table), night skip with playersSleepingPercentage, "You
  can only sleep at night", spawn point setting/respawn at the bed, wake-up stand-up search, sleeping pose and
  camera, in-bed chat screen.
- XP orbs (vanilla merge, pickup delay, level-up chime), ore XP, death XP.
- Movement: honey slide, bubble columns (up/down), powder snow sinking and freezing (140 ticks, frost overlay,
  frozen hearts, shaking), scaffolding (context-aware collision via an EntityCollisionContext port: stand on top,
  sneak to sink, climb inside; powder snow catches falls over 2.5 blocks) with original bamboo textures.
- Spectator mode: SpectatorGui menu (teleport to player by face, team page, paging), attack to look through a
  player's eyes and sneak to stop, broadcastToPlayer visibility (hidden from non-spectators, translucent heads for
  spectators), fly-speed scrolling, container-only outline/crosshair; PlayerInfo list packet (protocol v4).
- Death messages: CombatTracker port with all 1.17.1 variants (accidents by climbable, doomed/finished by, kill
  credit "whilst trying to escape", named items, thorns, bed explosion).

Phase 2 summary: 65 of 77 player items are done. The rest wait on later systems and stay unchecked until those
exist: eating and first-person non-block items (item textures, Phase 5), survival/creative/adventure rules that
need inventory screens and item tags (Phase 5), soul speed and feather falling (enchantments, Phase 7), leather
boots on powder snow (armour, Phase 5), elytra (Phase 5/7), nausea/portal wobble (effects, portals), the bed's
phantom reset and "monsters nearby" check (Phase 6) and bed explosions (Phase 8). Full suite: 98 Vitest tests
pass; benchmark row above.

Next: Phase 3 — world generation with the 1.17.1 rules (noise terrain, biomes, carvers, ores, trees, structures).

## 2026-10-04 — Phase 3: world generation (in progress) and release tooling

Done:
- Biomes: the full 1.13–1.17 layer stack (shared/src/worldgen/biome/layers.ts, 64-bit layer LCG) matching
  cubiomes for 7 seeds, plus the voronoi zoom (SHA-256 obfuscated seed) checked against cubiomes voronoiAccess3D.
- Terrain: NoiseBasedChunkGenerator density matching 256 reference heights from 1.16.5, with float emulation and
  the 1.17.1 top/bottom slides. Surface builders for every biome, bedrock pattern, exact climate (temperature with
  height, frozen noise).
- Carvers: vanilla 1.16/1.17 cave, canyon, underwater cave and canyon algorithms using the Mth sin table.
- Pipeline: chunks go through carved → decorated → full stages like the ChunkStatus pyramid. Features write into
  the 3×3 neighbourhood (WorldGenRegion.ensureCanWrite). Unloaded chunks are kept in memory.
- Feature engine (data-driven from the 1.17.1 data-generator reports):
  - Decorators: count, count_extra, chance, square, range, heightmap, heightmap_spread_double, spread_32_above,
    water_depth_threshold, count_noise, count_noise_biased, lava_lake, iceberg, dark_oak_tree, cave_surface.
    Positions are drawn depth-first, so the feature placed at each position consumes the random in the same order
    as Java streams.
  - Features: ore, scattered_ore, disk, ice_patch, lake, spring, random_patch (all block placers), flower,
    simple_block, the three selectors, seagrass, kelp, sea_pickle, freeze_top_layer.
  - Trees: every 1.17.1 overworld trunk placer, foliage placer and tree decorator. Decorators see the positions in
    real java.util.HashSet order (tested against a JVM). Leaf distances are set.
  - Feature indices include the 18 registered structure features per step (13 surface, 2 underground,
    1 stronghold, 2 underground decoration).
  - Decoration costs about 9 ms per chunk, thanks to incrementally maintained heightmaps.
- Release tooling: launcher page; `pnpm package` builds a web zip and a Windows x64 Electron app (Blockcraft.exe)
  into build/release.

Deviations / gaps:
- Lakes skip the village-start check (no villages yet). The "sky light > 0" check for regrowing grass beside lakes
  is approximated by "nothing motion-blocking above".
- Heightmaps are computed from the current blocks. Vanilla freezes the *_WG heightmaps after the noise stage, so
  ore placement next to tall features could differ slightly.
- Springs place their source and record a fluid tick, but they don't flow until fluid simulation exists.
- Not built yet: geodes, dungeons, dripstone, glow lichen, emerald ore, fossils, huge mushrooms, bamboo, vines
  feature, icebergs, ice spikes, desert wells, boulders, corals, structures. Parallel agents are working on these
  now.

Next: merge the parallel work (features, fluids, saving, inventory/crafting, mobs, items, block interactions,
first-person view, block models), run an in-game verification pass, then cut the release at 07:13 UTC.
