# PROJECT: Blockcraft — a browser voxel sandbox that plays like Minecraft Java Edition 1.17.1

You are building this game autonomously, over many sessions, for a small group of friends to
play together in the browser (including on school laptops/Chromebooks). This is a private,
non-commercial hobby project.

**The goal:** every mechanic, system, block, item, mob behavior, and UI flow of Minecraft:
Java Edition **1.17.1** (Caves & Cliffs Part I, the update right after the Nether Update),
recreated so it *feels* identical to play — with **100% original art, sound, and code** made
in the same blocky, pixel-art style.

Do NOT add content from 1.18 or later (no 1.18 terrain generation, no -64 world depth, no
1.19+ blocks or mobs). When unsure whether something existed in 1.17.1, read the History
section of its page on https://minecraft.wiki and follow that.

---

## 0. THE WORK LOOP (read this at the start of EVERY session)

1. Read `PROGRESS.md` and `FEATURES.md`. If they don't exist, do Phase 0 first.
2. Pick the highest-priority unchecked item in `FEATURES.md`.
3. Research it: its minecraft.wiki page and its entry in minecraft-data (see §1). Get exact
   numbers (hardness, damage, speeds, tick timings, drop chances, spawn rules). Never guess.
4. Implement it fully. No stubs, no placeholders, no "TODO later" for the item you're on.
5. Verify it:
   - Unit tests (Vitest) for all logic: crafting, damage math, redstone, growth, AI decisions.
   - Playwright check for anything visual or UI: take a screenshot, look at it, fix what's off.
6. Check it off in `FEATURES.md`. Add a dated entry to `PROGRESS.md`: what was done, any
   deviation from vanilla behavior, and what's next. `git commit` with a clear message.
7. Go back to step 2. **Do not stop to ask questions** unless truly blocked. Make the choice
   that best matches vanilla 1.17.1 behavior and record it in `PROGRESS.md`.
8. Never mark an item done if it plays noticeably differently from vanilla. Log the gap instead.
9. At the end of every phase: run the full test suite, run the performance benchmark (§3),
   and write a short phase summary in `PROGRESS.md`.
10. When every box in `FEATURES.md` is checked, do a full "feel pass" (§7) and keep going
    until it's done too.

If the user says "continue", just resume this loop from `PROGRESS.md`.

---

## 1. ORIGINAL ASSETS ONLY (hard rule)

- **Never** use, download, extract, trace, or copy any Mojang/Minecraft file: no textures,
  models, sounds, music, fonts, skins, lang files, or the game jar. Do not pixel-copy or
  closely trace any official texture or character design.
- **Game data is fine to reference.** Facts like block lists, hardness values, recipes, mob
  health, spawn rules, and loot chances come from:
  - PrismarineJS `minecraft-data` for version **1.17.1** (MIT-licensed JSON)
  - https://minecraft.wiki (for behavior details and history)
- Everything players see and hear is made by this project or comes from openly licensed
  (CC0 / CC-BY / OFL) sources, logged in `ASSET_SOURCES.md` with URL + license.

### 1a. Textures (original pixel art in the same style)
- Build a deterministic texture generator in `/tools/texgen` that outputs PNGs to
  `/client/public/textures`. Each texture is hand-designed in code as palette + pixel grid,
  or palette + seeded noise with hand-placed details.
- Style rules so it reads as "that game" without copying it:
  - 16×16 block/item textures, nearest-neighbor filtering, no anti-aliasing.
  - 4–8 color palette per material, light from the top-left, subtle dithering noise.
  - Grass/leaves/water are grayscale and tinted per biome using colormaps you generate.
  - Ores = base stone texture + clusters of 2–4 colored pixels.
  - Animated textures (water, lava, fire, portal, sea lantern, etc.) as vertical strips with
    frame timing metadata.
- Each block, item, and mob gets its own original design. Mobs keep the **same hitbox size,
  body-part layout logic, animations, and gameplay role** as their vanilla counterpart, but
  their faces, colors, and textures are original designs that fit the blocky style.
- Player skins: 64×64 skins in the standard skin layout, a few original default skins, and a
  skin upload option so friends can use their own.
- Build `/tools/atlas-viewer.html`: a page that shows every texture at 8× zoom so the user
  can review them. Any PNG dropped into `/client/public/textures/overrides/` with a matching
  name replaces the generated one.

### 1b. Sound and music (real audio files, not synthesized)
- **Do not synthesize sound effects in code** (no oscillators/WebAudio-generated SFX).
- Source real recorded audio files from CC0 libraries (e.g. Kenney.nl audio packs,
  Freesound.org filtered to CC0, OpenGameArt CC0). Download them into `/client/public/sounds`,
  convert to `.ogg`, and log each one in `ASSET_SOURCES.md`.
