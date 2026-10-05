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
| 2026-10-04 | 3 (mid) | 10.0 | 5.0 | 0.47 | Same setup, now real 1.17.1 terrain with trees and plants. JS CPU per frame 2.19 ms, 202 visible sections. |
| 2026-10-04 | 0.4.0 release | 7.5 | 3.0 | 0.87 | Same setup, everything merged (structures, mobs, dense foliage). JS CPU per frame 3.76 ms (up from 2.19) — regression to investigate next (likely mob updates and per-frame entity work). |

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

## 2026-10-04 — Parallel build-out (15+ agents) and release prep

The work was split across parallel agents in separate git worktrees and merged into this branch:

- **Worldgen:**
  - All overworld features are data-driven from the 1.17.1 reports: geodes, dungeons, glow lichen, dripstone,
    emerald ore, our own fossil designs, huge mushrooms, bamboo, vines, corals, icebergs, ice spikes, desert
    wells, boulders and double plants. There is a carving-mask decorator and a faster JavaRandom.
  - Overworld structures use vanilla spacing/salts, biome checks and stronghold rings. Our own layouts are built
    in code (no .nbt), with 1.17.1 chest loot tables as data and `/locate`.
- **Saving:** a WorldStorage interface with IndexedDB in the browser worker and region files on disk for the
  dedicated server. Autosave every 6000 ticks, a "Saving world" screen, the world list in the launcher, and zip
  export/import. The chunk format is versioned (v4: block entities, carving masks, mobs).
- **Fluids:** FlowingFluid rules for water and lava, infinite sources, cobble/stone/obsidian/basalt, springs,
  flow push, and an ultraWarm Nether.
- **Blocks:** scheduled and random ticks, gravity blocks, farming, saplings growing through the worldgen tree
  features, bone meal, doors, trapdoors and gates, fire, TNT and the vanilla explosion, copper weathering, leaf
  decay and more.
- **Items:** durability, armour and toughness, eating, status effects, buckets, bows and arrows, throwables,
  shields and the totem. There are 490 original item sprites with GUI/dropped/held rendering.
- **Inventory:** vanilla click logic, all 1.17.1 crafting recipes, chests (double), barrels, ender chests,
  furnaces/smokers/blast furnaces with smelting, stonecutter, smithing, grindstone (repair) and the creative
  inventory.
- **Mobs:**
  - Server: goal AI, A* pathfinding, 1.17.1 spawning rules and caps, despawning, spawners, and 22 mob types
    (zombie family, skeleton/stray, creeper, spiders, farm animals, wolf, slime, enderman, bat, squid, fish,
    phantom) with loot and XP.
  - Client: original models and textures for about 60 mobs, animations, death/hurt, shadows and name tags.
- **Commands and multiplayer:** a Brigadier-style command system with selectors and ~ ^ coordinates (most
  1.17.1 commands), chat with tab completion, the Tab player list, nameplates, and ops/bans/whitelist on the
  dedicated server.
- **The Nether:** multi-dimension server, Nether noise terrain, the 5 biomes via the multi-noise preset, nether
  features, portals of any size with 8:1 linking, search radius and creation, and respawn anchors.
- **Rendering and feel:** vanilla first-person hand and item poses with use animations and slim arms, block models
  and original textures for all 898 blocks, a loading-terrain screen, the options screens (video, chat, skin
  upload), and performance work (tick-budgeted chunk generation, 2× faster decoration, less GC).
- **Audio:** 972 vanilla sound events backed by 363 CC0 clips, every block sound group, mob voices, the music
  manager rules, and cave/underwater/Nether ambience.

Deviations and gaps from this round:
- Values recalled from memory because minecraft.wiki is blocked from this container: the smelting recipe list,
  structure loot weights and spacing values. Verify them against the wiki.
- Item stacks have no NBT, so these are missing: enchantments in loot, dyed armour, banner/firework/map
  recipes, suspicious stew, tipped arrows, and shulker contents kept on break.
