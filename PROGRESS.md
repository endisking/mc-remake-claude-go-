# PROGRESS — Blockcraft

Work loop: see `CLAUDE.md` §0. Each entry: what was done, deviations from vanilla 1.17.1, what's next.

## Missing sounds

(none yet — the sound system is not built)

## Known gaps vs vanilla

- Underwater fog uses vanilla's default dark navy colour but no "water vision" ramp yet (needs the Phase 2 player).
- Block outline draws every box of a shape; vanilla merges edges of multi-box shapes (stairs show an inner edge).
- Weighted random model variants (e.g. grass block top rotation) use our own position hash, not vanilla's exact
  per-position random, so a given block may show a different rotation than in vanilla (purely cosmetic).
- Fluid surfaces use our implementation of the vanilla corner-height averaging; flow texture rotation is derived
  from the height gradient instead of the server flow vector.
- Chunk storage keeps flat 16-bit arrays per non-empty section (empty sections store nothing); palette compression
  is used only on the wire and in saves.

## Benchmarks

| Date | Phase | Avg FPS | 1% low | Chunk build (ms) | Notes |
|---|---|---|---|---|---|
| 2026-10-03 | 1 | 9.3 | 4.6 | 0.50 | RD 6, 1280×720, SwiftShader (software GL in the CI container). JS CPU per frame 2.2 ms, 304 visible sections. |

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
