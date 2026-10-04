/**
 * Typed command arguments (Brigadier builtins + vanilla ArgumentTypes) with 1.17.1 error text.
 */
import { CommandSyntaxError, StringReader, vanillaPath, fullId } from './reader';
import type { ArgumentType, SuggestionsBuilder } from './dispatcher';
import { CommandSource, eyeHeightOf, isPlayer, type Target } from './source';
import { EntitySelector, parseSelector, suggestSelector } from './selector';
import { BLOCKS, BLOCKS_BY_NAME, ITEMS, ITEMS_BY_NAME, ENCHANTMENTS, ENCHANTMENTS_BY_NAME, EFFECTS, ENTITIES, type ItemData, type BlockData } from '@shared/data';
import { withProp, getProp, propsOf } from '@shared/world/blockstate';

type S = CommandSource;

// ------------------------------------------------------------------ brigadier builtins
export function integer(min = -2147483648, max = 2147483647): ArgumentType<number, S> {
  return {
    parse(r) {
      const start = r.cursor;
      const v = r.readInt();
      if (v < min) {
        r.cursor = start;
        throw r.error(`Integer must not be less than ${min}, found ${v}`);
      }
      if (v > max) {
        r.cursor = start;
        throw r.error(`Integer must not be more than ${max}, found ${v}`);
      }
      return v;
    },
    examples: ['0', '123', '-123'],
  };
}

export function float(min = -Infinity, max = Infinity, kind: 'Float' | 'Double' = 'Float'): ArgumentType<number, S> {
  return {
    parse(r) {
      const start = r.cursor;
      const v = kind === 'Float' ? r.readFloat() : r.readDouble();
      if (v < min) {
        r.cursor = start;
        throw r.error(`${kind} must not be less than ${min}, found ${v}`);
      }
      if (v > max) {
        r.cursor = start;
        throw r.error(`${kind} must not be more than ${max}, found ${v}`);
      }
      return v;
    },
    examples: ['0', '1.2', '.5', '-1', '-.5', '-1234.56'],
  };
}

export function bool(): ArgumentType<boolean, S> {
  return {
    parse: (r) => r.readBoolean(),
    suggest: (b) => void b.suggestMatching(['true', 'false']),
  };
}

export function word(): ArgumentType<string, S> {
  return { parse: (r) => r.readUnquotedString(), examples: ['word', 'words_with_underscores'] };
}
export function string(): ArgumentType<string, S> {
  return { parse: (r) => r.readString(), examples: ['"quoted phrase"', 'word', '""'] };
}
export function greedyString(): ArgumentType<string, S> {
  return {
    parse(r) {
      const s = r.remaining;
      r.cursor = r.string.length;
      return s;
    },
    examples: ['word', 'words with spaces', '"and symbols"'],
  };
}

// ------------------------------------------------------------------ coordinates
interface WorldCoordinate {
  relative: boolean;
  value: number;
}

export interface Coordinates {
  /** Absolute position for a source (vanilla Coordinates.getPosition). */
  position(src: S): [number, number, number];
  /** Rotation [yaw, pitch] (vanilla Coordinates.getRotation for RotationArgument). */
  rotation(src: S): [number, number];
  isXRelative: boolean;
  isYRelative: boolean;
  isZRelative: boolean;
}

function readWorldCoordinate(r: StringReader, centerCorrect: boolean, int: boolean): WorldCoordinate {
  if (r.canRead() && r.peek() === '^') throw r.error('Cannot mix world & local coordinates (everything must either use ^ or not)');
  if (!r.canRead()) throw r.error(int ? 'Expected a block position' : 'Expected a coordinate');
  const relative = r.peek() === '~';
  if (relative) r.skip();
  if (relative && (!r.canRead() || r.peek() === ' ')) return { relative, value: 0 };
  const start = r.cursor;
  if (int && !relative) return { relative, value: r.readInt() };
  let v = r.readDouble();
  const s = r.string.slice(start, r.cursor);
  if (!relative && centerCorrect && !s.includes('.')) v += 0.5;
  return { relative, value: v };
}