- Not saved: scheduled block ticks, pending fluid ticks, dropped items and XP orbs.
- Mobs without models are drawn as hitbox boxes.
- Missing: editable signs, recipe book, Nether fortresses and bastions, minecarts and boats.

Later in the same round:
- **Phase 7:** item tags (enchantments, names, potions, repair cost), the 1.17.1 enchanting table algorithm, 25
  enchantment effects, glint, brewing with every 1.17.1 potion recipe, splash and lingering potions, anvil and
  grindstone.
- **The End:**
  - End biome source, terrain and pillars; chorus plants.
  - Eyes of ender, portal activation and the arrival platform.
  - The exit fountain and an original credits poem; the End sky.
  - Gaps: no ender dragon (so the fountain starts lit), no crystals, end cities or gateway teleports.
- **Redstone:**
  - Signal model, dust (vanilla update order), torches with burnout, repeaters and comparators (container
    levels).
  - Observers, daylight detectors, target blocks, plates, buttons, levers, lamps, trapped chests.
  - Powered doors, trapdoors and gates; note blocks, TNT, dispensers and droppers (drop only).
  - Pistons follow the vanilla push rules, but move instantly with no 2-tick animation.
  - Not done: hoppers, rails, tripwire.
- **QA pass:**
  - Vanilla setInitialSpawn: spawn biome search and a grass column spiral.
  - The desktop app saves the world before the window closes.
  - The server catches exceptions per tick and per packet, so one bug can't freeze or crash a world.
  - Favicon.
  - Verified end to end: survival loop, saving, creative, dedicated-server multiplayer, LAN over WebRTC.


Final sprint before the release:
- **Mobs and riding:** villagers (13 professions, 1.17.1 trade tables, levels, restocking, schedules, beds,
  breeding, zombie conversion and curing), wandering trader, iron and snow golems, horses/donkeys/mules, witches,
  pillagers, vindicators, rabbits, cats, ocelots, polar bears, turtles. A riding system covers horses with the
  jump bar and pigs with a carrot on a stick; boats have vanilla physics.
- **Redstone:** hoppers (8-tick transfer, locking, furnace faces), dispenser behaviours (projectiles, potions,
  buckets, bone meal, flint and steel, shears, TNT, armour), rail shapes, powered/activator/detector rails,
  tripwire.
- **The End:** end crystals and the ender dragon (phases, breath, block breaking, death with egg, exit portal,
  gateway and XP), and a boss bar. The exit fountain now lights only after the kill.
- **Appearance and LAN:** villager biome/profession/level looks and horse coats; the desktop app relays LAN
  signaling and shows the host's IP.

Release 0.4.0: web zip + Windows x64 app built by the Release workflow from tag v0.4.0. FEATURES.md: 2224 of
4140 items checked (up from 141 at the start of the day). Full suite: 1029 Vitest tests pass.

Still not vanilla:
- Minecarts, striders, end cities and gateway teleports are missing.
- Pistons move instantly. The dragon uses a simplified flight path.
- Values recalled from memory (wiki blocked here) need checking: smelting recipes, structure loot weights, End
  platform coordinates.

## 2026-10-04 — LAN without a relay or internet, offline web app, LAN discovery (0.4.2)

- **Offline LAN pairing (browsers):** "Open to LAN" → "Play Offline" shows an invite QR code. The friend picks
  "Join Offline" in the launcher, scans it (or pastes the text) and shows a reply QR code back to the host. The two
  codes are the WebRTC offer and answer (no ICE servers, so same-network routes only), compressed with deflate-raw
  into about 500 characters (QR version ≤ 16). No signaling server and no internet. `tools/pair-e2e.ts` runs the
  whole flow in two browser profiles with the web server shut down.
  - Limit: Chrome hides local IPs behind mDNS names until camera access is granted. When both players paste
    codes instead of scanning, the network must resolve mDNS (most home Wi-Fi does).
