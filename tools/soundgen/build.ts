/**
 * Sound build: downloads CC0 recordings (Kenney packs, Freesound), cuts/trims/normalizes them
 * into short clips, writes client/public/sounds/<set>/<n>.ogg and sounds.json (vanilla sound
 * event → clip variants), credits each source in ASSET_SOURCES.md and reports hooked events
 * that still have no audio. Usage: pnpm soundgen
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { decode, encode, trim, normalize, fade, section, sliceOnsets, gain } from './audio';
import { curlText } from './search';
import { SOUND_TYPES } from '../../shared/src/world/soundtype';
import { SOUND_EVENTS } from '../../shared/src/data';

const root = new URL('../../', import.meta.url).pathname;
const cache = join(root, 'tools/soundgen/cache');
const outDir = join(root, 'client/public/sounds');
mkdirSync(cache, { recursive: true });

// ------------------------------------------------------------------ sources
const KENNEY: Record<string, { url: string; title: string }> = {
  'impact-sounds': { url: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', title: 'Impact Sounds' },
  'rpg-audio': { url: 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip', title: 'RPG Audio' },
  'ui-audio': { url: 'https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip', title: 'UI Audio' },
  'interface-sounds': { url: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip', title: 'Interface Sounds' },
};

/** Freesound picks (all CC0; licence re-checked on download). */
const FREESOUND: Record<number, string> = {
  117627: 'soundmary', // footsteps - gravel pavement
  521588: 'Fission9', // hiking boot footsteps on gravel
  655366: '21100495', // walking in beach sand
  734230: 'NoisyRedFox', // steps on dry grass
  364712: 'alegemaate', // rustling grass
  327894: 'Kreastricon62', // bush cut
  221528: 'unfa', // glass break
  371094: 'mccormick_iain', // glass break 1
  554570: 'Greg_Surr', // glass shatter 5
  840628: 'loganzsound', // closeup thunder strike
  683421: 'SholeColtis', // short thunder mid
  696550: 'saha213131', // thunder11
  513395: 'shelbyshark', // short neighborhood rain
  21190: 'uberhuberman', // rain fast drip
  719053: 'unfa', // oof
  438912: 'LucyTheDev', // homemade oof
  504626: 'leonelmail', // body fall heavy dirt
  82027: 'raubana', // body fall over
  637956: 'kyles', // water movements, small splashes
  398032: 'swordofkings128', // splash
  323741: 'Reitanna', // mouth pop
  573152: 'fleurescence', // mouth pop
  651292: 'f3bbbo', // digging in wet coarse sand (1)
  651293: 'f3bbbo', // digging in wet coarse sand (2)
  560957: 'Bricklover', // shovel - sand/gravel/snow
  778568: 'BlondPanda', // steps on fine snow or sand
  389590: 'Jofae', // swing woosh
  507466: 'Danjocross', // clean fast swoosh
  66876: 'hihirex', // glass ding
  515643: 'MashedTatoes2', // ding2
  452379: 'steffcaffrey', // small bell #2
  384423: 'cabled_mess', // footstep in the snow
};

interface Credit {
  key: string;
  title: string;
  author: string;
  url: string;
  license: string;
}
const credits = new Map<string, Credit>();

function curlFile(url: string, dest: string): void {
  execFileSync('curl', ['-sSL', '--max-time', '180', '-o', dest, url]);
}

function kenneyDir(pack: string): string {
  const dir = join(cache, `kenney_${pack}`);
  if (!existsSync(dir)) {
    const zip = join(cache, `kenney_${pack}.zip`);
    if (!existsSync(zip)) curlFile(KENNEY[pack]!.url, zip);
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  }
  credits.set(`kenney:${pack}`, { key: `kenney:${pack}`, title: `${KENNEY[pack]!.title} (Kenney)`, author: 'Kenney (www.kenney.nl)', url: `https://kenney.nl/assets/${pack}`, license: 'CC0 1.0' });
  return join(dir, 'Audio');
}