function readLocal(r: StringReader): number {
  if (!r.canRead() || r.peek() !== '^') throw r.error('Cannot mix world & local coordinates (everything must either use ^ or not)');
  r.skip();
  if (!r.canRead() || r.peek() === ' ') return 0;
  return r.readDouble();
}

/** LocalCoordinates.getPosition: ^left ^up ^forwards relative to the source's rotation. */
function localPosition(src: S, left: number, up: number, fwd: number): [number, number, number] {
  const rad = Math.PI / 180;
  const yaw = src.yaw, pitch = src.pitch;
  const f = Math.cos((yaw + 90) * rad), f1 = Math.sin((yaw + 90) * rad);
  const f2 = Math.cos(-pitch * rad), f3 = Math.sin(-pitch * rad);
  const f4 = Math.cos((-pitch + 90) * rad), f5 = Math.sin((-pitch + 90) * rad);
  const fx = f * f2, fy = f3, fz = f1 * f2; // forwards
  const ux = f * f4, uy = f5, uz = f1 * f4; // up
  // left = -(forward × up)
  const lx = -(fy * uz - fz * uy), ly = -(fz * ux - fx * uz), lz = -(fx * uy - fy * ux);
  const by = src.anchorEyes && src.entity ? src.y + eyeHeightOf(src.entity) : src.y;
  return [src.x + fx * fwd + ux * up + lx * left, by + fy * fwd + uy * up + ly * left, src.z + fz * fwd + uz * up + lz * left];
}

function parseCoords(r: StringReader, count: 2 | 3, centerCorrect: boolean, int: boolean, allowLocal: boolean, incomplete: string): Coordinates {
  const start = r.cursor;
  if (allowLocal && r.canRead() && r.peek() === '^') {
    const v: number[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) {
        if (!r.canRead() || r.peek() !== ' ') {
          r.cursor = start;
          throw r.error(incomplete);
        }
        r.skip();
      }
      v.push(readLocal(r));
    }
    const [left, up, fwd] = count === 3 ? v : [v[0]!, 0, v[1]!];
    return {
      position: (src) => localPosition(src, left!, up!, fwd!),
      rotation: (src) => [src.yaw, src.pitch],
      isXRelative: true, isYRelative: true, isZRelative: true,
    };
  }
  const c: WorldCoordinate[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      if (!r.canRead() || r.peek() !== ' ') {
        r.cursor = start;
        throw r.error(incomplete);
      }
      r.skip();
    }
    // y is never centre-corrected (Vec3Argument: x and z only)
    const isY = count === 3 && i === 1;
    c.push(readWorldCoordinate(r, centerCorrect && !isY, int));
  }
  const get = (w: WorldCoordinate, base: number) => (w.relative ? base + w.value : w.value);
  if (count === 3) {
    const [x, y, z] = c as [WorldCoordinate, WorldCoordinate, WorldCoordinate];
    return {
      position: (src) => [get(x, src.x), get(y, src.y), get(z, src.z)],
      rotation: (src) => [get(y, src.yaw), get(x, src.pitch)],
      isXRelative: x.relative, isYRelative: y.relative, isZRelative: z.relative,
    };
  }
  const [a, b] = c as [WorldCoordinate, WorldCoordinate];
  return {
    // 2-D: (x, z) for columns, (yaw, pitch) for rotations
    position: (src) => [get(a, src.x), src.y, get(b, src.z)],
    rotation: (src) => [get(a, src.yaw), get(b, src.pitch)],
    isXRelative: a.relative, isYRelative: false, isZRelative: b.relative,
  };
}

function suggestCoords(b: SuggestionsBuilder, src: S, count: number, block: boolean): void {
  // vanilla suggests "~ ~ ~" (or the targeted block's position, which the server doesn't know)
  const rem = b.remaining;
  const parts = rem.split(' ');
  if (parts.length > count) return;
  const fill: string[] = [];
  for (let i = 0; i < count; i++) fill.push(i < parts.length - 1 ? parts[i]! : '~');
  if (parts[parts.length - 1] === '' || parts.length === 1) {
    const all = rem.trim() === '' ? Array(count).fill('~').join(' ') : [...parts.slice(0, -1), ...fill.slice(parts.length - 1)].join(' ');
    if (all.startsWith(rem)) b.suggest(all);
    if (rem === '' && src.entity && block) b.suggest(Array(count).fill('~').join(' '));
  }
}