- **Offline web app:** the build writes `sw.js`, a service worker that caches all ~1900 files on the first visit
  (cache-first, versioned by a hash of the file list), plus `manifest.webmanifest` and icons
  (`tools/pwa-icons.ts`). The game then loads and installs (Chromebooks: "Install Blockcraft") with no internet.
  It is registered on https:// and localhost only.
- **LAN world discovery (desktop app):** like vanilla's LAN pinger, each world opened to LAN on the app's relay
  is announced every 1.5 s. The format is vanilla's `[MOTD]…[/MOTD][AD]port[/AD]` plus `[ROOM]code[/ROOM]`,
  sent by UDP multicast to 224.0.2.60 and by subnet broadcast, on port 47616 (not 4445, so real Minecraft clients
  don't list these worlds). The app lists what it hears at `/lan-servers`. The launcher shows "LAN Worlds" (click
  to fill in, double-click to join) whenever that endpoint exists, which includes browser guests on the host's
  `http://ip:47615` page. The list entry is "<player> - <world name>", as in vanilla. The app also turns off
  Chromium's mDNS IP hiding so LAN WebRTC works on networks without mDNS.
  - Deviation: worlds that go silent for 5 s drop off the list (vanilla keeps them until the screen is
    reopened).
  - Limit: browser tabs can't send or receive UDP. Browser-hosted worlds aren't discoverable; browsers pair by
    QR code instead.

## 2026-10-04 — Dedicated server release build (0.4.3)

- `pnpm package` now also writes `Blockcraft-<version>-server.zip`, containing `server.mjs` (the dedicated server
  with `ws`, bundled by esbuild as ESM for Node 20+), the web client in `web/`, `start.bat`, `start.sh` and
  `README.txt`. The server serves `web/` when it sits next to the bundle; from the source it serves
  `client/dist` as before. On startup it prints the LAN address(es) friends should open.
- `/server-info` lets the launcher served by a dedicated server fill in that server's address. `playUrl` treats
  172.16–31.x.x and the page's own http:// host as plain `ws://`.
- Verified: unzipped the release zip into a clean folder and ran `node server.mjs`. Two browser players joined
  through the launcher, saw each other, and a console command (`say`) reached the room.

## 2026-10-04 — Fullscreen keyboard lock, no background music (0.4.4)

- **Ctrl+W:** `client/src/fullscreen.ts` enters fullscreen and calls `navigator.keyboard.lock()` (Keyboard Lock API,
  Chrome/Edge). Browser shortcuts such as Ctrl+W (sprint + forward), Ctrl+T and Ctrl+N then reach the game, and
  leaving fullscreen takes holding Escape. While the mouse is captured, Ctrl/Cmd key combinations are
  `preventDefault`ed.
  - Without fullscreen, or in Firefox/Safari, a `beforeunload` prompt guards a running world. It is skipped
    for Save and Quit and in the desktop app, where it would silently cancel closing the window.
  - The fullscreen key now works on every screen, like vanilla's KeyboardHandler, unless the screen consumes
    the key itself.
  - Verified in Chromium: F11 toggles fullscreen from the pause menu, Ctrl+W keydown is default-prevented in
    game, leaving a running world raises the beforeunload prompt, and Save and Quit doesn't.
