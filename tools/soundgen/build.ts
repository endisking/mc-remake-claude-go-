/**
 * Sound build: downloads CC0 recordings (Kenney packs, Freesound), cuts/trims/normalizes them
 * into short clips, writes client/public/sounds/<set>/<n>.ogg and sounds.json (vanilla sound
 * event → clip variants), credits each source in ASSET_SOURCES.md and reports hooked events
 * that still have no audio. Usage: pnpm soundgen
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { decode, encode, trim, normalize, fade, section, sliceOnsets, gain, detectPitch, repitch } from './audio';
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
  'digital-audio': { url: 'https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip', title: 'Digital Audio' },
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
  // ---- Phase 10 additions
  442906: 'qubodup', 442907: 'qubodup', 442905: 'qubodup', 442904: 'qubodup', // pig oink / grunt / sound / squeak
  546479: 'invertedturtle', 546481: 'invertedturtle', // cow moo
  401636: 'Mystikuum', // cows mooing
  171149: 'esperar', 171151: 'esperar', // sheep
  677221: 'satoristudios3', // ewe baa
  710300: 'michaelperfect', // sheep baaing
  668804: 'MBPL', // chicken clucking
  424076: 'chanyatenn', // chicken clucking
  517778: 'SamuelGremaud', // hen
  233097: 'JarredGibb', // chicken buck
  754438: 'OwNathan', 754441: 'OwNathan', // zombie groans
  555417: 'tonsil5', 555426: 'tonsil5', 555412: 'tonsil5', // zombie growl / pain / death
  851777: 'scorpion67890', 851775: 'scorpion67890', // decayed zombie hurt / death
  163447: 'Under7dude', // zombie hit
  473526: 'Kneeling', // bones
  147993: 'bewareofkites20', // bone cracking
  257927: 'Kane53126', // bones crack
  145363: 'kleanthism', // cracking bone
  760564: 'NoisyRedFox', // insect
  205754: 'scorpion67890', // surge leech (hiss)
  672710: 'kongg_', 672712: 'kongg_', // spider attack
  408572: 'miguelab1998', // spider steps
  237407: 'squareal', // match sizzle (fuse)
  372186: 'Seidolon', // fuse
  446624: 'IdkMrGarcia', // explosion2
  482993: 'V-ktor', // large explosion
  609588: 'unfa', // firecracker explosion
  816237: 'qubodup', // crunch
  275015: 'wadaltmon', 250106: 'phatcorns', 584290: 'AntumDeluge', // apple bites
  344406: 'jawbutch', 517672: 'danlucaz', 777238: 'sblitzer', // burps
  531755: 'magnuswaker', 552676: 'BOAAY', 534336: 'Defaultv', // gulps
  263675: 'PorkMuncher', 443832: 'checholio', 443819: 'checholio', // bow release
  205938: 'Twisted_Euphoria', 521552: 'omerbhatti34', 536066: 'EminYILDIRIM', // arrow impacts
  650574: 'soundofsong', // fire crackling loop
  714566: 'LilMati', // cozy campfire
  558983: 'cyberthilop', // fire crackling
  474849: 'Fission9', // lava loop
  253956: 'Mafon2', 733264: 'arttim', 683587: 'YehawSnail', 411462: 'TheBuilder15', // bubble pops
  265305: 'lextrack', // water flowing
  321490: 'dslrguide', // tiny splash
  554595: 'jakubp.jp', // stick into water
  398039: 'swordofkings128', // water splash 2
  841834: 'Robo9418', // small puddle splash
  737659: 'tiagusilva37', // hot lava ball
  456806: 'Breviceps', // hot bubbling mud
  174458: 'yottasounds', // cave wind
  392668: 'corkob', // cave water drips
  514500: 'szegvari', // big hall cave
  504641: 'Fission9', // underwater ambience
  660565: 'cfedorek16', // water bubbling close
  234782: 'wubitog', // steam hiss
  333698: 'Khrinx', // soda fizz
  151271: 'timgormly', 696746: 'Krokulator', // levers
  257357: 'brnck', 629020: 'Kolombooo', // button clicks
  466272: 'proolsen', 422870: 'IPaddeh', // pressure plates
  270588: 'michorvath', 270589: 'michorvath', // anvil hits
  614832: 'arseniiv', 614833: 'arseniiv', // crystal bells
  728699: 'PaperMacheToothPicksSeaAnenome', // glass bell tapping
  442772: 'qubodup', 433840: 'Archos', // slime squish
  536737: 'egomassive', // chain
  262635: 'j_p_higgins', // ice crack
  // more mobs
  277058: 'kwahmah_02', // single dog bark
  118970: 'esperri', // dog whine
  345733: 'noahpardo', // deep growl
  110011: 'tuberatanka', 412017: 'skymary', 479272: 'steffcaffrey', // cat meows
  528197: 'fthgurdy', 732521: 'Lukey1028', // cat meow / begging meow
  521246: 'poodaddy69', // horse
  868302: 'TheKingOfGeeks360', // horse snort
  445958: 'Breviceps', 468442: 'Breviceps', // bat squeaks
  417826: 'AntumDeluge', // witch cackle
  754399: '3LMN_audio', // witch giggle
  348142: 'NikoMyth', // witch's laugh
  170768: 'esperar', // hmm question
  165011: 'DAN2008', // hmmmm
  697497: 'kanyonwyvern', 699008: 'kanyonwyvern', // hmm
  683259: 'saha213131', 691476: 'saha213131', // goat
  677218: 'satoristudios3', // mini goat baa
  481647: 'JonCon_Library', // bee buzzing
  150950: 'outroelison', // teleport
  375972: 'Glitchedtones', // teleportation
  329519: 'SirBedlam', // ghost moan
  261336: 'Stereo Surgeon', // slowmo voice growl
  530355: 'danielpodlovics', // fire whoosh
  111331: 'j1987', // flame click
  389634: '_stubb', 389633: '_stubb', // wing flaps
  // nether biome ambience
  567220: 'Fission9', // drone loop
  564621: 'Nox_Sound', // fire bushes loop
  866270: 'kkenny101', // eerie insectoid drone loop
  673323: 'Dentrabert', // wind howl
  321812: 'mmasonghi', // cinematic deep bass rumble
  362297: 'eurekaliza94', // eerie ambience
  639414: 'medoob', // horror cinematic rumble
  537792: 'szegvari', // cave temple creatures ambience
  // note block instruments (single notes, retuned to the vanilla base pitch by the build)
  68448: 'pinkyfinger', // piano G
  632255: 'Cloud-10', // piano bell sound (C3)
  660533: 'TheEndOfACycle', // bass guitar pluck
  400707: 'Mattc90', // subby kick drum
  581461: 'johnnydekk', // acoustic kick
  689553: 'Shōtotsu', // snare drum
  178668: 'Hanbaal', // snare
  674296: 'TheEndOfACycle', // hi-hat closed
  250530: 'waveplaySFX', // hi hat
  352493: 'joseph.larralde', // glockenspiel A
  258199: 'sastesty', // flute D4
  592440: 'Baconation', // guitar pluck
  374705: 'sgossner', // xylophone F#5
  193212: 'eliasheuninck', // metallophone
  75339: 'Neotone', // cowbell
  204912: 'Noxdl', // didgeridoo
  // music (calm ambient piano / pads)
  679738: 'Seth_Makes_Sounds', // Calming Piano Loop 60bpm
  832628: 'Jadis0x', // Calm Ambient Piano Loop
  810857: 'CVLTIV8R', // Piano Ambience chord progression
  703138: 'deadrobotmusic', // Ambient Piano Guitar Texture
  808032: 'deadrobotmusic', // Ambient F Sharp Minor Ethereal Choir Pad
  197244: 'Yuval', // gloomy ambient pad
  685733: 'xkeril', // drone underwater slow
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
  const page = `https://freesound.org/people/${encodeURIComponent(user)}/sounds/${id}/`;
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
type Clip = { samples: Float32Array; source: string; quality?: number };
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
  // ---- Phase 10: block groups with their own character
  amethyst: () => [...fsWhole(614832, 1.2), ...fsWhole(614833, 1.2), ...fsSlices(728699, 2, 0.9)],
  amethyst_step: () => quieter([...fsWhole(614832, 0.5), ...fsWhole(614833, 0.5)], -6),
  slime: () => [...fsWhole(442772, 0.5), ...fsSlices(433840, 2, 0.45)],
  chain: () => [...fsSlices(536737, 3, 0.4, { minGap: 0.15 }), ...quieter(kenney('impact-sounds', 'impactMetal_light_000', 'impactMetal_light_002'), -4)],
  metal_light: () => kenney('impact-sounds', ...range('impactMetal_light_', 5)),
  metal_heavy: () => kenney('impact-sounds', ...range('impactMetal_heavy_', 5)),
  plate: () => kenney('impact-sounds', ...range('impactPlate_medium_', 5)),
  bell: () => kenney('impact-sounds', ...range('impactBell_heavy_', 5)),
  glass_light: () => kenney('impact-sounds', ...range('impactGlass_light_', 5)),
  book_flip: () => kenney('rpg-audio', 'bookFlip1', 'bookFlip2', 'bookFlip3'),
  book_place: () => kenney('rpg-audio', 'bookPlace1', 'bookPlace2', 'bookPlace3'),
  chop: () => [...kenney('rpg-audio', 'chop'), ...kenney('impact-sounds', 'impactWood_light_000', 'impactWood_light_001')],

  anvil_land: () => [...fsWhole(270588, 1.3), ...fsWhole(270589, 1.2)],
  ice_crack: () => fsWhole(262635, 1.1),
  // ---- mobs
  pig_say: () => [...fsWhole(442906, 0.8), ...fsWhole(442907, 0.5), ...fsWhole(442905, 0.7)],
  pig_hurt: () => fsWhole(442904, 0.8),
  cow_say: () => [...fsWhole(546479, 2.6), ...fsWhole(546481, 1.5), ...fsSlices(401636, 2, 1.8, { minGap: 1 })],
  cow_hurt: () => [...fsSections(546481, [[0, 0.6]]), ...fsSections(546479, [[0.1, 0.6]])],
  sheep_say: () => [...fsWhole(171149, 0.8), ...fsWhole(171151, 1.2), ...fsWhole(677221, 1.4), ...fsWhole(710300, 1.9)],
  chicken_say: () => [...fsWhole(668804, 0.8), ...fsSlices(424076, 2, 0.7, { minGap: 0.4 }), ...fsSections(517778, [[0, 0.8]])],
  chicken_hurt: () => fsSlices(233097, 2, 0.6),
  zombie_say: () => [...fsWhole(754438, 1.1), ...fsWhole(754441, 0.9), ...fsWhole(555417, 2.7)],
  zombie_hurt: () => [...fsWhole(555426, 0.9), ...fsWhole(851777, 1), ...fsWhole(163447, 0.4)],
  zombie_death: () => [...fsWhole(555412, 0.8), ...fsWhole(851775, 1.3)],
  skeleton_say: () => fsSlices(473526, 4, 0.9, { minGap: 0.5 }),
  skeleton_hurt: () => [...fsWhole(147993, 0.7), ...fsWhole(257927, 0.3), ...fsWhole(145363, 0.7)],
  spider_say: () => [...fsWhole(760564, 0.4), ...fsWhole(205754, 1.2), ...fsWhole(672712, 1.1)],
  spider_hurt: () => fsWhole(672710, 0.6),
  spider_step: () => quieter(fsSlices(408572, 4, 0.3, { minGap: 0.12 }), -4),
  creeper_hurt: () => [...fsWhole(816237, 0.4), ...fsWhole(147993, 0.5)],
  fuse: () => [...fsWhole(237407, 2.3), ...fsSections(372186, [[0, 2.5]])],
  explode: () => [...fsWhole(446624, 1.8), ...fsWhole(482993, 3.5), ...fsWhole(609588, 2.3)],
  mob_step_soft: () => quieter(kenney('impact-sounds', ...range('footstep_grass_', 5)), -2),
  mob_step_hard: () => quieter(kenney('impact-sounds', ...range('footstep_concrete_', 5)), -2),
  // ---- player / items
  eat: () => [...fsWhole(275015, 0.6), ...fsWhole(250106, 0.6), ...fsWhole(584290, 0.6)],
  burp: () => [...fsWhole(344406, 0.5), ...fsWhole(517672, 0.8), ...fsWhole(777238, 0.9)],
  drink: () => [...fsWhole(531755, 0.6), ...fsWhole(552676, 0.6), ...fsWhole(534336, 1)],
  bow_shoot: () => [...fsWhole(263675, 0.8), ...fsWhole(443832, 0.5), ...fsWhole(443819, 0.55)],
  arrow_hit: () => [...fsWhole(205938, 0.6), ...fsWhole(521552, 0.3), ...fsWhole(536066, 0.35)],
  item_break: () => [...fsWhole(257927, 0.3), ...fsWhole(816237, 0.4)],
  bucket_fill: () => [...fsWhole(321490, 1), ...fsWhole(554595, 0.5)],
  bucket_empty: () => [...fsWhole(398039, 1.2), ...fsWhole(841834, 0.45)],
  bucket_lava: () => [...fsWhole(737659, 1.2), ...fsSections(456806, [[1, 1.2]])],
  // ---- fluids, fire, environment
  fire: () => fsSections(650574, [[0, 1.6], [1.7, 1.6], [3.3, 1.6]], -8),
  furnace: () => fsSections(714566, [[0.2, 1.2], [1.6, 1.2], [3.2, 1.2]], -6),
  campfire: () => fsSections(558983, [[0.5, 1.5], [3, 1.5], [6, 1.5]], -6),
  lava_ambient: () => fsSections(474849, [[0, 3], [5, 3], [10, 3]], -6),
  lava_pop: () => [...fsWhole(253956, 0.25), ...fsWhole(733264, 0.2), ...fsWhole(683587, 0.4)],
  bubble_pop: () => [...fsWhole(411462, 0.5), ...fsWhole(253956, 0.25)],
  extinguish: () => [...fsWhole(234782, 1.5), ...fsWhole(333698, 0.35)],
  water_ambient: () => fsSections(265305, [[0.5, 2.5], [4, 2.5], [8, 2.5]], -8),
  cave: () => [...fsSections(174458, [[0, 6], [6, 6]], -4), ...fsSections(392668, [[2, 6], [10, 6]], -4), ...fsWhole(514500, 5.5, -4)],
  underwater_loop: () => fsWhole(504641, 47, -8),
  underwater_add: () => quieter(fsSlices(660565, 2, 1.2), -4),
  lever: () => [...fsWhole(151271, 0.6), ...fsWhole(696746, 0.6)],
  button: () => [...fsWhole(257357, 0.26), ...fsWhole(629020, 0.29)],
  pressure_plate: () => [...fsWhole(466272, 0.6), ...fsWhole(422870, 0.9)],
  portal: () => fsSections(685733, [[2, 4], [9, 4], [16, 4]], -6),
  nether_loop_wastes: () => fsWhole(567220, 10, -6),
  nether_loop_crimson: () => fsWhole(564621, 11, -6),
  nether_loop_warped: () => fsWhole(866270, 31, -6),
  nether_loop_soul: () => fsWhole(673323, 7, -6),
  nether_loop_basalt: () => fsWhole(321812, 29, -6),
  nether_mood: () => [...fsSections(362297, [[0, 5], [5, 4.9]], -4), ...fsSections(639414, [[0, 6], [8, 6]], -4)],
  nether_additions: () => fsSections(537792, [[0, 3], [3.2, 3], [6.4, 3]], -6),
  wolf_bark: () => fsWhole(277058, 0.4),
  wolf_whine: () => fsWhole(118970, 2.6),
  growl: () => fsWhole(345733, 2),
  cat_meow: () => [...fsWhole(110011, 1.6), ...fsWhole(412017, 1.8), ...fsWhole(479272, 0.95)],
  cat_hurt: () => fsWhole(528197, 0.6),
  cat_beg: () => fsWhole(732521, 1.4),
  horse_say: () => fsWhole(521246, 2.3),
  horse_snort: () => fsWhole(868302, 0.7),
  bat: () => [...fsWhole(445958, 0.45), ...fsWhole(468442, 0.2)],
  witch_say: () => [...fsWhole(417826, 1.2), ...fsWhole(754399, 1.05)],
  witch_laugh: () => fsWhole(348142, 3.6),
  villager_say: () => [...fsWhole(170768, 0.75), ...fsWhole(697497, 0.75), ...fsWhole(699008, 0.8), ...fsWhole(165011, 1.3)],
  goat_say: () => [...fsWhole(683259, 2.5), ...fsWhole(691476, 0.8), ...fsWhole(677218, 1.25)],
  bee_loop: () => fsSections(481647, [[0.2, 2]], -6),
  teleport: () => [...fsWhole(150950, 1.2), ...fsWhole(375972, 1)],
  moan: () => fsWhole(329519, 3.1),
  voice_growl: () => fsWhole(261336, 2.8),
  whoosh: () => [...fsWhole(530355, 0.75), ...fsWhole(111331, 0.95)],
  wings: () => [...fsWhole(389634, 0.95), ...fsWhole(389633, 1.2)],
  toast_in: () => kenney('interface-sounds', 'maximize_006'),
  toast_out: () => kenney('interface-sounds', 'minimize_006'),
};

/**
 * Note block instruments: one recorded note each, retuned so that pitch 1.0 (note 12) sounds the
 * vanilla base note: F#4 harp/pling/banjo/bit/iron xylophone, F#2 bass/didgeridoo, F#3 guitar,
 * F#5 flute/cow bell, F#6 bell/chime/xylophone. Percussion is left untuned.
 */