function freesound(id: number): string {
  const user = FREESOUND[id]!;
  const file = join(cache, `fs_${id}.ogg`);
  const meta = join(cache, `fs_${id}.json`);
  const page = `https://freesound.org/people/${user}/sounds/${id}/`;
  if (!existsSync(meta)) {
    const html = curlText(page);
    if (!/creativecommons\.org\/publicdomain\/zero/.test(html)) throw new Error(`freesound ${id} is not CC0`);
    if (/minecraft/i.test(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '')) throw new Error(`freesound ${id} mentions Minecraft`);
    const title = (html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? `sound ${id}`).replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'");
    const lq = html.match(new RegExp(`https://cdn\\.freesound\\.org/previews/\\d+/${id}_\\d+-(?:lq|hq)\\.ogg`))?.[0];
    if (!lq) throw new Error(`freesound ${id}: no preview link`);
    const preview = lq.replace('-lq.ogg', '-hq.ogg');
    writeFileSync(meta, JSON.stringify({ title, preview }));
  }
  const { title, preview } = JSON.parse(readFileSync(meta, 'utf8')) as { title: string; preview: string };
  if (!existsSync(file)) curlFile(preview, file);
  credits.set(`freesound:${id}`, { key: `freesound:${id}`, title, author: user, url: page, license: 'CC0 1.0' });
  return file;
}

// ------------------------------------------------------------------ clip helpers
type Clip = { samples: Float32Array; source: string };
const clean = (s: Float32Array, peakDb = -3) => fade(normalize(trim(s), peakDb));

