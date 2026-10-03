# NAMES — vanilla reference → in-game name

Generic names (stone, zombie, diamond sword, ...) are kept as-is. Names of invented
brand characters/materials get an original name here. Mechanics are identical regardless
of name. The in-game English strings are built from this table by the language system
(`shared/src/lang`), so renaming anything only needs an edit here and in
`shared/src/lang/names.ts`.

| Vanilla reference (id) | In-game name | Notes |
|---|---|---|
| `creeper` | Hisser | mob |
| `creeper_head` | Hisser Head | |
| `creeper_spawn_egg` | Hisser Spawn Egg | |
| `creeper_banner_pattern` | Banner Pattern (Hisser Charge) | |
| `enderman` | Voidwalker | mob |
| `endermite` | Voidmite | mob |
| `ender_dragon` | Void Dragon | boss |
| `dragon_head` | Void Dragon Head | |
| `ender_pearl` | Void Pearl | |
| `ender_eye` | Eye of the Void | |
| `ender_chest` | Void Chest | |
| `end_crystal` | Void Crystal | |
| `ghast` | Wailer | mob |
| `ghast_tear` | Wailer Tear | |
| `blaze` | Cinderling | mob |
| `blaze_rod` | Cinder Rod | |
| `blaze_powder` | Cinder Powder | |
| `wither` | The Withered | boss |
| `wither_skeleton` | Wither Skeleton | generic words, kept |
| `shulker` | Boxshell | mob |
| `shulker_shell` | Boxshell Shell | |
| `shulker_box` (and colors) | Boxshell Box | |
| `shulker_bullet` | Boxshell Bullet | |
| `piglin` | Swinefolk | mob |
| `piglin_brute` | Swinefolk Brute | mob |
| `zombified_piglin` | Zombified Swinefolk | mob |
| `piglin_banner_pattern` | Banner Pattern (Snout) | |
| `hoglin` | Tuskbeast | mob |
| `zoglin` | Rotting Tuskbeast | mob |
| `netherite_*` | Nethersteel * | ingot, scrap, tools, armor, block |
| `ancient_debris` | Ancient Debris | generic words, kept |

Everything not listed keeps its generic name from minecraft-data.