export function vec3(centerCorrect = true): ArgumentType<Coordinates, S> {
  return {
    parse: (r) => parseCoords(r, 3, centerCorrect, false, true, 'Incomplete (expected 3 coordinates)'),
    suggest: (b, src) => suggestCoords(b, src, 3, false),
    examples: ['0 0 0', '~ ~ ~', '^ ^ ^', '^1 ^ ^-5', '0.1 -0.5 .9', '~0.5 ~1 ~-5'],
  };
}

export function blockPos(): ArgumentType<Coordinates, S> {
  return {
    parse: (r) => parseCoords(r, 3, false, true, true, 'Incomplete (expected 3 coordinates)'),
    suggest: (b, src) => suggestCoords(b, src, 3, true),
    examples: ['0 0 0', '~ ~ ~', '^ ^ ^', '^1 ^ ^-5', '~0.5 ~1 ~-5'],
  };
}

export function rotation(): ArgumentType<Coordinates, S> {
  return {
    parse: (r) => parseCoords(r, 2, false, false, false, 'Incomplete (expected 2 coordinates)'),
    suggest: (b, src) => suggestCoords(b, src, 2, false),
    examples: ['0 0', '~ ~', '~-5 ~5'],
  };
}

export function vec2(): ArgumentType<Coordinates, S> {
  return {
    parse: (r) => parseCoords(r, 2, true, false, true, 'Incomplete (expected 2 coordinates)'),
    suggest: (b, src) => suggestCoords(b, src, 2, false),
    examples: ['0 0', '~ ~', '0.1 -0.5', '~1 ~-2'],
  };
}

/** BlockPosArgument.getLoadedBlockPos: floored, in the world and loaded. */
export function loadedBlockPos(c: Coordinates, src: S): [number, number, number] {
  const [x, y, z] = c.position(src).map(Math.floor) as [number, number, number];
  if (!src.server.world.getChunk(x >> 4, z >> 4)) throw new CommandSyntaxError('That position is not loaded');
  if (y < 0 || y > 255) throw new CommandSyntaxError('That position is out of this world!');
  return [x, y, z];
}

/** BlockPosArgument.getSpawnablePos: floored, inside the world border (y unrestricted). */
export function spawnableBlockPos(c: Coordinates, src: S): [number, number, number] {
  const [x, y, z] = c.position(src).map(Math.floor) as [number, number, number];
  if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || y < -20000000 || y > 20000000) throw new CommandSyntaxError('That position is out of this world!');
  return [x, y, z];
}

// ------------------------------------------------------------------ entities
export interface EntityArg {
  selector: EntitySelector;
}

/** EntityArgument.entity/entities/player/players with the parse-time single/player checks. */
export function entityArg(single: boolean, playersOnly: boolean): ArgumentType<EntitySelector, S> {
  return {
    parse(r) {
      const start = r.cursor;
      const sel = parseSelector(r);
      if (sel.maxResults > 1 && single) {
        r.cursor = start;
        throw r.error(playersOnly ? 'Only one player is allowed, but the provided selector allows more than one' : 'Only one entity is allowed, but the provided selector allows more than one');
      }
      if (sel.includesEntities && playersOnly && !sel.currentEntity) {
        r.cursor = start;
        throw r.error('Only players may be affected by this command, but the provided selector includes entities');
      }
      return sel;
    },
    suggest: (b, src) => suggestSelector(b, src, playersOnly),
    examples: playersOnly ? ['Player', '0123', '@e', '@e[type=foo]'] : ['Player', '0123', '@e', '@e[type=foo]', 'dd12be42-52a9-4a91-a8a1-11c01849e498'],
  };
}