- **Music removed (players' request):**
  - Deviation from vanilla: there is no menu or situational background music.
  - Removed: `client/src/audio/music.ts` (MusicManager), the `music.*` events and `music_*` clip sets, their
    soundgen sources, and the Music volume slider (the screen is now "Sound Options").
  - Jukebox discs (`record` category, not implemented yet) aren't part of this removal.

## 2026-10-04 — Mobile touch controls (0.4.5)

- `client/src/gui/touch.ts`: a DOM overlay laid out like the mobile edition's touch controls. Every control
  becomes the same key or mouse-button press the keyboard makes (through `Input.press/release` and the key
  bindings), so the game logic is unchanged.
  - **Joystick:** appears under the thumb on the left 35% of the screen. W/A/S/D past 35% deflection; at 92% or
    more mostly forward it adds the sprint key.
  - **Look:** a drag elsewhere adds to the mouse delta (2.2 mouse counts per CSS px; the sensitivity option still
    applies).
  - **Tap** (under 12 px of travel): attack if an entity is targeted, otherwise use/place.
  - **Hold** (280 ms still): holds use when the selected item has a use duration (food, potions, bows,
    crossbows, tridents, shields, spyglass), otherwise attack (break). Dragging while holding keeps breaking.
  - **Buttons:** jump (held), sneak (toggle), inventory, drop, chat (`prompt()`, so the phone keyboard can type),
    perspective, fullscreen, pause. Tapping a hotbar slot selects it.
  - **Menus:** only a ✕ button is shown; it sends Escape. Taps reach the menu as the browser's emulated mouse
    clicks.
- `Input.touchMode`: no pointer lock. `lock()`/`unlock()` just track whether a menu is open, so the "is playing"
  checks work unchanged.
  - Touch mode turns on with a touch. A mouse `pointerdown` switches back to pointer lock (touchscreen
    Chromebooks).
  - The viewport disables pinch zoom.
- Verified in Chromium phone emulation (Pixel 7 landscape) with real touch events:
  - joystick → W (+ sprint when pushed fully); a drag turns the camera; a hold presses attack
  - the jump button holds Space; the inventory, ✕ and pause buttons work
  - a hotbar tap selects the slot; tapping a creative-inventory block, then a hotbar slot, places it there
  - chat via the prompt reaches the server
  - touch ↔ mouse switching works on a touch-enabled desktop.
- Not like vanilla Java (which has no touch controls): splitting stacks by dragging and right-click halving
  aren't available by touch yet.

## 2026-10-04 — Touch controls only on mobile (0.4.6)

- `isMobileDevice()` (gui/touch.ts):
  - **Mobile:** `navigator.userAgentData.mobile`, or an Android/iPhone/iPad/iPod/Mobile/Silk/Kindle user agent,
    or a "Macintosh" user agent with touch points (iPadOS desktop mode).
  - **Never mobile:** Chrome OS. Chromebooks and Windows touch laptops keep pointer lock even when the screen
    is touched.
  - On mobile, touch mode starts immediately (no "Game Menu" from the failed pointer lock). A mouse switches to
    mouse controls and a touch switches back (tablets with a mouse).
- Unit tests cover the user agents. Phone emulation (Pixel 7, iPad) shows the controls at start; the touch-enabled
  Chromebook and Windows contexts show none, even after a tap.

## 2026-10-05 — Dedicated server no longer crashes on stray requests

- Opening the server's address in a browser could stop the whole server, so every room had to be restarted.
  Three causes, each reproduced and then fixed in `server/src/node/main.ts` / `signaling.ts`:
  - **No client build found:** `STATIC_DIR` was `undefined`, so any page request threw in `path.join`. Now the
    request gets a 404 "Client not built" reply.
  - **Malformed URL** (e.g. `/%E0%A4%A`, sent by scanners and some browsers): `decodeURIComponent` threw. Now the
    reply is a 400.
  - **Bad WebSocket frame or reset connection** on `/play` or `/signal`: `ws` emitted `'error'` with no listener.
    Now it's logged and only that connection closes.
- Also added: a try/catch around static serving; read-stream errors give a 500; `clientError` and upgrade-socket
  errors close only that socket; a last-resort `uncaughtException` / `unhandledRejection` logger keeps the other
  rooms running.
- Checked by hand: requests with no client build, `https://` sent to the plain-HTTP port, a malformed URL, garbage
  HTTP, and unmasked WebSocket frames on `/play` and `/signal`. The server keeps serving after each one.