const FS = (oct: number) => 440 * 2 ** ((oct - 4) + (-3 / 12)); // F#<oct>
const noteLog: string[] = [];
function tuned(clip: Clip, target: number | null, maxLen = 1.6, knownHz?: number): Clip {
  let s = clip.samples;
  if (target) {
    const hz = knownHz ?? detectPitch(s);
    if (!hz) throw new Error(`no pitch found for ${clip.source}`);
    s = repitch(s, target / hz);
    noteLog.push(`${clip.source}: ${hz.toFixed(1)} Hz -> ${target.toFixed(1)} Hz`);
  }
  return { ...clip, samples: fade(normalize(section(trim(s), 0, maxLen), -3), 2, 250) };
}
const fsNote = (id: number, target: number | null, maxLen?: number, knownHz?: number): Clip[] => [tuned({ samples: decode(freesound(id)), source: `freesound:${id}` }, target, maxLen, knownHz)];
const NOTES: Record<string, () => Clip[]> = {
  note_harp: () => fsNote(68448, FS(4)),
  note_pling: () => fsNote(632255, FS(4)),
  note_bass: () => fsNote(660533, FS(2)),
  note_basedrum: () => [...fsNote(400707, null, 0.6), ...fsNote(581461, null, 0.6)],
  note_snare: () => [...fsNote(689553, null, 0.4), ...fsNote(178668, null, 0.3)],
  note_hat: () => [...fsNote(674296, null, 0.2), ...fsNote(250530, null, 0.2)],
  // bells and metallophones are inharmonic: their pitch is the strongest partial (measured by DFT)
  note_bell: () => fsNote(352493, FS(6), 1.6, 1863),
  note_flute: () => fsNote(258199, FS(5), 1.2),
  note_chime: () => fsNote(614832, FS(6), 1.6, 2468),
  note_guitar: () => fsNote(592440, FS(3)),
  note_xylophone: () => fsNote(374705, FS(6), 1, FS(5)),
  note_iron_xylophone: () => fsNote(193212, FS(4), 1.6, 1805),
  note_cow_bell: () => fsNote(75339, FS(5), 0.5),
  note_didgeridoo: () => fsNote(204912, FS(2), 1.2),
  note_banjo: () => fsNote(592440, FS(4), 0.8, 213),
  note_bit: () => [tuned({ samples: decode(join(kenneyDir('digital-audio'), 'tone1.ogg')), source: 'kenney:digital-audio' }, FS(4), 1)],
};
Object.assign(SETS, NOTES);