export function getEntities(sel: EntitySelector, src: S): Target[] {
  const l = sel.find(src);
  if (!l.length) throw new CommandSyntaxError('No entity was found');
  return l;
}
export function getEntity(sel: EntitySelector, src: S): Target {
  const l = sel.find(src);
  if (!l.length) throw new CommandSyntaxError('No entity was found');
  if (l.length > 1) throw new CommandSyntaxError('Only one entity is allowed, but the provided selector allows more than one');
  return l[0]!;
}
export function getPlayers(sel: EntitySelector, src: S): import('../player').ServerPlayer[] {
  const l = sel.find(src).filter(isPlayer);
  if (!l.length) throw new CommandSyntaxError('No player was found');
  return l;
}
export function getPlayer(sel: EntitySelector, src: S): import('../player').ServerPlayer {
  const l = getPlayers(sel, src);
  if (l.length > 1) throw new CommandSyntaxError('Only one player is allowed, but the provided selector allows more than one');
  return l[0]!;
}

/** GameProfileArgument: player selectors or a (possibly offline) name. */
export function gameProfile(): ArgumentType<{ selector: EntitySelector | null; name: string | null }, S> {
  return {
    parse(r) {
      if (r.canRead() && r.peek() === '@') return { selector: parseSelector(r), name: null };
      const s = r.cursor;
      while (r.canRead() && r.peek() !== ' ') r.skip();
      return { selector: null, name: r.string.slice(s, r.cursor) };
    },
    suggest: (b, src) => suggestSelector(b, src, true),
    examples: ['Player', '0123', 'dd12be42-52a9-4a91-a8a1-11c01849e498', '@e'],
  };
}

// ------------------------------------------------------------------ resources
function suggestIds(b: SuggestionsBuilder, names: Iterable<string>): void {
  b.suggestResources(names);
}

export interface ItemInput {
  item: ItemData;
  /** raw NBT text (not interpreted yet) */
  nbt: string | null;
}

function readNbt(r: StringReader): string | null {
  if (!r.canRead() || r.peek() !== '{') return null;
  const s = r.cursor;
  let depth = 0;
  do {
    if (!r.canRead()) throw r.error('Expected \'}\'');
    const c = r.next();
    if (c === '"' || c === "'") r.readStringUntil(c);
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  } while (depth > 0);
  return r.string.slice(s, r.cursor);
}

/** ItemArgument (ItemParser): an item id with optional NBT. */
export function itemArg(): ArgumentType<ItemInput, S> {
  return {
    parse(r) {
      const start = r.cursor;
      const id = r.readResourceLocation();
      const path = vanillaPath(id);
      const item = path ? ITEMS_BY_NAME.get(path) : undefined;
      if (!item || item.name === 'air') {
        r.cursor = start;
        throw r.error(`Unknown item '${fullId(id)}'`);
      }
      return { item, nbt: readNbt(r) };
    },
    suggest: (b) => suggestIds(b, ITEMS.filter((i) => i.name !== 'air').map((i) => i.name)),
    examples: ['stick', 'minecraft:stick', 'stick{foo=bar}'],
  };
}

/** ItemPredicateArgument: an item id (or #tag) with optional NBT. */
export function itemPredicateArg(): ArgumentType<(id: number) => boolean, S> {
  return {
    parse(r) {
      const start = r.cursor;
      if (r.canRead() && r.peek() === '#') {
        r.skip();
        const tag = r.readResourceLocation();
        r.cursor = start;
        throw r.error(`Unknown item tag '${fullId(tag)}'`);
      }
      const id = r.readResourceLocation();
      const path = vanillaPath(id);
      const item = path ? ITEMS_BY_NAME.get(path) : undefined;
      if (!item) {
        r.cursor = start;
        throw r.error(`Unknown item '${fullId(id)}'`);
      }
      readNbt(r);
      return (i: number) => i === item.id;
    },
    suggest: (b) => suggestIds(b, ITEMS.map((i) => i.name)),
    examples: ['stick', 'minecraft:stick', '#stick', '#stick{foo=bar}'],
  };
}

export interface BlockInput {
  block: BlockData;
  state: number;
  /** properties given explicitly (for predicates) */
  props: Map<string, string>;
  nbt: string | null;
  /** BlockPredicate test */
  test(state: number): boolean;
}

