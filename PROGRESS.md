# PROGRESS — Blockcraft

Work loop: see `CLAUDE.md` §0. Each entry: what was done, deviations from vanilla 1.17.1, what's next.

## Missing sounds

(none yet — the sound system is not built)

## Known gaps vs vanilla

(none logged yet)

## Benchmarks

| Date | Phase | Avg FPS | 1% low | Chunk build (ms) | Notes |
|---|---|---|---|---|---|

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