/** Music tracks: streamed, lower bitrate, long fades (vanilla music is relative and non-positional). */
const MUSIC: Record<string, () => Clip[]> = {
  music_calm1: () => fsMusic(679738),
  music_calm2: () => fsMusic(832628),
  music_calm3: () => fsMusic(810857),
  music_texture: () => fsMusic(703138),
  music_choir: () => fsMusic(808032),
  music_gloom: () => fsMusic(197244),
  music_deep: () => fsMusic(685733),
};
function fsMusic(id: number): Clip[] {
  const s = decode(freesound(id));
  return [{ samples: fade(normalize(trim(s), -4), 1500, 3000), source: `freesound:${id}`, quality: 0 }];
}
Object.assign(SETS, MUSIC);

// ------------------------------------------------------------------ events → sets
type Ref = { set: string; volume?: number; pitch?: number; stream?: boolean };
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

for (const inst of ['harp', 'pling', 'bass', 'basedrum', 'snare', 'hat', 'bell', 'flute', 'chime', 'guitar', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'banjo', 'bit']) {
  EVENTS[`block.note_block.${inst}`] = [{ set: `note_${inst}` }];
}
// ---- Phase 10: groups with dedicated recordings (override the pitched stone/cloth fallbacks)
const group5 = (g: string, dig: string, step: string, pitch?: number, digPitch?: number) => {
  EVENTS[`block.${g}.break`] = [{ set: dig, pitch: digPitch ?? pitch }];
  EVENTS[`block.${g}.place`] = [{ set: dig, pitch: digPitch ?? pitch }];
  for (const k of ['step', 'hit', 'fall']) EVENTS[`block.${g}.${k}`] = [{ set: step, pitch }];
};
group5('amethyst_block', 'amethyst', 'amethyst_step');
group5('amethyst_cluster', 'amethyst', 'amethyst_step', 1.2);
for (const b of ['small', 'medium', 'large']) {
  const p = b === 'small' ? 1.5 : b === 'medium' ? 1.4 : 1.3;
  EVENTS[`block.${b}_amethyst_bud.break`] = [{ set: 'amethyst', pitch: p }];
  EVENTS[`block.${b}_amethyst_bud.place`] = [{ set: 'amethyst', pitch: p }];
}
group5('slime_block', 'slime', 'slime');
group5('honey_block', 'slime', 'step_cloth', 0.75, 0.7);
group5('chain', 'chain', 'chain');
const stoneDig = (pitch: number): Ref[] => [{ set: 'dig_stone', pitch }];
const music = (...sets: string[]): Ref[] => sets.map((set) => ({ set, stream: true }));
group5('copper', 'plate', 'step_stone', 1.25, 1.1);
group5('lantern', 'metal_light', 'step_stone', 1.3, 1.2);
group5('netherite_block', 'metal_heavy', 'step_stone', 0.7, 0.8);
group5('ancient_debris', 'metal_heavy', 'step_stone', 0.65, 0.7);
Object.assign(EVENTS, {
  'block.bell.use': [{ set: 'bell' }],
  // remaining mobs and interactions (pitched reuses of the recordings above)
  'entity.piglin_brute.ambient': [{ set: 'pig_say', pitch: 0.75 }],
  'entity.piglin_brute.hurt': [{ set: 'pig_hurt', pitch: 0.75 }],
  'entity.piglin_brute.death': [{ set: 'pig_hurt', pitch: 0.6 }],
  'entity.piglin_brute.step': [{ set: 'mob_step_hard', pitch: 0.9 }],
  'entity.piglin_brute.angry': [{ set: 'pig_say', pitch: 0.65 }],
  'entity.skeleton_horse.ambient': [{ set: 'skeleton_say', pitch: 0.9 }],
  'entity.skeleton_horse.hurt': [{ set: 'skeleton_hurt', pitch: 0.8 }],
  'entity.skeleton_horse.death': [{ set: 'skeleton_say', pitch: 0.6 }],
  'entity.zombie_horse.ambient': [{ set: 'horse_say', pitch: 0.65 }],
  'entity.zombie_horse.hurt': [{ set: 'zombie_hurt', pitch: 0.8 }],
  'entity.zombie_horse.death': [{ set: 'zombie_death', pitch: 0.7 }],
  'entity.polar_bear.ambient': [{ set: 'growl', pitch: 0.9 }],
  'entity.polar_bear.ambient_baby': [{ set: 'growl', pitch: 1.4 }],
  'entity.polar_bear.hurt': [{ set: 'growl', pitch: 1.2 }],
  'entity.polar_bear.death': [{ set: 'growl', pitch: 0.7 }],
  'entity.polar_bear.step': [{ set: 'mob_step_soft', pitch: 0.7 }],
  'entity.polar_bear.warning': [{ set: 'growl', pitch: 0.8 }],
  'entity.snow_golem.ambient': [{ set: 'dig_snow', pitch: 0.9 }],
  'entity.snow_golem.hurt': [{ set: 'dig_snow', pitch: 1.2 }],
  'entity.snow_golem.death': [{ set: 'dig_snow', pitch: 0.8 }],
  'entity.snow_golem.shoot': [{ set: 'bow_shoot', pitch: 1.4 }],
  'entity.snow_golem.shear': [{ set: 'dig_cloth', pitch: 1.2 }],
  'entity.silverfish.ambient': [{ set: 'spider_say', pitch: 1.6 }],
  'entity.silverfish.hurt': [{ set: 'spider_hurt', pitch: 1.6 }],
  'entity.silverfish.death': [{ set: 'spider_say', pitch: 1.3 }],
  'entity.silverfish.step': [{ set: 'spider_step', pitch: 1.5 }],
  'entity.endermite.ambient': [{ set: 'spider_say', pitch: 1.8 }],
  'entity.endermite.hurt': [{ set: 'spider_hurt', pitch: 1.8 }],
  'entity.endermite.death': [{ set: 'spider_say', pitch: 1.5 }],
  'entity.endermite.step': [{ set: 'spider_step', pitch: 1.7 }],
  'entity.rabbit.ambient': [{ set: 'bat', pitch: 0.6 }],
  'entity.rabbit.hurt': [{ set: 'bat', pitch: 0.7 }],
  'entity.rabbit.death': [{ set: 'bat', pitch: 0.5 }],
  'entity.rabbit.jump': [{ set: 'mob_step_soft', pitch: 1.4 }],
  'entity.rabbit.attack': [{ set: 'attack_weak', pitch: 1.4 }],
  'entity.dolphin.ambient': [{ set: 'bat', pitch: 0.7 }],
  'entity.dolphin.ambient_water': [{ set: 'bat', pitch: 0.8 }],
  'entity.dolphin.hurt': [{ set: 'bat', pitch: 0.9 }],
  'entity.dolphin.death': [{ set: 'bat', pitch: 0.6 }],
  'entity.dolphin.splash': [{ set: 'splash', pitch: 1.2 }],
  'entity.dolphin.swim': [{ set: 'swim', pitch: 1.2 }],
  'entity.dolphin.jump': [{ set: 'splash', pitch: 1.3 }],
  'entity.dolphin.play': [{ set: 'bat', pitch: 1 }],
  'entity.dolphin.eat': [{ set: 'eat', pitch: 1.2 }],
  'entity.dolphin.attack': [{ set: 'attack_weak', pitch: 1.1 }],
  'entity.parrot.ambient': [{ set: 'chicken_say', pitch: 1.4 }],
  'entity.parrot.hurt': [{ set: 'chicken_hurt', pitch: 1.4 }],
  'entity.parrot.death': [{ set: 'chicken_hurt', pitch: 1.2 }],
  'entity.parrot.step': [{ set: 'mob_step_soft', pitch: 1.8 }],
  'entity.parrot.eat': [{ set: 'eat', pitch: 1.5 }],
  'entity.fox.ambient': [{ set: 'wolf_bark', pitch: 1.5 }],
  'entity.fox.hurt': [{ set: 'wolf_bark', pitch: 1.7 }],
  'entity.fox.death': [{ set: 'wolf_whine', pitch: 1.3 }],
  'entity.fox.sleep': [{ set: 'wolf_whine', pitch: 1.5 }],
  'entity.fox.eat': [{ set: 'eat', pitch: 1.3 }],
  'entity.fox.screech': [{ set: 'wolf_bark', pitch: 1.9 }],
  'entity.fox.bite': [{ set: 'attack_weak', pitch: 1.4 }],
  'entity.fox.sniff': [{ set: 'wolf_whine', pitch: 1.6 }],
  'entity.llama.ambient': [{ set: 'sheep_say', pitch: 0.8 }],
  'entity.llama.hurt': [{ set: 'sheep_say', pitch: 0.9 }],
  'entity.llama.death': [{ set: 'sheep_say', pitch: 0.7 }],
  'entity.llama.step': [{ set: 'mob_step_soft', pitch: 0.9 }],
  'entity.llama.spit': [{ set: 'bucket_empty', pitch: 1.6 }],
  'entity.llama.angry': [{ set: 'sheep_say', pitch: 0.75 }],
  'entity.llama.eat': [{ set: 'eat', pitch: 0.9 }],
  'entity.turtle.ambient_land': [{ set: 'slime', pitch: 0.7 }],
  'entity.turtle.hurt': [{ set: 'slime', pitch: 0.9 }],
  'entity.turtle.death': [{ set: 'slime', pitch: 0.7 }],
  'entity.turtle.shamble': [{ set: 'mob_step_soft', pitch: 0.6 }],
  'entity.turtle.swim': [{ set: 'swim', pitch: 0.9 }],
  'entity.turtle.lay_egg': [{ set: 'pop', pitch: 0.8 }],
  'entity.turtle.egg_crack': [{ set: 'pop', pitch: 1.2 }],
  'entity.turtle.egg_break': [{ set: 'pop', pitch: 0.7 }],
  'entity.cod.ambient': [{ set: 'underwater_add', pitch: 1.5 }],
  'entity.cod.hurt': [{ set: 'slime', pitch: 1.6 }],
  'entity.cod.death': [{ set: 'slime', pitch: 1.4 }],
  'entity.salmon.ambient': [{ set: 'underwater_add', pitch: 1.4 }],
  'entity.salmon.hurt': [{ set: 'slime', pitch: 1.5 }],
  'entity.salmon.death': [{ set: 'slime', pitch: 1.3 }],
  'entity.tropical_fish.ambient': [{ set: 'underwater_add', pitch: 1.6 }],
  'entity.tropical_fish.hurt': [{ set: 'slime', pitch: 1.7 }],
  'entity.tropical_fish.death': [{ set: 'slime', pitch: 1.5 }],
  'entity.pillager.ambient': [{ set: 'villager_say', pitch: 0.8 }],
  'entity.pillager.hurt': [{ set: 'villager_say', pitch: 0.9 }],
  'entity.pillager.death': [{ set: 'villager_say', pitch: 0.6 }],
  'entity.pillager.celebrate': [{ set: 'villager_say', pitch: 1 }],
  'entity.vindicator.ambient': [{ set: 'villager_say', pitch: 0.75 }],
  'entity.vindicator.hurt': [{ set: 'villager_say', pitch: 0.85 }],
  'entity.vindicator.death': [{ set: 'villager_say', pitch: 0.55 }],
  'entity.vindicator.celebrate': [{ set: 'villager_say', pitch: 0.95 }],
  'entity.evoker.ambient': [{ set: 'villager_say', pitch: 0.7 }],
  'entity.evoker.hurt': [{ set: 'villager_say', pitch: 0.8 }],
  'entity.evoker.death': [{ set: 'villager_say', pitch: 0.5 }],
  'entity.evoker.celebrate': [{ set: 'villager_say', pitch: 0.9 }],
  'entity.evoker.cast_spell': [{ set: 'amethyst', pitch: 0.6 }],
  'entity.evoker.prepare_attack': [{ set: 'amethyst', pitch: 0.7 }],
  'entity.evoker.prepare_summon': [{ set: 'amethyst', pitch: 0.8 }],
  'entity.evoker.prepare_wololo': [{ set: 'amethyst', pitch: 0.9 }],
  'entity.illusioner.ambient': [{ set: 'villager_say', pitch: 0.85 }],
  'entity.illusioner.hurt': [{ set: 'villager_say', pitch: 0.95 }],
  'entity.illusioner.death': [{ set: 'villager_say', pitch: 0.6 }],
  'entity.illusioner.cast_spell': [{ set: 'amethyst', pitch: 0.7 }],
  'entity.vex.ambient': [{ set: 'witch_say', pitch: 1.6 }],
  'entity.vex.hurt': [{ set: 'witch_say', pitch: 1.7 }],
  'entity.vex.death': [{ set: 'witch_say', pitch: 1.4 }],
  'entity.vex.charge': [{ set: 'attack_sweep', pitch: 1.5 }],
  'entity.ravager.ambient': [{ set: 'growl', pitch: 0.6 }],
  'entity.ravager.hurt': [{ set: 'growl', pitch: 0.8 }],
  'entity.ravager.death': [{ set: 'growl', pitch: 0.5 }],
  'entity.ravager.step': [{ set: 'mob_step_hard', pitch: 0.6 }],
  'entity.ravager.attack': [{ set: 'attack_strong', pitch: 0.6 }],
  'entity.ravager.roar': [{ set: 'voice_growl', pitch: 0.6 }],
  'entity.guardian.ambient': [{ set: 'moan', pitch: 1.5 }],
  'entity.guardian.hurt': [{ set: 'moan', pitch: 1.7 }],
  'entity.guardian.death': [{ set: 'moan', pitch: 1.2 }],
  'entity.guardian.ambient_land': [{ set: 'slime', pitch: 1.2 }],
  'entity.guardian.hurt_land': [{ set: 'slime', pitch: 1.4 }],
  'entity.guardian.death_land': [{ set: 'slime', pitch: 1 }],
  'entity.guardian.flop': [{ set: 'slime', pitch: 1.5 }],
  'entity.guardian.attack': [{ set: 'portal', pitch: 1.6 }],
  'entity.elder_guardian.ambient': [{ set: 'moan', pitch: 1.1 }],
  'entity.elder_guardian.hurt': [{ set: 'moan', pitch: 1.3 }],
  'entity.elder_guardian.death': [{ set: 'moan', pitch: 0.9 }],
  'entity.elder_guardian.ambient_land': [{ set: 'slime', pitch: 0.9 }],
  'entity.elder_guardian.hurt_land': [{ set: 'slime', pitch: 1 }],
  'entity.elder_guardian.death_land': [{ set: 'slime', pitch: 0.8 }],
  'entity.elder_guardian.flop': [{ set: 'slime', pitch: 1.2 }],
  'entity.elder_guardian.curse': [{ set: 'voice_growl', pitch: 1.3 }],
  'entity.shulker.ambient': [{ set: 'chest_creak', pitch: 0.8 }],
  'entity.shulker.hurt': [{ set: 'metal_light', pitch: 1.2 }],
  'entity.shulker.death': [{ set: 'metal_light', pitch: 0.9 }],
  'entity.shulker.open': [{ set: 'chest_creak', pitch: 0.9 }],
  'entity.shulker.close': [{ set: 'door_close', pitch: 0.9 }],
  'entity.shulker.shoot': [{ set: 'whoosh', pitch: 1.3 }],
  'entity.shulker.teleport': [{ set: 'teleport', pitch: 1.1 }],
  'entity.strider.ambient': [{ set: 'pig_say', pitch: 1.3 }],
  'entity.strider.hurt': [{ set: 'pig_hurt', pitch: 1.3 }],
  'entity.strider.death': [{ set: 'pig_hurt', pitch: 1.1 }],
  'entity.strider.step': [{ set: 'slime', pitch: 0.9 }],
  'entity.strider.step_lava': [{ set: 'lava_pop', pitch: 1 }],
  'entity.strider.happy': [{ set: 'pig_say', pitch: 1.5 }],
  'entity.strider.retreat': [{ set: 'pig_hurt', pitch: 1.4 }],
  'entity.strider.saddle': [{ set: 'dig_cloth', pitch: 1 }],
  'entity.strider.eat': [{ set: 'eat', pitch: 1.1 }],
  'entity.axolotl.idle_air': [{ set: 'bat', pitch: 1.1 }],
  'entity.axolotl.idle_water': [{ set: 'bat', pitch: 1.2 }],
  'entity.axolotl.hurt': [{ set: 'bat', pitch: 1.4 }],
  'entity.axolotl.death': [{ set: 'bat', pitch: 0.9 }],
  'entity.axolotl.attack': [{ set: 'attack_weak', pitch: 1.4 }],
  'entity.axolotl.splash': [{ set: 'splash', pitch: 1.4 }],
  'entity.axolotl.swim': [{ set: 'swim', pitch: 1.4 }],
  'entity.zoglin.ambient': [{ set: 'pig_say', pitch: 0.5 }],
  'entity.zoglin.angry': [{ set: 'pig_say', pitch: 0.45 }],
  'entity.zoglin.hurt': [{ set: 'pig_hurt', pitch: 0.5 }],
  'entity.zoglin.death': [{ set: 'pig_hurt', pitch: 0.45 }],
  'entity.zoglin.step': [{ set: 'mob_step_hard', pitch: 0.7 }],
  'entity.zoglin.attack': [{ set: 'attack_strong', pitch: 0.7 }],
  'entity.wither.ambient': [{ set: 'moan', pitch: 0.6 }],
  'entity.wither.hurt': [{ set: 'moan', pitch: 0.8 }],
  'entity.wither.death': [{ set: 'moan', pitch: 0.4 }],
  'entity.wither.shoot': [{ set: 'whoosh', pitch: 0.6 }],
  'entity.wither.break_block': [{ set: 'explode', pitch: 0.9 }],
  'entity.ender_dragon.ambient': [{ set: 'voice_growl', pitch: 0.5 }],
  'entity.ender_dragon.hurt': [{ set: 'voice_growl', pitch: 0.7 }],
  'entity.ender_dragon.death': [{ set: 'voice_growl', pitch: 0.4 }],
  'entity.ender_dragon.flap': [{ set: 'wings', pitch: 0.4 }],
  'entity.ender_dragon.shoot': [{ set: 'whoosh', pitch: 0.5 }],
  'entity.panda.ambient': [{ set: 'growl', pitch: 1.2 }],
  'entity.panda.hurt': [{ set: 'growl', pitch: 1.4 }],
  'entity.panda.death': [{ set: 'growl', pitch: 0.9 }],
  'entity.panda.step': [{ set: 'mob_step_soft', pitch: 0.8 }],
  'entity.panda.eat': [{ set: 'eat', pitch: 1 }],
  'entity.panda.sneeze': [{ set: 'burp', pitch: 1.5 }],
  'entity.panda.bite': [{ set: 'attack_weak', pitch: 1 }],
  'block.cake.add_candle': [{ set: 'dig_cloth', pitch: 1.2 }],
  'block.cave_vines.pick_berries': [{ set: 'dig_grass', pitch: 1.2 }],
  'block.sweet_berry_bush.pick_berries': [{ set: 'dig_grass', pitch: 1.2 }],
  'block.grindstone.use': [{ set: 'dig_stone', pitch: 0.8 }],
  'block.smithing_table.use': [{ set: 'anvil_land', pitch: 1.2 }],
  'item.axe.scrape': [{ set: 'chop', pitch: 1.3 }],
  'item.axe.wax_off': [{ set: 'chop', pitch: 1.4 }],
  'item.honeycomb.wax_on': [{ set: 'slime', pitch: 1.4 }],
  'ui.stonecutter.select_recipe': [{ set: 'click', pitch: 1.1 }],
  'block.pumpkin.carve': [{ set: 'dig_wood', pitch: 1.2 }],
  'item.honey_bottle.drink': [{ set: 'drink', pitch: 0.9 }],
  'entity.ender_pearl.throw': [{ set: 'bow_shoot', pitch: 1.2, volume: 0.5 }],
  'ambient.nether_wastes.loop': [{ set: 'nether_loop_wastes', stream: true }],
  'ambient.nether_wastes.mood': [{ set: 'nether_mood', pitch: 1 }],
  'ambient.nether_wastes.additions': [{ set: 'nether_additions', pitch: 1 }, { set: 'lava_pop', pitch: 1 }],
  'ambient.crimson_forest.loop': [{ set: 'nether_loop_crimson', stream: true }],
  'ambient.crimson_forest.mood': [{ set: 'nether_mood', pitch: 1.1 }],
  'ambient.crimson_forest.additions': [{ set: 'nether_additions', pitch: 1.1 }, { set: 'lava_pop', pitch: 1.1 }],
  'ambient.warped_forest.loop': [{ set: 'nether_loop_warped', stream: true }],
  'ambient.warped_forest.mood': [{ set: 'nether_mood', pitch: 0.9 }],
  'ambient.warped_forest.additions': [{ set: 'nether_additions', pitch: 0.9 }, { set: 'lava_pop', pitch: 0.9 }],
  'ambient.soul_sand_valley.loop': [{ set: 'nether_loop_soul', stream: true }],
  'ambient.soul_sand_valley.mood': [{ set: 'nether_mood', pitch: 0.8 }],
  'ambient.soul_sand_valley.additions': [{ set: 'nether_additions', pitch: 0.8 }, { set: 'lava_pop', pitch: 0.8 }],
  'ambient.basalt_deltas.loop': [{ set: 'nether_loop_basalt', stream: true }],
  'ambient.basalt_deltas.mood': [{ set: 'nether_mood', pitch: 0.7 }],
  'ambient.basalt_deltas.additions': [{ set: 'nether_additions', pitch: 0.7 }, { set: 'lava_pop', pitch: 0.7 }],
  'block.beacon.ambient': [{ set: 'portal', pitch: 1.5, volume: 0.6 }],
  'block.conduit.ambient': [{ set: 'underwater_add', pitch: 0.6 }],
  'block.end_portal.spawn': [{ set: 'portal', pitch: 0.5 }],
  'block.respawn_anchor.ambient': [{ set: 'portal', pitch: 0.7, volume: 0.6 }],
  'block.respawn_anchor.charge': [{ set: 'portal', pitch: 1.2 }],
  'block.respawn_anchor.deplete': [{ set: 'extinguish', pitch: 0.6 }],
  'block.respawn_anchor.set_spawn': [{ set: 'portal', pitch: 0.9 }],
  'block.sculk_sensor.clicking': [{ set: 'button', pitch: 0.6 }],
  'entity.ender_dragon.growl': [{ set: 'voice_growl', pitch: 0.6 }],
  'entity.wither.spawn': [{ set: 'moan', pitch: 0.5 }],
  'item.totem.use': [{ set: 'amethyst', pitch: 0.7 }],
  // more mobs (shared recordings, pitched per mob)
  'entity.wolf.ambient': [{ set: 'wolf_bark' }],
  'entity.wolf.hurt': [{ set: 'wolf_bark', pitch: 1.3 }],
  'entity.wolf.death': [{ set: 'wolf_whine', pitch: 0.8 }],
  'entity.wolf.whine': [{ set: 'wolf_whine' }],
  'entity.wolf.growl': [{ set: 'growl', pitch: 1.3 }],
  'entity.wolf.pant': [{ set: 'wolf_whine', pitch: 1.2, volume: 0.5 }],
  'entity.wolf.step': [{ set: 'mob_step_soft', pitch: 1.2 }],
  'entity.wolf.shake': [{ set: 'swim', pitch: 1.2 }],
  'entity.cat.ambient': [{ set: 'cat_meow' }],
  'entity.cat.stray_ambient': [{ set: 'cat_meow', pitch: 0.9 }],
  'entity.cat.beg_for_food': [{ set: 'cat_beg' }],
  'entity.cat.hurt': [{ set: 'cat_hurt' }],
  'entity.cat.death': [{ set: 'cat_beg', pitch: 0.8 }],
  'entity.cat.hiss': [{ set: 'spider_say', pitch: 1.3 }],
  'entity.cat.purr': [{ set: 'growl', pitch: 2, volume: 0.3 }],
  'entity.cat.purreow': [{ set: 'cat_meow', pitch: 1.1 }],
  'entity.ocelot.ambient': [{ set: 'cat_meow', pitch: 1.1 }],
  'entity.ocelot.hurt': [{ set: 'cat_hurt', pitch: 1.1 }],
  'entity.ocelot.death': [{ set: 'cat_beg', pitch: 0.9 }],
  'entity.horse.ambient': [{ set: 'horse_say' }],
  'entity.horse.angry': [{ set: 'horse_say', pitch: 1.1 }],
  'entity.horse.hurt': [{ set: 'horse_snort' }],
  'entity.horse.death': [{ set: 'horse_say', pitch: 0.8 }],
  'entity.horse.breathe': [{ set: 'horse_snort', volume: 0.5 }],
  'entity.horse.step': [{ set: 'mob_step_hard', pitch: 0.8 }],
  'entity.horse.step_wood': [{ set: 'step_wood', pitch: 0.8 }],
  'entity.horse.gallop': [{ set: 'mob_step_hard', pitch: 0.7 }],
  'entity.horse.jump': [{ set: 'horse_snort', pitch: 1.1 }],
  'entity.horse.land': [{ set: 'mob_step_hard', pitch: 0.6 }],
  'entity.horse.saddle': [{ set: 'dig_cloth' }],
  'entity.horse.armor': [{ set: 'metal_light' }],
  'entity.horse.eat': [{ set: 'eat', pitch: 0.8 }],
  'entity.donkey.ambient': [{ set: 'horse_say', pitch: 1.25 }],
  'entity.donkey.angry': [{ set: 'horse_say', pitch: 1.3 }],
  'entity.donkey.hurt': [{ set: 'horse_snort', pitch: 1.2 }],
  'entity.donkey.death': [{ set: 'horse_say', pitch: 1 }],
  'entity.mule.ambient': [{ set: 'horse_say', pitch: 1.15 }],
  'entity.mule.hurt': [{ set: 'horse_snort', pitch: 1.1 }],
  'entity.mule.death': [{ set: 'horse_say', pitch: 0.9 }],
  'entity.bat.ambient': [{ set: 'bat' }],
  'entity.bat.hurt': [{ set: 'bat', pitch: 1.2 }],
  'entity.bat.death': [{ set: 'bat', pitch: 0.8 }],
  'entity.bat.takeoff': [{ set: 'wings', pitch: 1.4 }],
  'entity.witch.ambient': [{ set: 'witch_say' }],
  'entity.witch.celebrate': [{ set: 'witch_laugh' }],
  'entity.witch.hurt': [{ set: 'witch_say', pitch: 1.2 }],
  'entity.witch.death': [{ set: 'witch_say', pitch: 0.8 }],
  'entity.witch.drink': [{ set: 'drink' }],
  'entity.witch.throw': [{ set: 'bow_shoot', pitch: 1.3, volume: 0.5 }],
  'entity.villager.ambient': [{ set: 'villager_say' }],
  'entity.villager.trade': [{ set: 'villager_say', pitch: 1.1 }],
  'entity.villager.yes': [{ set: 'villager_say', pitch: 1.2 }],
  'entity.villager.no': [{ set: 'villager_say', pitch: 0.8 }],
  'entity.villager.hurt': [{ set: 'villager_say', pitch: 1.3 }],
  'entity.villager.death': [{ set: 'villager_say', pitch: 0.7 }],
  'entity.villager.celebrate': [{ set: 'villager_say', pitch: 1.4 }],
  'entity.wandering_trader.ambient': [{ set: 'villager_say', pitch: 0.9 }],
  'entity.wandering_trader.trade': [{ set: 'villager_say', pitch: 1 }],
  'entity.wandering_trader.yes': [{ set: 'villager_say', pitch: 1.1 }],
  'entity.wandering_trader.no': [{ set: 'villager_say', pitch: 0.75 }],
  'entity.wandering_trader.hurt': [{ set: 'villager_say', pitch: 1.2 }],
  'entity.wandering_trader.death': [{ set: 'villager_say', pitch: 0.65 }],
  'entity.goat.ambient': [{ set: 'goat_say' }],
  'entity.goat.hurt': [{ set: 'goat_say', pitch: 1.2 }],
  'entity.goat.death': [{ set: 'goat_say', pitch: 0.85 }],
  'entity.goat.step': [{ set: 'mob_step_hard', pitch: 1.1 }],
  'entity.goat.screaming.ambient': [{ set: 'goat_say', pitch: 1.4 }],
  'entity.bee.loop': [{ set: 'bee_loop' }],
  'entity.bee.loop_aggressive': [{ set: 'bee_loop', pitch: 1.3 }],
  'entity.bee.hurt': [{ set: 'bee_loop', pitch: 1.5, volume: 0.7 }],
  'entity.bee.death': [{ set: 'bee_loop', pitch: 0.8, volume: 0.7 }],
  'entity.bee.sting': [{ set: 'arrow_hit', pitch: 1.6 }],
  'entity.bee.pollinate': [{ set: 'bee_loop', pitch: 1.2, volume: 0.5 }],
  'block.beehive.work': [{ set: 'bee_loop', pitch: 0.9, volume: 0.4 }],
  'entity.enderman.ambient': [{ set: 'moan', pitch: 1.4 }],
  'entity.enderman.hurt': [{ set: 'voice_growl', pitch: 1.5 }],
  'entity.enderman.death': [{ set: 'moan', pitch: 1.1 }],
  'entity.enderman.scream': [{ set: 'voice_growl', pitch: 1.8 }],
  'entity.enderman.stare': [{ set: 'voice_growl', pitch: 1.2 }],
  'entity.enderman.teleport': [{ set: 'teleport' }],
  'item.chorus_fruit.teleport': [{ set: 'teleport' }],
  'entity.ghast.ambient': [{ set: 'moan' }],
  'entity.ghast.hurt': [{ set: 'moan', pitch: 1.4 }],
  'entity.ghast.death': [{ set: 'moan', pitch: 0.8 }],
  'entity.ghast.scream': [{ set: 'moan', pitch: 1.6 }],
  'entity.ghast.warn': [{ set: 'moan', pitch: 1.2 }],
  'entity.ghast.shoot': [{ set: 'whoosh' }],
  'entity.blaze.ambient': [{ set: 'whoosh', pitch: 0.7 }],
  'entity.blaze.burn': [{ set: 'fire' }],
  'entity.blaze.hurt': [{ set: 'whoosh', pitch: 1.2 }],
  'entity.blaze.death': [{ set: 'whoosh', pitch: 0.6 }],
  'entity.blaze.shoot': [{ set: 'whoosh' }],
  'item.firecharge.use': [{ set: 'whoosh' }],
  'entity.phantom.ambient': [{ set: 'voice_growl', pitch: 1.6 }],
  'entity.phantom.swoop': [{ set: 'attack_sweep', pitch: 0.7 }],
  'entity.phantom.flap': [{ set: 'wings', pitch: 0.8 }],
  'entity.phantom.bite': [{ set: 'attack_strong', pitch: 1.3 }],
  'entity.phantom.hurt': [{ set: 'voice_growl', pitch: 1.8 }],
  'entity.phantom.death': [{ set: 'voice_growl', pitch: 1.3 }],
  'entity.parrot.fly': [{ set: 'wings', pitch: 1.3 }],
  'entity.zombified_piglin.ambient': [{ set: 'pig_say', pitch: 0.7 }],
  'entity.zombified_piglin.angry': [{ set: 'pig_say', pitch: 0.6 }],
  'entity.zombified_piglin.hurt': [{ set: 'pig_hurt', pitch: 0.7 }],
  'entity.zombified_piglin.death': [{ set: 'pig_hurt', pitch: 0.55 }],
  'entity.piglin.ambient': [{ set: 'pig_say', pitch: 0.85 }],
  'entity.piglin.angry': [{ set: 'pig_say', pitch: 0.75 }],
  'entity.piglin.hurt': [{ set: 'pig_hurt', pitch: 0.85 }],
  'entity.piglin.death': [{ set: 'pig_hurt', pitch: 0.7 }],
  'entity.piglin.step': [{ set: 'mob_step_hard', pitch: 0.95 }],
  'entity.piglin.admiring_item': [{ set: 'pig_say', pitch: 1 }],
  'entity.hoglin.ambient': [{ set: 'pig_say', pitch: 0.55 }],
  'entity.hoglin.angry': [{ set: 'pig_say', pitch: 0.5 }],
  'entity.hoglin.hurt': [{ set: 'pig_hurt', pitch: 0.55 }],
  'entity.hoglin.death': [{ set: 'pig_hurt', pitch: 0.5 }],
  'entity.hoglin.step': [{ set: 'mob_step_hard', pitch: 0.7 }],
  'entity.iron_golem.step': [{ set: 'metal_heavy', pitch: 0.7, volume: 0.6 }],
  'entity.iron_golem.hurt': [{ set: 'metal_heavy', pitch: 0.9 }],
  'entity.iron_golem.death': [{ set: 'metal_heavy', pitch: 0.6 }],
  'entity.iron_golem.attack': [{ set: 'metal_heavy', pitch: 0.8 }],
  'entity.iron_golem.repair': [{ set: 'metal_light', pitch: 0.9 }],
  'entity.squid.ambient': [{ set: 'underwater_add', pitch: 1.2 }],
  'entity.squid.hurt': [{ set: 'slime', pitch: 1.3 }],
  'entity.squid.death': [{ set: 'slime', pitch: 1 }],
  'entity.squid.squirt': [{ set: 'bucket_empty', pitch: 1.3 }],
  'entity.glow_squid.ambient': [{ set: 'underwater_add', pitch: 1.4 }],
  'entity.glow_squid.hurt': [{ set: 'slime', pitch: 1.5 }],
  'entity.glow_squid.death': [{ set: 'slime', pitch: 1.2 }],
  'entity.glow_squid.squirt': [{ set: 'bucket_empty', pitch: 1.5 }],
  'entity.cod.flop': [{ set: 'slime', pitch: 1.6, volume: 0.6 }],
  'entity.salmon.flop': [{ set: 'slime', pitch: 1.5, volume: 0.6 }],
  'entity.tropical_fish.flop': [{ set: 'slime', pitch: 1.7, volume: 0.6 }],
  'block.candle.ambient': [{ set: 'fire', volume: 0.5, pitch: 1.2 }],
  'block.candle.extinguish': [{ set: 'extinguish', volume: 0.6 }],
  'block.portal.ambient': [{ set: 'portal' }],
  'block.portal.trigger': [{ set: 'portal', pitch: 0.8 }],
  'block.portal.travel': [{ set: 'portal', pitch: 0.6 }],
  'block.bell.resonate': [{ set: 'bell', pitch: 0.9, volume: 0.6 }],
  'block.anvil.hit': [{ set: 'metal_heavy', volume: 0.6 }],
  'block.anvil.step': [{ set: 'metal_heavy', volume: 0.5 }],
  'block.anvil.fall': [{ set: 'metal_heavy' }],
  'block.lodestone.place': [{ set: 'metal_heavy', pitch: 0.9 }],
  'block.lodestone.break': [{ set: 'metal_heavy', pitch: 0.9 }],
  'item.book.page_turn': [{ set: 'book_flip' }],
  'item.book.put': [{ set: 'book_place' }],
  'item.axe.strip': [{ set: 'chop' }],
  'item.hoe.till': [{ set: 'dig_gravel' }],
  'item.shovel.flatten': [{ set: 'dig_grass' }],
  'item.bone_meal.use': [{ set: 'dig_grass', pitch: 1.3, volume: 0.8 }],
  'item.bottle.fill': [{ set: 'bucket_fill', pitch: 1.4 }],
  'item.bottle.fill_dragonbreath': [{ set: 'bucket_fill', pitch: 1.2 }],
  'item.bottle.empty': [{ set: 'bucket_empty', pitch: 1.4 }],
  'block.composter.fill': [{ set: 'dig_grass', pitch: 1.1 }],
  'block.composter.fill_success': [{ set: 'dig_grass', pitch: 0.9 }],
  'block.composter.empty': [{ set: 'dig_gravel' }],
  'block.composter.ready': [{ set: 'pop' }],
  'block.brewing_stand.brew': [{ set: 'bubble_pop', pitch: 0.8 }],
  'block.enchantment_table.use': [{ set: 'amethyst', pitch: 0.8 }],
  'block.beacon.activate': [{ set: 'amethyst', pitch: 0.6 }],
  'block.beacon.deactivate': [{ set: 'amethyst', pitch: 0.5 }],
  'block.beacon.power_select': [{ set: 'amethyst', pitch: 0.7 }],
  'entity.item_frame.place': [{ set: 'dig_wood', pitch: 1.2 }],
  'entity.item_frame.break': [{ set: 'dig_wood', pitch: 1.1 }],
  'entity.item_frame.add_item': [{ set: 'dig_cloth', pitch: 1.1 }],
  'entity.item_frame.remove_item': [{ set: 'dig_cloth', pitch: 1.2 }],
  'entity.item_frame.rotate_item': [{ set: 'dig_cloth', pitch: 1.3 }],
  'entity.painting.place': [{ set: 'dig_wood', pitch: 1.1 }],
  'entity.painting.break': [{ set: 'dig_wood' }],
  'entity.firework_rocket.launch': [{ set: 'attack_sweep', pitch: 0.7 }],
  'entity.firework_rocket.blast': [{ set: 'explode', pitch: 1.8, volume: 0.6 }],
  'entity.firework_rocket.large_blast': [{ set: 'explode', pitch: 1.4, volume: 0.8 }],
  'item.crossbow.shoot': [{ set: 'bow_shoot', pitch: 0.85 }],
  'item.crossbow.loading_start': [{ set: 'metal_latch', pitch: 0.9 }],
  'item.crossbow.loading_middle': [{ set: 'metal_latch', pitch: 1 }],
  'item.crossbow.loading_end': [{ set: 'metal_latch', pitch: 1.1 }],
  'item.trident.throw': [{ set: 'attack_sweep', pitch: 0.8 }],
  'item.trident.hit': [{ set: 'arrow_hit', pitch: 0.8 }],
  'item.trident.hit_ground': [{ set: 'arrow_hit', pitch: 0.7 }],
  'block.amethyst_block.chime': [{ set: 'amethyst' }],
  'block.honey_block.slide': [{ set: 'slime', pitch: 0.6, volume: 0.6 }],
  'block.anvil.place': [{ set: 'anvil_land' }],
  'block.anvil.land': [{ set: 'anvil_land' }],
  'block.anvil.use': [{ set: 'anvil_land', volume: 0.8 }],
  'block.anvil.destroy': [{ set: 'anvil_land', pitch: 0.8 }],
  'block.anvil.break': stoneDig(0.9),
  // mobs (the mob AI looks these up by vanilla name)
  'entity.pig.ambient': [{ set: 'pig_say' }],
  'entity.pig.hurt': [{ set: 'pig_hurt' }],
  'entity.pig.death': [{ set: 'pig_hurt', pitch: 0.8 }],
  'entity.pig.step': [{ set: 'mob_step_soft', pitch: 1.1 }],
  'entity.pig.saddle': [{ set: 'dig_cloth' }],
  'entity.cow.ambient': [{ set: 'cow_say' }],
  'entity.cow.hurt': [{ set: 'cow_hurt' }],
  'entity.cow.death': [{ set: 'cow_say', pitch: 0.85 }],
  'entity.cow.step': [{ set: 'mob_step_soft', pitch: 0.8 }],
  'entity.cow.milk': [{ set: 'bucket_fill', pitch: 1.1 }],
  'entity.mooshroom.milk': [{ set: 'bucket_fill', pitch: 1.1 }],
  'entity.mooshroom.suspicious_milk': [{ set: 'bucket_fill', pitch: 0.9 }],
  'entity.mooshroom.shear': [{ set: 'dig_cloth', pitch: 1.2 }],
  'entity.sheep.ambient': [{ set: 'sheep_say' }],
  'entity.sheep.hurt': [{ set: 'sheep_say', pitch: 1.15 }],
  'entity.sheep.death': [{ set: 'sheep_say', pitch: 0.9 }],
  'entity.sheep.step': [{ set: 'mob_step_soft', pitch: 1.1 }],
  'entity.sheep.shear': [{ set: 'dig_cloth', pitch: 1.2 }],
  'entity.chicken.ambient': [{ set: 'chicken_say' }],
  'entity.chicken.hurt': [{ set: 'chicken_hurt' }],
  'entity.chicken.death': [{ set: 'chicken_hurt', pitch: 0.85 }],
  'entity.chicken.step': [{ set: 'mob_step_soft', pitch: 1.6, volume: 0.6 }],
  'entity.chicken.egg': [{ set: 'pop' }],
  'entity.zombie.ambient': [{ set: 'zombie_say' }],
  'entity.zombie.hurt': [{ set: 'zombie_hurt' }],
  'entity.zombie.death': [{ set: 'zombie_death' }],
  'entity.zombie.step': [{ set: 'mob_step_hard', pitch: 0.9 }],
  'entity.zombie.attack_wooden_door': [{ set: 'dig_wood', pitch: 0.7 }],
  'entity.zombie.attack_iron_door': [{ set: 'metal_latch', pitch: 0.7 }],
  'entity.zombie.break_wooden_door': [{ set: 'dig_wood', pitch: 0.6 }],
  'entity.zombie.infect': [{ set: 'zombie_say', pitch: 1.1 }],
  'entity.zombie.destroy_egg': [{ set: 'pop', pitch: 0.7 }],
  'entity.husk.ambient': [{ set: 'zombie_say', pitch: 0.8 }],
  'entity.husk.hurt': [{ set: 'zombie_hurt', pitch: 0.8 }],
  'entity.husk.death': [{ set: 'zombie_death', pitch: 0.8 }],
  'entity.husk.step': [{ set: 'step_sand', pitch: 0.9 }],
  'entity.drowned.ambient': [{ set: 'zombie_say', pitch: 0.9 }],
  'entity.drowned.ambient_water': [{ set: 'zombie_say', pitch: 0.75 }],
  'entity.drowned.hurt': [{ set: 'zombie_hurt', pitch: 0.9 }],
  'entity.drowned.hurt_water': [{ set: 'zombie_hurt', pitch: 0.75 }],
  'entity.drowned.death': [{ set: 'zombie_death', pitch: 0.9 }],
  'entity.drowned.death_water': [{ set: 'zombie_death', pitch: 0.75 }],
  'entity.drowned.step': [{ set: 'mob_step_hard', pitch: 0.9 }],
  'entity.drowned.swim': [{ set: 'swim' }],
  'entity.zombie_villager.ambient': [{ set: 'zombie_say', pitch: 1.15 }],
  'entity.zombie_villager.hurt': [{ set: 'zombie_hurt', pitch: 1.15 }],
  'entity.zombie_villager.death': [{ set: 'zombie_death', pitch: 1.15 }],
  'entity.zombie_villager.step': [{ set: 'mob_step_hard', pitch: 0.95 }],
  'entity.skeleton.ambient': [{ set: 'skeleton_say' }],
  'entity.skeleton.hurt': [{ set: 'skeleton_hurt' }],
  'entity.skeleton.death': [{ set: 'skeleton_say', pitch: 0.8 }],
  'entity.skeleton.step': [{ set: 'skeleton_say', pitch: 1.4, volume: 0.4 }],
  'entity.skeleton.shoot': [{ set: 'bow_shoot' }],
  'entity.stray.ambient': [{ set: 'skeleton_say', pitch: 0.85 }],
  'entity.stray.hurt': [{ set: 'skeleton_hurt', pitch: 0.85 }],
  'entity.stray.death': [{ set: 'skeleton_say', pitch: 0.7 }],
  'entity.stray.step': [{ set: 'skeleton_say', pitch: 1.2, volume: 0.4 }],
  'entity.wither_skeleton.ambient': [{ set: 'skeleton_say', pitch: 0.65 }],
  'entity.wither_skeleton.hurt': [{ set: 'skeleton_hurt', pitch: 0.65 }],
  'entity.wither_skeleton.death': [{ set: 'skeleton_say', pitch: 0.55 }],
  'entity.wither_skeleton.step': [{ set: 'skeleton_say', pitch: 1, volume: 0.4 }],
  'entity.spider.ambient': [{ set: 'spider_say' }],
  'entity.spider.hurt': [{ set: 'spider_hurt' }],
  'entity.spider.death': [{ set: 'spider_say', pitch: 0.8 }],
  'entity.spider.step': [{ set: 'spider_step' }],
  'entity.creeper.hurt': [{ set: 'creeper_hurt' }],
  'entity.creeper.death': [{ set: 'creeper_hurt', pitch: 0.8 }],
  'entity.creeper.primed': [{ set: 'fuse' }],
  'entity.tnt.primed': [{ set: 'fuse' }],
  'entity.generic.explode': [{ set: 'explode' }],
  // generic / player / items
  'entity.generic.hurt': [{ set: 'player_hurt' }],
  'entity.generic.death': [{ set: 'player_hurt', pitch: 0.9 }],
  'entity.generic.eat': [{ set: 'eat' }],
  'entity.generic.drink': [{ set: 'drink' }],
  'entity.generic.burn': [{ set: 'extinguish', volume: 0.6 }],
  'entity.generic.extinguish_fire': [{ set: 'extinguish' }],
  'entity.generic.splash': [{ set: 'splash' }],
  'entity.generic.swim': [{ set: 'swim' }],
  'entity.generic.big_fall': [{ set: 'fall_big' }],
  'entity.generic.small_fall': [{ set: 'fall_small' }],
  'entity.hostile.big_fall': [{ set: 'fall_big' }],
  'entity.hostile.small_fall': [{ set: 'fall_small' }],
  'entity.zombie.converted_to_drowned': [{ set: 'zombie_say', pitch: 0.8 }],
  'entity.husk.converted_to_zombie': [{ set: 'zombie_say', pitch: 1.1 }],
  'entity.slime.attack': [{ set: 'slime', pitch: 1.1 }],
  'entity.player.burp': [{ set: 'burp' }],
  'entity.player.breath': [{ set: 'swim', volume: 0.5 }],
  'entity.arrow.shoot': [{ set: 'bow_shoot' }],
  'entity.arrow.hit': [{ set: 'arrow_hit' }],
  'entity.arrow.hit_player': [{ set: 'orb', pitch: 0.6 }],
  'entity.egg.throw': [{ set: 'bow_shoot', pitch: 1.4, volume: 0.5 }],
  'entity.snowball.throw': [{ set: 'bow_shoot', pitch: 1.4, volume: 0.5 }],
  'entity.experience_bottle.throw': [{ set: 'bow_shoot', pitch: 1.3, volume: 0.5 }],
  'entity.item.break': [{ set: 'item_break' }],
  'item.bucket.fill': [{ set: 'bucket_fill' }],
  'item.bucket.empty': [{ set: 'bucket_empty' }],
  'item.bucket.fill_fish': [{ set: 'bucket_fill' }],
  'item.bucket.empty_fish': [{ set: 'bucket_empty' }],
  'item.bucket.fill_axolotl': [{ set: 'bucket_fill' }],
  'item.bucket.empty_axolotl': [{ set: 'bucket_empty' }],
  'item.bucket.fill_lava': [{ set: 'bucket_lava' }],
  'item.bucket.empty_lava': [{ set: 'bucket_lava', pitch: 0.9 }],
  'item.bucket.fill_powder_snow': [{ set: 'dig_snow' }],
  'item.bucket.empty_powder_snow': [{ set: 'dig_snow', pitch: 0.9 }],
  'item.flintandsteel.use': [{ set: 'metal_latch', pitch: 1.4 }],
  'item.armor.equip_generic': [{ set: 'dig_cloth' }],
  'item.armor.equip_leather': [{ set: 'dig_cloth' }],
  'item.armor.equip_chain': [{ set: 'chain' }],
  'item.armor.equip_iron': [{ set: 'metal_light' }],
  'item.armor.equip_gold': [{ set: 'metal_light', pitch: 1.2 }],
  'item.armor.equip_diamond': [{ set: 'metal_light', pitch: 1.1 }],
  'item.armor.equip_netherite': [{ set: 'metal_heavy', pitch: 0.9 }],
  'item.armor.equip_turtle': [{ set: 'dig_stone', pitch: 1.2 }],
  'item.armor.equip_elytra': [{ set: 'dig_cloth', pitch: 0.8 }],
  'item.shield.block': [{ set: 'dig_wood' }],
  'item.shield.break': [{ set: 'dig_wood', pitch: 0.7 }],
  // fluids / fire / redstone components / containers
  'block.fire.ambient': [{ set: 'fire' }],
  'block.fire.extinguish': [{ set: 'extinguish' }],
  'block.furnace.fire_crackle': [{ set: 'furnace' }],
  'block.blastfurnace.fire_crackle': [{ set: 'furnace', pitch: 1.1 }],
  'block.smoker.smoke': [{ set: 'furnace', pitch: 0.9 }],
  'block.campfire.crackle': [{ set: 'campfire' }],
  'block.lava.ambient': [{ set: 'lava_ambient' }],
  'block.lava.pop': [{ set: 'lava_pop' }],
  'block.lava.extinguish': [{ set: 'extinguish' }],
  'block.water.ambient': [{ set: 'water_ambient' }],
  'block.bubble_column.bubble_pop': [{ set: 'bubble_pop' }],
  'block.bubble_column.upwards_ambient': [{ set: 'underwater_add' }],
  'block.bubble_column.upwards_inside': [{ set: 'underwater_add', pitch: 1.2 }],
  'block.bubble_column.whirlpool_ambient': [{ set: 'underwater_add', pitch: 0.8 }],
  'block.bubble_column.whirlpool_inside': [{ set: 'underwater_add', pitch: 0.7 }],
  'block.lever.click': [{ set: 'lever' }],
  'block.comparator.click': [{ set: 'lever', pitch: 1.1 }],
  'block.dispenser.dispense': [{ set: 'button' }],
  'block.dispenser.fail': [{ set: 'button', pitch: 1.2 }],
  'block.redstone_torch.burnout': [{ set: 'extinguish' }],
  'block.wooden_button.click_on': [{ set: 'button', pitch: 0.8 }],
  'block.wooden_button.click_off': [{ set: 'button', pitch: 0.7 }],
  'block.stone_button.click_on': [{ set: 'button' }],
  'block.stone_button.click_off': [{ set: 'button', pitch: 0.9 }],
  'block.wooden_pressure_plate.click_on': [{ set: 'pressure_plate', pitch: 0.8 }],
  'block.wooden_pressure_plate.click_off': [{ set: 'pressure_plate', pitch: 0.7 }],
  'block.stone_pressure_plate.click_on': [{ set: 'pressure_plate' }],
  'block.stone_pressure_plate.click_off': [{ set: 'pressure_plate', pitch: 0.9 }],
  'block.metal_pressure_plate.click_on': [{ set: 'pressure_plate', pitch: 1.2 }],
  'block.metal_pressure_plate.click_off': [{ set: 'pressure_plate', pitch: 1.1 }],
  'block.tripwire.click_on': [{ set: 'button', pitch: 1.2 }],
  'block.tripwire.click_off': [{ set: 'button', pitch: 1.1 }],
  'block.tripwire.attach': [{ set: 'metal_latch', pitch: 1.3 }],
  'block.tripwire.detach': [{ set: 'metal_latch', pitch: 1.2 }],
  'block.barrel.open': [{ set: 'chest_creak', pitch: 1.1 }],
  'block.barrel.close': [{ set: 'door_close', pitch: 1.2 }],
  'block.ender_chest.open': [{ set: 'chest_creak', pitch: 0.8 }],
  'block.ender_chest.close': [{ set: 'door_close', pitch: 0.8 }],
  'block.shulker_box.open': [{ set: 'chest_creak', pitch: 1.3 }],
  'block.shulker_box.close': [{ set: 'door_close', pitch: 1.3 }],
  'block.chest.locked': [{ set: 'metal_latch', pitch: 0.8 }],
  // ambience
  'ambient.cave': [{ set: 'cave' }],
  'ambient.underwater.loop': [{ set: 'underwater_loop', stream: true }],
  'ambient.underwater.enter': [{ set: 'splash', volume: 0.6, pitch: 0.8 }],
  'ambient.underwater.exit': [{ set: 'splash', volume: 0.5, pitch: 1.1 }],
  'ambient.underwater.loop.additions': [{ set: 'underwater_add' }],
  'ambient.underwater.loop.additions.rare': [{ set: 'underwater_add', pitch: 0.8 }],
  'ambient.underwater.loop.additions.ultra_rare': [{ set: 'cave', pitch: 0.7 }],
  // UI
  'ui.toast.in': [{ set: 'toast_in' }],
  'ui.toast.out': [{ set: 'toast_out' }],
  'ui.toast.challenge_complete': [{ set: 'levelup' }],
  'ui.stonecutter.take_result': [{ set: 'dig_stone' }],
  'ui.loom.take_result': [{ set: 'dig_cloth' }],
  'ui.loom.select_pattern': [{ set: 'dig_cloth', pitch: 1.2 }],
  'ui.cartography_table.take_result': [{ set: 'dig_cloth', pitch: 1.4 }],
  // music (vanilla Musics: game/creative/nether share the calm set; menu, underwater and end get the pads)
  'music.game': music('music_calm1', 'music_calm2', 'music_calm3', 'music_texture'),
  'music.creative': music('music_calm1', 'music_calm2', 'music_calm3', 'music_texture', 'music_choir'),
  'music.menu': music('music_choir', 'music_calm2', 'music_texture'),
  'music.under_water': music('music_deep', 'music_choir'),
  'music.end': music('music_choir', 'music_gloom'),
  'music.dragon': music('music_gloom'),
  'music.credits': music('music_calm3'),
  'music.nether.nether_wastes': music('music_gloom', 'music_deep'),
  'music.nether.crimson_forest': music('music_gloom', 'music_deep'),
  'music.nether.warped_forest': music('music_gloom', 'music_choir'),
  'music.nether.soul_sand_valley': music('music_gloom', 'music_deep'),
  'music.nether.basalt_deltas': music('music_gloom', 'music_deep'),
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
  ...scanSourceEvents(),
]);