/** BlockStateParser: id[prop=value,...]{nbt}; `allowTags` for block predicates. */
function parseBlock(r: StringReader, allowTags: boolean): BlockInput {
  const start = r.cursor;
  if (r.canRead() && r.peek() === '#') {
    if (!allowTags) throw r.error("Tags aren't allowed here, only actual blocks");
    r.skip();
    const tag = r.readResourceLocation();
    r.cursor = start;
    throw r.error(`Unknown block tag '${fullId(tag)}'`);
  }
  const id = r.readResourceLocation();
  const path = vanillaPath(id);
  const block = path ? BLOCKS_BY_NAME.get(path) : undefined;
  if (!block) {
    r.cursor = start;
    throw r.error(`Unknown block type '${fullId(id)}'`);
  }
  const bid = fullId(id);
  let state = block.defaultState;
  const props = new Map<string, string>();
  if (r.canRead() && r.peek() === '[') {
    r.skip();
    r.skipWhitespace();
    const known = propsOf(block.defaultState);
    while (r.canRead() && r.peek() !== ']') {
      r.skipWhitespace();
      const ks = r.cursor;
      const key = r.readString();
      if (!(key in known)) {
        r.cursor = ks;
        throw r.error(`Block ${bid} does not have property '${key}'`);
      }
      if (props.has(key)) {
        r.cursor = ks;
        throw r.error(`Property '${key}' can only be set once for block ${bid}`);
      }
      r.skipWhitespace();
      if (!r.canRead() || r.peek() !== '=') throw r.error(`Expected value for property '${key}' on block ${bid}`);
      r.skip();
      r.skipWhitespace();
      const vs = r.cursor;
      const value = r.readString();
      const typed = typeof known[key] === 'boolean' ? value === 'true' ? true : value === 'false' ? false : value : typeof known[key] === 'number' && /^\d+$/.test(value) ? Number(value) : value;
      const next = withProp(state, key, typed);
      if (getProp(next, key) !== typed) {
        r.cursor = vs;
        throw r.error(`Block ${bid} does not accept '${value}' for ${key} property`);
      }
      state = next;
      props.set(key, value);
      r.skipWhitespace();
      if (r.canRead() && r.peek() === ',') {
        r.skip();
        continue;
      }
      if (!r.canRead() || r.peek() !== ']') throw r.error('Expected closing ] for block state properties');
    }
    if (!r.canRead()) throw r.error('Expected closing ] for block state properties');
    r.skip();
  }
  const nbt = readNbt(r);
  const test = (s: number): boolean => {
    if (s < block.minStateId || s > block.maxStateId) return false;
    for (const [k, v] of props) if (String(getProp(s, k)) !== v) return false;
    return true;
  };
  return { block, state, props, nbt, test };
}

function suggestBlock(b: SuggestionsBuilder): void {
  const rem = b.remaining;
  const br = rem.indexOf('[');
  if (br < 0) {
    suggestIds(b, BLOCKS.map((x) => x.name));
    return;
  }
  const path = vanillaPath(rem.slice(0, br));
  const block = path ? BLOCKS_BY_NAME.get(path) : undefined;
  if (!block) return;
  const body = rem.slice(br + 1);
  const cur = body.slice(body.lastIndexOf(',') + 1);
  const prefix = rem.slice(0, rem.length - cur.length);
  const known = propsOf(block.defaultState);
  const eq = cur.indexOf('=');
  if (eq < 0) {
    for (const k of Object.keys(known)) if (k.startsWith(cur)) b.suggest(`${prefix}${k}=`);
    if (cur === '') b.suggest(`${prefix}]`);
    return;
  }
  const key = cur.slice(0, eq);
  const st = block.states.find((s) => s.name === key);
  const values = st ? (st.type === 'bool' ? ['true', 'false'] : st.values ?? []) : [];
  for (const v of values) if (v.startsWith(cur.slice(eq + 1))) b.suggest(`${prefix}${key}=${v}`);
}