- Build a sound event table mirroring vanilla's structure: every block sound group (stone,
  wood, gravel, grass, sand, wool, glass, metal, copper, amethyst, etc.) gets step / place /
  break / hit / fall variants; every mob gets ambient / hurt / death / step sounds; plus UI
  clicks, items, weather, ambience. Use 2–6 file variations per event with randomized
  pitch/volume like vanilla does.
- Music: calm, sparse ambient piano/synth tracks from CC0/CC-BY sources, played with
  vanilla's music rules (random delay between tracks, separate sets for menu, overworld,
  creative, underwater, Nether, End, boss fight, credits).
- If a needed sound can't be found, leave a clearly named silent placeholder, list it in
  `PROGRESS.md` under "Missing sounds", and keep working.

### 1c. Fonts and names
- Use an OFL-licensed pixel font, or build an original bitmap font in `/tools/fontgen`.
- Generic names (stone, oak planks, zombie, skeleton, diamond sword, etc.) are fine.
  For mobs/items whose names are specific invented brand characters, use an original name and
  keep a `NAMES.md` mapping table (vanilla reference → in-game name) so the user can rename
  anything later. Mechanics stay identical regardless of name.

---

## 2. TECH STACK & ARCHITECTURE

- **Language:** TypeScript everywhere. **Build:** Vite. **Monorepo:** pnpm with
  `/client`, `/server`, `/shared`, `/tools`.
- **Rendering:** hand-written WebGL2 renderer (Three.js allowed only for math/camera helpers).
  - 2D texture array for block textures; chunk sections are 16×16×16.
  - Meshing in Web Workers, with separate opaque / cutout / translucent passes.
  - Frustum culling + cave/occlusion culling; translucent faces sorted back-to-front.
  - Block models defined in our own JSON format supporting cubes, multipart, rotations, and
    per-face UVs (stairs, slabs, fences, walls, panes, doors, torches, rails, plants, etc.).
- **Simulation:** shared game logic in `/shared`, ticking at exactly **20 TPS**.
- **Single-player:** the server runs inside a Web Worker in the browser (same code as the
  Node server).
- **Multiplayer (two options, build both):**
  1. Dedicated Node.js server over WebSocket (`wss://` on port 443 so it works on school
     networks), deployable to any cheap host. Players join with a URL + room code.
  2. "Open to LAN"-style browser hosting: the host's in-browser server accepts friends over
     WebRTC data channels, using a tiny signaling server.
  - The server is authoritative. The client predicts its own movement and reconciles.
  - Binary message protocol defined in `/shared/protocol`.
- **Saves:** worlds saved in a region-file-like format. Single-player saves go in IndexedDB;
  the dedicated server saves to disk. Autosave every 5 minutes. World export/import as a zip.
- **Tests:** Vitest for logic, Playwright for rendering/UI and FPS benchmarks.

---

## 3. PERFORMANCE (must run well on school laptops)

- Targets: **60 FPS on a low-end Chromebook** at render distance 6; **uncapped / 144+ FPS** on
  a decent PC at render distance 12+. Frame rate setting: VSync, 30/60/120/Unlimited.
- Avoid garbage collection in the render loop (pooled buffers, typed arrays, no per-frame
  allocations). Upload chunk meshes incrementally to avoid frame spikes.
- Graphics settings like vanilla: Fast/Fancy, smooth lighting on/off, clouds off/fast/fancy,
  render distance 2–32, simulation distance, entity distance, particles all/decreased/minimal,
  mipmap levels, GUI scale, brightness, FOV, view bobbing.
- `/tools/bench`: a Playwright script that flies a fixed path through a fixed seed and
  reports average FPS, 1% lows, and chunk build time. Run it at the end of every phase and
  log results in `PROGRESS.md`. Fix any regression before moving on.

---

## 4. "FEELS EXACTLY LIKE IT" — exact behavior requirements

Pull every number from minecraft-data / minecraft.wiki. Key ones to get right:

- **Time & sky:** 24000-tick day cycle, sun/moon, 8 moon phases, stars, sunrise/sunset fog
  colors, clouds, rain/snow/thunderstorms, biome-dependent sky and fog colors.
- **Player physics (per tick):** gravity 0.08, vertical drag 0.98, correct ground and air
  friction, walk ≈4.317 m/s, sprint ≈5.612 m/s, sneak, sprint-jumping, jump height ≈1.25
  blocks, step-up 0.6, hitbox 0.6×1.8 (1.5 tall when sneaking), eye height 1.62, swimming
  and the 1-block crawl pose, sneaking stops you at edges, fall damage, ladders/vines/
  scaffolding, soul sand, honey, cobwebs, powder snow, bubble columns, elytra flight physics.