/** Every vanilla sound event name quoted in the game's source (client, server, shared). */
function scanSourceEvents(): string[] {
  const names = new Set(SOUND_EVENTS.map((e) => e.name));
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); continue; }
      if (!/\.ts$/.test(f.name) || /\.test\.ts$/.test(f.name)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/'((?:block|entity|item|ambient|weather|ui|music|enchant|event|particle)\.[a-z0-9_.]+)'/g)) {
        if (names.has(m[1]!)) found.add(m[1]!);
      }
    }
  };
  for (const d of ['client/src', 'server/src', 'shared/src']) walk(join(root, d));
  return [...found];
}

/**
 * Vanilla events that have no recording yet but are (or soon will be) played: they get an explicit
 * `placeholder` entry in sounds.json (silent; the engine logs them once at debug level).
 */
const PLACEHOLDERS = [
  'entity.villager.death', 'entity.villager.trade', 'entity.horse.ambient', 'entity.horse.hurt', 'entity.horse.death',
  'entity.slime.squish', 'entity.slime.hurt', 'entity.slime.death', 'entity.slime.jump', 'entity.witch.ambient', 'entity.witch.hurt',
  'entity.witch.death', 'entity.ender_dragon.growl', 'entity.wither.spawn', 'entity.phantom.ambient', 'entity.bat.ambient',
  'entity.squid.ambient', 'entity.ghast.ambient', 'entity.blaze.ambient', 'block.beacon.ambient',
  'block.conduit.ambient', 'block.end_portal.spawn', 'block.beehive.work', 'entity.bee.loop', 'block.respawn_anchor.charge', 'block.respawn_anchor.deplete',
  'block.respawn_anchor.set_spawn', 'block.respawn_anchor.ambient', 'item.totem.use', 'block.sculk_sensor.clicking',
];
// slimes reuse the slime block recordings; the rest stay silent until recordings are sourced
Object.assign(EVENTS, {
  'entity.slime.squish': [{ set: 'slime' }], 'entity.slime.hurt': [{ set: 'slime', pitch: 1.2 }],
  'entity.slime.death': [{ set: 'slime', pitch: 0.8 }], 'entity.slime.jump': [{ set: 'slime', pitch: 1.1 }],
  'entity.slime.squish_small': [{ set: 'slime', pitch: 1.4 }], 'entity.slime.hurt_small': [{ set: 'slime', pitch: 1.5 }],
  'entity.slime.death_small': [{ set: 'slime', pitch: 1.3 }], 'entity.slime.jump_small': [{ set: 'slime', pitch: 1.4 }],
  'entity.magma_cube.squish': [{ set: 'slime', pitch: 0.7 }], 'entity.magma_cube.hurt': [{ set: 'slime', pitch: 0.8 }],
  'entity.magma_cube.death': [{ set: 'slime', pitch: 0.6 }], 'entity.magma_cube.jump': [{ set: 'slime', pitch: 0.75 }],
  'entity.magma_cube.hurt_small': [{ set: 'slime', pitch: 1.1 }], 'entity.magma_cube.death_small': [{ set: 'slime', pitch: 0.9 }],
} satisfies Record<string, Ref[]>);

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
    encode(c.samples, join(outDir, set, `${i}.ogg`), c.quality ?? 3);
    return { name: `${set}/${i}`, source: c.source };
  });
  setFiles.set(set, files);
  console.log(`${set}: ${files.length} clips`);
}
const manifest: Record<string, { sounds: { name: string; volume?: number; pitch?: number; stream?: boolean }[]; placeholder?: true }> = {};
for (const ev of [...Object.keys(EVENTS)].sort()) {
  manifest[ev] = { sounds: EVENTS[ev]!.flatMap((r) => setFiles.get(r.set)!.map((f) => ({ name: f.name, ...(r.volume ? { volume: r.volume } : {}), ...(r.pitch ? { pitch: r.pitch } : {}), ...(r.stream ? { stream: true } : {}) }))) };
}
for (const ev of [...HOOKED, ...PLACEHOLDERS].sort()) {
  if (!valid.has(ev)) throw new Error(`not a 1.17.1 sound event: ${ev}`);
  if (!manifest[ev]) manifest[ev] = { sounds: [], placeholder: true };
}
writeFileSync(join(outDir, 'sounds.json'), JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))), null, 1));