export function blockStateArg(): ArgumentType<BlockInput, S> {
  return {
    parse: (r) => parseBlock(r, false),
    suggest: (b) => suggestBlock(b),
    examples: ['stone', 'minecraft:stone', 'stone[foo=bar]', 'foo{bar=baz}'],
  };
}
export function blockPredicateArg(): ArgumentType<BlockInput, S> {
  return {
    parse: (r) => parseBlock(r, true),
    suggest: (b) => suggestBlock(b),
    examples: ['stone', 'minecraft:stone', 'stone[foo=bar]', '#stone', '#stone[foo=bar]{baz=nbt}'],
  };
}

/** Registry id → minecraft-data effect name ("MiningFatigue" → mining_fatigue; BadLuck is "unluck"). */
export const EFFECT_IDS: Map<string, { id: number; displayName: string }> = new Map(
  EFFECTS.map((e) => {
    const id = e.name === 'BadLuck' ? 'unluck' : e.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    return [id, { id: e.id, displayName: e.displayName }];
  }),
);

function resourceArg<T>(lookup: (path: string) => T | undefined, error: (id: string) => string, names: () => string[], examples: string[]): ArgumentType<T, S> {
  return {
    parse(r) {
      const start = r.cursor;
      const id = r.readResourceLocation();
      const path = vanillaPath(id);
      const v = path ? lookup(path) : undefined;
      if (v === undefined) {
        // vanilla: SimpleCommandExceptionType.create() — no input context
        throw new CommandSyntaxError(error(fullId(id)));
      }
      return v;
    },
    suggest: (b) => suggestIds(b, names()),
    examples,
  };
}

export function effectArg(): ArgumentType<{ name: string; id: number; displayName: string }, S> {
  return resourceArg((p) => { const e = EFFECT_IDS.get(p); return e ? { name: p, ...e } : undefined; }, (id) => `Unknown effect: ${id}`, () => [...EFFECT_IDS.keys()], ['spooky', 'effect']);
}
export function enchantmentArg(): ArgumentType<(typeof ENCHANTMENTS)[number], S> {
  return resourceArg((p) => ENCHANTMENTS_BY_NAME.get(p), (id) => `Unknown enchantment: ${id}`, () => ENCHANTMENTS.map((e) => e.name), ['unbreaking', 'silk_touch']);
}
/** EntitySummonArgument: summonable entity types (players and fishing bobbers excluded). */
export function summonableArg(): ArgumentType<string, S> {
  const ok = (p: string) => ENTITIES.some((e) => e.name === p) && p !== 'player' && p !== 'fishing_bobber';
  return resourceArg((p) => (ok(p) ? p : undefined), (id) => `Unknown entity: ${id}`, () => ENTITIES.map((e) => e.name).filter(ok), ['minecraft:pig', 'cow']);
}

/** TimeArgument: a number with an optional unit d (24000), s (20) or t. */
export function timeArg(): ArgumentType<number, S> {
  return {
    parse(r) {
      const v = r.readFloat();
      const unit = r.readUnquotedString();
      const mult = unit === '' || unit === 't' ? 1 : unit === 's' ? 20 : unit === 'd' ? 24000 : 0;
      if (mult === 0) throw new CommandSyntaxError('Invalid unit');
      const ticks = Math.round(v * mult);
      if (ticks < 0) throw new CommandSyntaxError('Tick count must be non-negative');
      return ticks;
    },
    suggest(b) {
      const m = /^(\d+(?:\.\d*)?)$/.exec(b.remaining);
      if (m) for (const u of ['d', 's', 't']) b.suggest(m[1] + u);
    },
    examples: ['0d', '0s', '0t', '0'],
  };
}

/** MessageArgument: greedy text; selectors inside are replaced by names for permission level 2. */
export function messageArg(): ArgumentType<string, S> {
  return greedyString();
}

export function resolveMessage(text: string, src: S): string {
  if (!src.hasPermission(2) || !text.includes('@')) return text;
  return text.replace(/@[parse](\[[^\]]*\])?/g, (m) => {
    try {
      const r = new StringReader(m);
      const sel = parseSelector(r);
      if (r.canRead()) return m;
      return sel.find(src).map((t) => (isPlayer(t) ? t.name : t.type)).join(', ');
    } catch {
      return m;
    }
  });
}