- **Camera & controls:** FOV 70 default with sprint FOV change, view bobbing, hand sway and
  swing animation, F5 three perspectives, F1 hide HUD, F3 debug screen, F3+B hitboxes,
  F11 fullscreen, pointer lock, rebindable keys, double-tap W to sprint, double-tap space
  to fly in creative, scroll/number-key hotbar, Q drop / Ctrl+Q drop stack, F swap offhand,
  middle-click pick block.
- **Interaction:** block reach 4.5 (5 in creative), entity reach 3, exact mining times by
  tool + tier + Efficiency + Haste/Mining Fatigue + underwater + not-on-ground penalties,
  block crack overlay stages, break particles, the block outline box.
- **Lighting:** sky light + block light (0–15) with flood-fill propagation, smooth lighting
  with ambient occlusion, correct light emission per block, light-based mob spawning.
- **Feel details:** item drops that pop out, spin, bob, and merge; XP orbs that fly to you;
  hurt camera tilt and red flash; knockback; hunger shake; first-person hand and item
  rendering; enchantment glint; underwater fog and view; lava fog; nausea/portal wobble.

---

## 5. PHASES

`FEATURES.md` must expand every phase into **one checkbox per individual block, item, mob,
mechanic, screen, and sound event**, generated from minecraft-data 1.17.1 so nothing is missed.

### Phase 0 — Research & data
- Load minecraft-data 1.17.1. Generate typed data tables in `/shared/data` for blocks, items,
  entities, biomes, enchantments, effects, recipes, foods, and materials.
- Generate `FEATURES.md` grouped by phase. Mark things that exist in 1.17.1 but are not
  obtainable in survival (check the wiki for each).
- Create `PROGRESS.md`, `ASSET_SOURCES.md`, `NAMES.md`.

### Phase 1 — Engine core
Renderer, chunk loading/unloading, meshing workers, lighting engine, block model system,
texture generator + atlas viewer, sky/fog/weather visuals, frame loop, settings menu basics.

### Phase 2 — Player
Movement physics, collision, camera, hotbar, game modes (survival, creative, adventure,
spectator), health, hunger, saturation, exhaustion, XP levels, breathing/drowning, fall/fire/
lava/void/suffocation/cactus/berry-bush damage, beds and sleeping, spawn point, respawn,
death screen and dropped items.

### Phase 3 — World generation (1.17.1 rules)
- World height 0–255. Seeded and deterministic.
- Recreate the 1.17.1-era Overworld generator as closely as possible: every 1.17.1 biome and
  its variants, biome placement, terrain shapes (plains through mountains), caves, ravines,
  underwater caves, lakes, ore distributions at 1.17.1 heights, trees of every type,
  vegetation, and the 1.17.1 additions per the wiki (amethyst geodes, copper ore, etc.).
- Structures: villages (every biome variant), desert and jungle temples, witch huts, igloos,
  shipwrecks, ocean ruins, ocean monuments, mineshafts, dungeons, strongholds with End
  portals, woodland mansions, pillager outposts, ruined portals, buried treasure, fossils.
  Build our own structure templates that match their layouts and loot rules.
- Nether: all five Nether biomes, fortresses, bastion remnants, ruined portals, ancient debris.
- End: main island, obsidian pillars and crystals, outer islands, End cities with ships,
  end gateways, chorus plants.

### Phase 4 — Blocks & interaction
Every 1.17.1 block with correct behavior, including: gravity blocks, fluids (sources, flow,
waterlogging, lava+water → cobble/stone/obsidian/basalt), crops and growth ticks, saplings,
bone meal, fire spread and burnout, TNT, doors/trapdoors/fence gates, editable signs, item
frames and glow item frames, copper oxidation / waxing / scraping, lightning rods, amethyst
growth, pointed dripstone, powder snow, candles and candle cakes, cauldrons (water/lava/
powder snow), composters, note blocks (all instruments by block below), jukebox and discs,
beacons, conduits, respawn anchors, lodestones, bells, campfires, beehives.

**Redstone (must be exact):** dust and signal strength, torches (incl. burnout), repeaters,
comparators (compare/subtract, container fill levels), pistons and sticky pistons
(12-block push limit, quasi-connectivity, block dropping, slime/honey blocks), observers,
hoppers, droppers, dispensers (every behavior), all rails and minecarts, daylight sensors,
target blocks, tripwire hooks, pressure plates, buttons, levers, redstone lamps, trapped
chests, lecterns, correct tick delays and update order. Test with known contraptions
(clocks, T flip-flops, piston doors, item sorters).

### Phase 5 — Items, inventory, crafting
- Inventory with shift-click, click-drag splitting, right-click halves, number-key swaps,
  double-click collect, offhand slot, creative inventory with tabs and search.