// credits
const used_sources = new Set([...setFiles.values()].flat().map((f) => f.source));
const lines = [...credits.values()].filter((c) => used_sources.has(c.key)).sort((a, b) => a.key.localeCompare(b.key))
  .map((c) => `| ${c.title} | ${c.author} | ${c.url} | ${c.license} | ${[...setFiles].filter(([, fs]) => fs.some((f) => f.source === c.key)).map(([s]) => s).join(', ')} |`);
const assetPath = join(root, 'ASSET_SOURCES.md');
let assets = readFileSync(assetPath, 'utf8');
const block = `<!-- sounds:begin (generated by tools/soundgen/build.ts) -->\n## Sounds\n\nAll recordings (sound effects and the \`music_*\` tracks) are CC0. They are trimmed, cut into single events, converted to mono Ogg Vorbis and peak-normalized by \`pnpm soundgen\`; note block samples are additionally retuned (resampled) to the vanilla base pitch. Nothing is synthesized.\n\n| Source | Author | URL | License | Used for (clip sets) |\n|---|---|---|---|---|\n${lines.join('\n')}\n<!-- sounds:end -->`;
assets = assets.includes('<!-- sounds:begin') ? assets.replace(/<!-- sounds:begin[\s\S]*?<!-- sounds:end -->/, block) : `${assets.trimEnd()}\n\n${block}\n`;
writeFileSync(assetPath, assets);

const missing = Object.keys(manifest).filter((e) => !manifest[e]!.sounds.length).sort();
writeFileSync(join(root, 'tools/soundgen/missing.txt'), missing.join('\n') + '\n');
console.log(noteLog.join('\n'));
console.log(`sounds.json: ${Object.keys(manifest).length} events, ${[...setFiles.values()].flat().length} files; ${missing.length} events are silent placeholders (tools/soundgen/missing.txt)`);
