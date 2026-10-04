# Blockcraft 0.4.2 (pre-release)

A browser voxel sandbox that plays like Minecraft Java Edition 1.17.1, with 100% original art, sounds and code.
This is an early development snapshot. Expect bugs and missing features.

## Downloads
- **Blockcraft-0.4.2-win32-x64.zip**: the Windows desktop app. Unzip it anywhere and run `Blockcraft.exe`.
  Worlds are saved inside the app.
- **Blockcraft-0.4.2-macos-arm64.zip**: macOS for Apple Silicon (M1/M2/M3/M4 Macs).
- **Blockcraft-0.4.2-macos-x64.zip**: macOS for Intel Macs.
  Unzip, drag `Blockcraft.app` to Applications. The app isn't notarized by Apple, so the first launch is blocked:
  open it once, then go to System Settings → Privacy & Security and click **Open Anyway** (or run
  `xattr -cr /Applications/Blockcraft.app` in Terminal).
- **Blockcraft-0.4.2-web.zip**: the web app. Serve the folder with any static web server (it must be http://,
  not file://), for example `npx serve .`, then open it in Chrome, Edge or Firefox.

## New in 0.4.2
- **Offline LAN for browsers:** Open to LAN → "Play Offline" shows a QR code. Friends on the same Wi-Fi choose
  "Join Offline" and scan it, then the host scans their reply code. No internet or server needed.
- **Plays offline:** after the first visit, the web version loads with no internet. It can be installed as an app
  from the browser menu (Chromebooks: "Install Blockcraft").
- **LAN world list (desktop app):** worlds opened to LAN in the desktop app show up automatically in other
  players' launchers under "LAN Worlds".
- macOS apps (Apple Silicon and Intel), since 0.4.1.

## What's in this build
- **World generation:**
  - 1.17.1 world generation: every overworld biome, caves and ravines, ores at 1.17.1 heights, all tree types,
    vegetation, geodes, dungeons, dripstone and corals.
  - Structures: villages, temples, igloos, shipwrecks, ocean ruins, mineshafts, strongholds, outposts, ruined
    portals, monuments and mansions.
- **Survival:** health, hunger, XP, inventory, crafting (every 1.17.1 recipe), furnaces, chests,
  tools/armour/durability, food and status effects, enchanting, anvils, brewing.
- **Blocks:** water and lava flow, farming, saplings and bone meal, doors, fire and TNT, and redstone (dust,
  torches, repeaters, comparators, lamps, observers, pistons, hoppers, dispensers, rails, tripwires).
- **Mobs:** zombies, skeletons, creepers, spiders, farm animals, wolves, slimes, endermen, phantoms, witches,
  pillagers, cats, rabbits and more, with vanilla spawning rules. Villagers have professions, trading, schedules
  and curing; iron and snow golems can be built.
- **Riding:** horses (taming, saddles, jump bar), pigs with a carrot on a stick, and boats.
- **Dimensions:** the Nether (portals of any size, all five biomes) and the End (eyes of ender, end portals,
  pillars, end crystals, the ender dragon fight, the egg and the exit portal, credits).
- **Multiplayer:** a dedicated server (`pnpm server` from the source; rooms, ops, whitelist, bans) and
  browser-hosted "Open to LAN" games.
- **Sound and settings:** sounds for every block and mob, music and ambience, and the full options screens.

## Playing
The start page lets you pick a name, then:
- **Singleplayer:** create a world (name, seed, game mode) or play, export, import or delete a saved one.
- **Join Server:** a dedicated server address and room.
- **Join LAN Game:** a room code from a friend who opened their world to LAN (Esc → Open to LAN).

## Known issues
- No minecarts or striders yet; end gateways and end cities are not done. Some mobs without a model are drawn
  as plain boxes.
- Pistons move instantly (no animation). The dragon flies a simplified path compared with vanilla's.
- "Open to LAN" works from the desktop app (it runs the relay; friends enter the host's IP shown on the Open to
  LAN screen and Windows may ask to allow the app through the firewall) and from the dedicated server. On plain
  static web hosting, fill in the launcher's "Signaling server" field.
- Some numbers (smelting recipes, structure loot weights) were written from memory and may differ slightly from
  vanilla.