function kenney(pack: string, ...names: string[]): Clip[] {
  const dir = kenneyDir(pack);
  return names.map((n) => ({ samples: clean(decode(join(dir, `${n}.ogg`))), source: `kenney:${pack}` }));
}
const range = (prefix: string, n: number, pad = 3) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(pad, '0')}`);

function fsSlices(id: number, count: number, maxLen: number, opts: { skip?: number; minGap?: number; peakDb?: number } = {}): Clip[] {
  const s = decode(freesound(id));
  return sliceOnsets(s, { count, maxLen, skip: opts.skip, minGap: opts.minGap }).map((c) => ({ samples: clean(c, opts.peakDb), source: `freesound:${id}` }));
}
function fsWhole(id: number, maxLen = 30, peakDb = -3): Clip[] {
  const s = decode(freesound(id));
  return [{ samples: clean(section(trim(s), 0, maxLen), peakDb), source: `freesound:${id}` }];
}
function fsSections(id: number, parts: [number, number][], peakDb = -3): Clip[] {
  const s = decode(freesound(id));
  return parts.map(([a, l]) => ({ samples: fade(normalize(section(s, a, l), peakDb), 20, 120), source: `freesound:${id}` }));
}
const quieter = (clips: Clip[], db: number): Clip[] => clips.map((c) => ({ ...c, samples: gain(c.samples, db) }));

// ------------------------------------------------------------------ clip sets
const SETS: Record<string, () => Clip[]> = {
  dig_stone: () => kenney('impact-sounds', ...range('impactMining_', 5)),
  step_stone: () => kenney('impact-sounds', ...range('footstep_concrete_', 5)),
  dig_wood: () => kenney('impact-sounds', ...range('impactWood_medium_', 5)),
  step_wood: () => kenney('impact-sounds', ...range('footstep_wood_', 5)),
  dig_gravel: () => fsSlices(521588, 4, 0.5),
  step_gravel: () => fsSlices(117627, 6, 0.45, { skip: 1 }),
  dig_grass: () => [...fsWhole(327894, 0.6), ...fsSlices(364712, 3, 0.6)],
  step_grass: () => kenney('impact-sounds', ...range('footstep_grass_', 5)),
  dig_sand: () => [...fsWhole(651292, 0.5), ...fsWhole(651293, 0.6), ...fsWhole(560957, 0.7)],
  step_sand: () => [...fsWhole(778568, 0.5), ...fsSlices(655366, 4, 0.45, { minGap: 0.35, skip: 1 })],
  dig_snow: () => fsSlices(384423, 2, 0.6).concat(kenney('impact-sounds', 'footstep_snow_000', 'footstep_snow_003')),
  step_snow: () => kenney('impact-sounds', ...range('footstep_snow_', 5)),
  dig_cloth: () => kenney('rpg-audio', 'cloth1', 'cloth2', 'cloth3', 'cloth4'),
  step_cloth: () => kenney('impact-sounds', ...range('footstep_carpet_', 5)),
  glass_break: () => [...fsWhole(221528, 1.9), ...fsWhole(371094, 1.8), ...fsWhole(554570, 2.2)],
  step_ladder: () => kenney('impact-sounds', ...range('impactPlank_medium_', 5)),
  thunder: () => [...fsWhole(840628, 12), ...fsWhole(683421, 7), ...fsWhole(696550, 7)],
  thunder_impact: () => fsSections(840628, [[0, 2.5]]),
  rain: () => fsSections(513395, [[0.5, 1.6], [3, 1.6], [6, 1.6], [9, 1.6]], -8),
  rain_above: () => fsSections(21190, [[0, 1.4], [1.5, 1.4], [3, 1.4]], -10),
  player_hurt: () => [...fsWhole(719053, 0.6), ...fsWhole(438912, 0.6)],
  fall_big: () => fsWhole(504626, 1.6),
  fall_small: () => fsWhole(82027, 0.5),
  swim: () => quieter(fsSlices(637956, 4, 0.8, { minGap: 0.4 }), -2),
  splash: () => fsWhole(398032, 1.4),
  pop: () => [...fsWhole(323741, 0.3), ...fsWhole(573152, 0.4)],
  click: () => kenney('ui-audio', 'click1'),
  attack_strong: () => kenney('impact-sounds', ...range('impactPunch_heavy_', 5)),
  attack_weak: () => quieter(kenney('impact-sounds', ...range('impactPunch_medium_', 5)), -4),
  attack_knockback: () => kenney('impact-sounds', ...range('impactSoft_heavy_', 5)),
  attack_nodamage: () => quieter(kenney('impact-sounds', ...range('impactSoft_medium_', 5)), -6),
  attack_sweep: () => [...fsWhole(389590, 0.4), ...fsWhole(507466, 0.9)],
  orb: () => [...fsWhole(66876, 0.35), ...fsWhole(515643, 0.35)],
  levelup: () => fsWhole(452379, 2),
  door_open: () => kenney('rpg-audio', 'doorOpen_1', 'doorOpen_2'),
  door_close: () => kenney('rpg-audio', 'doorClose_1', 'doorClose_2', 'doorClose_3', 'doorClose_4'),
  metal_latch: () => kenney('rpg-audio', 'metalLatch', 'metalClick'),
  chest_creak: () => kenney('rpg-audio', 'creak1', 'creak2', 'creak3'),
};

// ------------------------------------------------------------------ events → sets
type Ref = { set: string; volume?: number; pitch?: number };
const EVENTS: Record<string, Ref[]> = {};

/** block sound groups → (dig set, step set, pitch) */
const FAMILY: Record<string, [string, string, number?]> = {
  wood: ['dig_wood', 'step_wood'], ladder: ['dig_wood', 'step_ladder'], scaffolding: ['dig_wood', 'step_ladder', 1.2],
  bamboo: ['dig_wood', 'step_wood', 1.3], stem: ['dig_wood', 'step_wood', 0.85], hard_crop: ['dig_wood', 'step_wood'],
  gravel: ['dig_gravel', 'step_gravel'], rooted_dirt: ['dig_gravel', 'step_gravel', 0.9], soul_soil: ['dig_gravel', 'step_gravel', 0.75],
  grass: ['dig_grass', 'step_grass'], wet_grass: ['dig_grass', 'step_grass', 0.85], crop: ['dig_grass', 'step_grass'],
  vine: ['dig_grass', 'step_grass', 1.1], sweet_berry_bush: ['dig_grass', 'step_grass'], azalea_leaves: ['dig_grass', 'step_grass'],
  azalea: ['dig_grass', 'step_grass'], flowering_azalea: ['dig_grass', 'step_grass'], moss: ['dig_cloth', 'step_cloth', 0.8],
  moss_carpet: ['dig_cloth', 'step_cloth', 0.8], big_dripleaf: ['dig_grass', 'step_grass', 0.9], small_dripleaf: ['dig_grass', 'step_grass', 1.1],
  hanging_roots: ['dig_grass', 'step_grass', 0.9], cave_vines: ['dig_grass', 'step_grass', 1.1], spore_blossom: ['dig_grass', 'step_grass', 1.2],
  roots: ['dig_grass', 'step_grass', 0.8], fungus: ['dig_grass', 'step_grass', 0.8], weeping_vines: ['dig_grass', 'step_grass', 0.8],
  nether_sprouts: ['dig_grass', 'step_grass', 0.9], lily_pad: ['dig_grass', 'step_grass'],
  sand: ['dig_sand', 'step_sand'], soul_sand: ['dig_sand', 'step_sand', 0.7],
  snow: ['dig_snow', 'step_snow'], powder_snow: ['dig_snow', 'step_snow', 1.1],
  wool: ['dig_cloth', 'step_cloth'], candle: ['dig_cloth', 'step_cloth', 1.3],
  slime_block: ['dig_cloth', 'step_cloth', 0.7], honey_block: ['dig_cloth', 'step_cloth', 0.6], coral_block: ['dig_stone', 'step_stone', 1.1],
  stone: ['dig_stone', 'step_stone'], glass: ['dig_stone', 'step_stone'], metal: ['dig_stone', 'step_stone'],
  anvil: ['dig_stone', 'step_stone'], lantern: ['dig_stone', 'step_stone', 1.3], chain: ['dig_stone', 'step_stone', 1.4],
  netherrack: ['dig_stone', 'step_stone', 0.75], nether_bricks: ['dig_stone', 'step_stone', 0.85], nether_ore: ['dig_stone', 'step_stone', 0.8],
  nether_gold_ore: ['dig_stone', 'step_stone', 0.85], basalt: ['dig_stone', 'step_stone', 0.8], nylium: ['dig_gravel', 'step_gravel', 0.8],
  wart_block: ['dig_cloth', 'step_cloth', 0.7], shroomlight: ['dig_cloth', 'step_cloth', 1.1], bone_block: ['dig_stone', 'step_stone', 1.2],
  netherite_block: ['dig_stone', 'step_stone', 0.7], ancient_debris: ['dig_stone', 'step_stone', 0.65], lodestone: ['dig_stone', 'step_stone', 0.9],
  gilded_blackstone: ['dig_stone', 'step_stone', 0.95], amethyst_block: ['dig_stone', 'step_stone', 1.5], amethyst_cluster: ['dig_stone', 'step_stone', 1.6],
  tuff: ['dig_stone', 'step_stone', 0.85], calcite: ['dig_stone', 'step_stone', 1.15], dripstone_block: ['dig_stone', 'step_stone', 0.95],
  pointed_dripstone: ['dig_stone', 'step_stone', 1.1], copper: ['dig_stone', 'step_stone', 1.25], deepslate: ['dig_stone', 'step_stone', 0.8],
  deepslate_bricks: ['dig_stone', 'step_stone', 0.82], deepslate_tiles: ['dig_stone', 'step_stone', 0.84], polished_deepslate: ['dig_stone', 'step_stone', 0.86],
  sculk_sensor: ['dig_cloth', 'step_cloth', 0.8],
};
for (const t of Object.values(SOUND_TYPES)) {
  for (const [kind, ev] of [['break', t.break], ['place', t.place], ['step', t.step], ['hit', t.hit], ['fall', t.fall]] as const) {
    if (EVENTS[ev]) continue;
    const g = ev.split('.')[1]!;
    const fam = FAMILY[g] ?? FAMILY[ev.split('.')[1]!.replace(/_(break|place)$/, '')];
    if (!fam) continue;
    const [dig, step, pitch] = fam;
    EVENTS[ev] = [{ set: kind === 'break' || kind === 'place' ? dig : step, pitch }];
  }
}
// vanilla structure exceptions
EVENTS['block.glass.break'] = [{ set: 'glass_break' }];
EVENTS['block.crop.break'] = [{ set: 'dig_grass' }];
EVENTS['item.crop.plant'] = [{ set: 'dig_grass' }];
EVENTS['block.lily_pad.place'] = [{ set: 'dig_grass' }];
EVENTS['block.sweet_berry_bush.break'] = [{ set: 'dig_grass' }];
EVENTS['block.sweet_berry_bush.place'] = [{ set: 'dig_grass' }];
EVENTS['block.nether_wart.break'] = [{ set: 'dig_grass', pitch: 0.8 }];
EVENTS['item.nether_wart.plant'] = [{ set: 'dig_grass', pitch: 0.8 }];
EVENTS['block.bamboo_sapling.break'] = [{ set: 'dig_grass', pitch: 1.2 }];
EVENTS['block.bamboo_sapling.place'] = [{ set: 'dig_grass', pitch: 1.2 }];
EVENTS['block.bamboo_sapling.hit'] = [{ set: 'step_grass', pitch: 1.2 }];
for (const b of ['small', 'medium', 'large']) {
  EVENTS[`block.${b}_amethyst_bud.break`] = [{ set: 'dig_stone', pitch: 1.6 }];
  EVENTS[`block.${b}_amethyst_bud.place`] = [{ set: 'dig_stone', pitch: 1.6 }];
}
Object.assign(EVENTS, {
  'entity.lightning_bolt.thunder': [{ set: 'thunder' }],
  'entity.lightning_bolt.impact': [{ set: 'thunder_impact' }],
  'weather.rain': [{ set: 'rain' }],
  'weather.rain.above': [{ set: 'rain_above' }],
  'entity.player.hurt': [{ set: 'player_hurt' }],
  'entity.player.death': [{ set: 'player_hurt' }],
  'entity.player.hurt_on_fire': [{ set: 'player_hurt' }],
  'entity.player.hurt_drown': [{ set: 'player_hurt' }],
  'entity.player.hurt_sweet_berry_bush': [{ set: 'player_hurt' }],
  'entity.player.hurt_freeze': [{ set: 'player_hurt' }],
  'entity.player.big_fall': [{ set: 'fall_big' }],
  'entity.player.small_fall': [{ set: 'fall_small' }],
  'entity.player.swim': [{ set: 'swim' }],
  'entity.player.splash': [{ set: 'splash' }],
  'entity.player.splash.high_speed': [{ set: 'splash' }],
  'entity.item.pickup': [{ set: 'pop' }],
  'ui.button.click': [{ set: 'click' }],
  'entity.player.attack.strong': [{ set: 'attack_strong' }],
  'entity.player.attack.weak': [{ set: 'attack_weak' }],
  'entity.player.attack.crit': [{ set: 'attack_strong', pitch: 1.2 }],
  'entity.player.attack.knockback': [{ set: 'attack_knockback' }],
  'entity.player.attack.nodamage': [{ set: 'attack_nodamage' }],
  'entity.player.attack.sweep': [{ set: 'attack_sweep' }],
  'entity.experience_orb.pickup': [{ set: 'orb' }],
  'entity.player.levelup': [{ set: 'levelup' }],
  'block.wooden_door.open': [{ set: 'door_open' }],
  'block.wooden_door.close': [{ set: 'door_close' }],
  'block.wooden_trapdoor.open': [{ set: 'door_open', pitch: 1.2 }],
  'block.wooden_trapdoor.close': [{ set: 'door_close', pitch: 1.2 }],
  'block.iron_door.open': [{ set: 'metal_latch' }],
  'block.iron_door.close': [{ set: 'metal_latch', pitch: 0.9 }],
  'block.iron_trapdoor.open': [{ set: 'metal_latch', pitch: 1.1 }],
  'block.iron_trapdoor.close': [{ set: 'metal_latch' }],
  'block.fence_gate.open': [{ set: 'door_open', pitch: 1.1 }],
  'block.fence_gate.close': [{ set: 'door_close', pitch: 1.1 }],
  'block.chest.open': [{ set: 'chest_creak' }],
  'block.chest.close': [{ set: 'door_close', pitch: 1.1 }],
} satisfies Record<string, Ref[]>);

// item use (server/src/game/itemuse.ts): reuses of the recordings above until dedicated clips are cut
Object.assign(EVENTS, {
  'item.bucket.fill': [{ set: 'splash', pitch: 1.2 }],
  'item.bucket.empty': [{ set: 'splash', pitch: 0.9 }],
  'item.bucket.fill_lava': [{ set: 'splash', pitch: 0.6 }],
  'item.bucket.empty_lava': [{ set: 'splash', pitch: 0.55 }],
  'item.bucket.fill_powder_snow': [{ set: 'dig_snow' }],
  'item.armor.equip_leather': [{ set: 'dig_cloth' }],
  'item.armor.equip_chain': [{ set: 'metal_latch', pitch: 1.3 }],
  'item.armor.equip_iron': [{ set: 'metal_latch' }],
  'item.armor.equip_gold': [{ set: 'metal_latch', pitch: 1.2 }],
  'item.armor.equip_diamond': [{ set: 'metal_latch', pitch: 0.9 }],
  'item.armor.equip_netherite': [{ set: 'metal_latch', pitch: 0.7 }],
  'item.armor.equip_elytra': [{ set: 'dig_cloth', pitch: 1.2 }],
  'item.armor.equip_generic': [{ set: 'dig_cloth' }],
  'item.armor.equip_turtle': [{ set: 'dig_wood', pitch: 1.3 }],
  'entity.arrow.shoot': [{ set: 'attack_sweep', pitch: 1.3 }],
  'entity.arrow.hit': [{ set: 'step_wood', pitch: 1.2 }],
  'entity.arrow.hit_player': [{ set: 'orb' }],
  'item.flintandsteel.use': [{ set: 'metal_latch', pitch: 1.6 }],
  'block.pumpkin.carve': [{ set: 'dig_wood', pitch: 1.2 }],
  'entity.generic.eat': [{ set: 'dig_snow', pitch: 1.5 }],
  'entity.generic.drink': [{ set: 'swim', pitch: 1.5 }],
  'item.honey_bottle.drink': [{ set: 'swim', pitch: 1.2 }],
  'entity.item.break': [{ set: 'glass_break', pitch: 1.5 }],
  'entity.snowball.throw': [{ set: 'attack_sweep', pitch: 1.1 }],
  'entity.egg.throw': [{ set: 'attack_sweep', pitch: 1.1 }],
  'entity.ender_pearl.throw': [{ set: 'attack_sweep', pitch: 0.9 }],
} satisfies Record<string, Ref[]>);

/** Events the game currently plays (missing ones are reported). */
const HOOKED = new Set<string>([
  ...Object.values(SOUND_TYPES).flatMap((t) => [t.break, t.step, t.place, t.hit, t.fall]),
  'entity.lightning_bolt.thunder', 'entity.lightning_bolt.impact', 'weather.rain', 'weather.rain.above', 'entity.player.hurt',
  'entity.player.death', 'entity.player.hurt_on_fire', 'entity.player.hurt_drown', 'entity.player.hurt_sweet_berry_bush',
  'entity.player.hurt_freeze', 'entity.player.big_fall', 'entity.player.small_fall', 'entity.player.swim', 'entity.item.pickup',
  'ui.button.click', 'entity.player.attack.strong', 'entity.player.attack.weak', 'entity.player.attack.crit',
  'entity.player.attack.knockback', 'entity.player.attack.nodamage', 'entity.player.attack.sweep',
  'entity.experience_orb.pickup', 'entity.player.levelup',
  'item.bucket.fill', 'item.bucket.empty', 'item.bucket.fill_lava', 'item.bucket.empty_lava', 'item.bucket.fill_powder_snow', 'item.armor.equip_leather', 'item.armor.equip_chain', 'item.armor.equip_iron', 'item.armor.equip_gold', 'item.armor.equip_diamond', 'item.armor.equip_netherite', 'item.armor.equip_elytra', 'item.armor.equip_generic', 'item.armor.equip_turtle', 'entity.arrow.shoot', 'entity.arrow.hit', 'entity.arrow.hit_player', 'item.flintandsteel.use', 'block.pumpkin.carve', 'entity.generic.eat', 'entity.generic.drink', 'item.honey_bottle.drink', 'entity.item.break', 'entity.snowball.throw', 'entity.egg.throw', 'entity.ender_pearl.throw', 'entity.player.burp', 'item.chorus_fruit.teleport', 'entity.generic.burn',
]);

// ------------------------------------------------------------------ build
const valid = new Set(SOUND_EVENTS.map((e) => e.name));
for (const e of Object.keys(EVENTS)) if (!valid.has(e)) throw new Error(`not a 1.17.1 sound event: ${e}`);

if (existsSync(outDir)) for (const d of readdirSync(outDir)) if (d !== 'sounds.json') rmSync(join(outDir, d), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const used = new Set(Object.values(EVENTS).flatMap((r) => r.map((x) => x.set)));
const setFiles = new Map<string, { name: string; source: string }[]>();
for (const set of used) {
  const make = SETS[set];
  if (!make) throw new Error(`unknown set ${set}`);
  const clips = make();
  mkdirSync(join(outDir, set), { recursive: true });
  const files = clips.map((c, i) => {
    encode(c.samples, join(outDir, set, `${i}.ogg`));
    return { name: `${set}/${i}`, source: c.source };
  });
  setFiles.set(set, files);
  console.log(`${set}: ${files.length} clips`);
}
const manifest: Record<string, { sounds: { name: string; volume?: number; pitch?: number }[] }> = {};
for (const ev of [...Object.keys(EVENTS)].sort()) {
  manifest[ev] = { sounds: EVENTS[ev]!.flatMap((r) => setFiles.get(r.set)!.map((f) => ({ name: f.name, ...(r.volume ? { volume: r.volume } : {}), ...(r.pitch ? { pitch: r.pitch } : {}) }))) };
}
writeFileSync(join(outDir, 'sounds.json'), JSON.stringify(manifest, null, 1));

// credits
const used_sources = new Set([...setFiles.values()].flat().map((f) => f.source));
const lines = [...credits.values()].filter((c) => used_sources.has(c.key)).sort((a, b) => a.key.localeCompare(b.key))
  .map((c) => `| ${c.title} | ${c.author} | ${c.url} | ${c.license} | ${[...setFiles].filter(([, fs]) => fs.some((f) => f.source === c.key)).map(([s]) => s).join(', ')} |`);
const assetPath = join(root, 'ASSET_SOURCES.md');
let assets = readFileSync(assetPath, 'utf8');
const block = `<!-- sounds:begin (generated by tools/soundgen/build.ts) -->\n## Sounds\n\nAll recordings are CC0. They are trimmed, cut into single events, converted to mono Ogg Vorbis and peak-normalized by \`pnpm soundgen\`; nothing is synthesized.\n\n| Source | Author | URL | License | Used for (clip sets) |\n|---|---|---|---|---|\n${lines.join('\n')}\n<!-- sounds:end -->`;
assets = assets.includes('<!-- sounds:begin') ? assets.replace(/<!-- sounds:begin[\s\S]*?<!-- sounds:end -->/, block) : `${assets.trimEnd()}\n\n${block}\n`;
writeFileSync(assetPath, assets);

const missing = [...HOOKED].filter((e) => !manifest[e]?.sounds.length).sort();
writeFileSync(join(root, 'tools/soundgen/missing.txt'), missing.join('\n') + '\n');
console.log(`sounds.json: ${Object.keys(manifest).length} events, ${[...setFiles.values()].flat().length} files; ${missing.length} hooked events still silent`);