- Every recipe: shaped, shapeless, special (dyeing, banners, fireworks, maps, books, etc.).
- Furnace, blast furnace, smoker, campfire cooking, stonecutter, smithing table (netherite
  upgrades), loom (banner patterns), cartography table, grindstone, anvil (repair, combine,
  rename, XP cost, prior-work penalty, "Too Expensive!").
- Recipe book. Durability. All tools, weapons, armor, foods, potions, maps, compasses,
  clocks, spyglass, fishing (with correct loot tables), bundles per their 1.17.1 status.

### Phase 6 — Mobs & AI
- Every 1.17.1 mob from minecraft-data, each with: original model and texture matching the
  vanilla hitbox and body proportions, walk/attack/idle animations, correct health, damage,
  speed, drops, and XP.
- Spawning: light-level rules, biome/structure rules, mob caps per category, despawning,
  spawners, raids, patrols, phantoms (insomnia), slime chunks, zombie sieges.
- AI: pathfinding (walking, swimming, flying, climbing), behavior goals per mob (fleeing,
  panic, tempting with food, breeding, taming, sitting, following owner, hunting, door
  opening/breaking, avoiding sunlight, picking up items, wearing armor).
- Riding: horses/donkeys/mules (taming, saddles, chests, jump strength), pigs + carrot on a
  stick, striders + warped fungus on a stick, boats, minecarts.
- Villagers: professions by workstation, levels, full 1.17.1 trade tables, restocking,
  gossip/reputation, curing zombie villagers, iron golem spawning, beds and schedules.
  Wandering trader, piglin bartering and gold rules.
- Bosses: Wither (summoning, phases, skull attacks, boss bar) and the Ender Dragon (full
  fight, crystals, perching, breath, egg, exit portal, gateways, respawning).

### Phase 7 — Combat, enchanting, brewing, effects
- 1.9+ combat: attack cooldown and indicator, sweep attacks, critical hits, knockback,
  shields (blocking, disabling with axes), armor and toughness formula, invulnerability
  frames, bows (charge), crossbows (charging, multishot, piercing, fireworks), tridents
  (throw, Loyalty, Riptide, Channeling, Impaling).
- Enchanting table with bookshelves and the exact 1.17.1 enchantment selection algorithm;
  every enchantment and its effects; enchanted books; treasure-only enchantments; curses.
- Brewing stand with blaze powder fuel and every potion, splash and lingering potions,
  tipped arrows. Every status effect with correct icons, particles, and behavior.
- Beacons and conduits effects. Totem of Undying. Advancements (full 1.17.1 tree).

### Phase 8 — Dimensions
Nether portals (any size frame, linking with 8:1 coordinate scaling, portal search radius),
End portals and strongholds, Eyes of Ender behavior, End gateways, the credits/poem screen
(write original text), dimension-specific sky, fog, music, and ambience.

### Phase 9 — Multiplayer
Player list (Tab), chat with commands, nameplates, skins, PvP toggle, ops/permissions,
whitelist, kick/ban, world spawn protection off by default, per-player inventories and
spawns, all entities and block updates synced. Commands: /gamemode, /tp, /give, /time,
/weather, /gamerule (all 1.17.1 gamerules), /difficulty, /seed, /kill, /effect, /enchant,
/summon, /setblock, /fill, /clone, /locate, /spawnpoint, /setworldspawn, /xp.

### Phase 10 — Audio
Hook every sound event to every action. Positional 3D audio with vanilla-like attenuation
and distance. Volume sliders per category: master, music, jukebox/note blocks, weather,
blocks, hostile, friendly, players, ambient/environment, voice. Cave ambience, underwater
muffling and ambience, Nether biome mood loops.

### Phase 11 — Menus & polish
Title screen with a rotating panorama rendered from our own world plus a random splash line
(write original splash texts), single-player world list (create with seed, game mode,
difficulty, world type: default/superflat/large biomes/amplified, cheats toggle), multiplayer
server list, every options screen, controls rebinding, language file system (English first),
pause menu, statistics screen, advancements screen, loading/saving screens, toasts,
subtitles option, screenshots (F2).

---

## 6. DEFINITION OF DONE (per feature)

A feature is done only when:
1. Its numbers match the wiki/minecraft-data for 1.17.1.
2. It has tests (logic) or a verified screenshot (visual), and both pass.
3. It has its sounds and particles hooked up (or a logged missing-sound placeholder).
4. It works in multiplayer, not just single-player.
5. It doesn't regress the performance benchmark.

---

## 7. FINAL "FEEL PASS"

After all checkboxes are done, go system by system and compare against how 1.17.1 plays,
using the wiki's exact values and your own playtests via Playwright:
movement feel, mining speed, combat timing, mob behavior, sound timing and variety, UI
click/drag behavior, lighting, sky colors, fog, water/lava look, day/night pacing.
List every remaining difference in `PROGRESS.md` and fix them one by one.
Then keep improving texture and sound quality until the user says stop.
