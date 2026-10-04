/**
 * Entity selectors (vanilla EntitySelectorParser / EntitySelector / EntitySelectorOptions):
 * @p @a @r @s @e with [type, distance, limit, sort, name, gamemode, level, x, y, z, dx, dy, dz,
 * x_rotation, y_rotation, tag, team, nbt, scores, advancements, predicate] and plain names.
 */
import { CommandSyntaxError, StringReader, vanillaPath, fullId } from './reader';
import { SuggestionsBuilder } from './dispatcher';
import { CommandSource, isAlive, isPlayer, nameOf, typeOf, type Target } from './source';
import { ENTITIES, ENTITIES_BY_NAME } from '@shared/data';

export interface Range {
  min: number | null;
  max: number | null;
}

export function inRange(r: Range, v: number): boolean {
  return (r.min === null || v >= r.min) && (r.max === null || v <= r.max);
}

/** MinMaxBounds.fromReader: "5", "1..5", "..5", "1..". */
export function readRange(reader: StringReader, ints: boolean): Range {
  const start = reader.cursor;
  if (!reader.canRead()) throw reader.error('Expected value or range of values');
  const readNum = (): number | null => {
    const s0 = reader.cursor;
    while (reader.canRead() && /[0-9.\-]/.test(reader.peek())) {
      if (reader.peek() === '.' && reader.peek(1) === '.') break;
      reader.skip();
    }
    const s = reader.string.slice(s0, reader.cursor);
    if (!s) return null;
    if (ints && s.includes('.')) {
      reader.cursor = start;
      throw reader.error('Only whole numbers allowed, not decimals');
    }
    const v = Number(s);
    if (!Number.isFinite(v)) {
      reader.cursor = s0;
      throw reader.error(ints ? `Invalid integer '${s}'` : `Invalid double '${s}'`);
    }
    return v;
  };
  const min = readNum();
  let max: number | null;
  if (reader.canRead(2) && reader.peek() === '.' && reader.peek(1) === '.') {
    reader.cursor += 2;
    max = readNum();
  } else max = min;
  if (min === null && max === null) {
    reader.cursor = start;
    throw reader.error('Expected value or range of values');
  }
  if (min !== null && max !== null && min > max) {
    reader.cursor = start;
    throw reader.error('Min cannot be bigger than max');
  }
  return { min, max };
}

type Sort = 'nearest' | 'furthest' | 'random' | 'arbitrary';
const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'];

export class EntitySelector {
  maxResults = Number.MAX_SAFE_INTEGER;
  includesEntities = true;
  /** @s */
  currentEntity = false;
  /** a plain player name (or UUID-like string) */
  playerName: string | null = null;
  sort: Sort = 'arbitrary';
  usesSelector = false;
  /** selector type restriction (null = any); `typeInverse` lists excluded types */
  type: string | null = null;
  readonly predicates: ((t: Target) => boolean)[] = [];
  x: number | null = null;
  y: number | null = null;
  z: number | null = null;
  dx: number | null = null;
  dy: number | null = null;
  dz: number | null = null;
  distance: Range | null = null;

  /** EntitySelector.findEntities */
  find(src: CommandSource): Target[] {
    this.checkPermissions(src);
    const s = src.server;
    if (this.playerName !== null) {
      const p = s.allPlayers.find((o) => o.name.toLowerCase() === this.playerName!.toLowerCase());
      return p ? [p] : [];
    }
    const px = this.x ?? src.x, py = this.y ?? src.y, pz = this.z ?? src.z;
    const box = this.dx !== null || this.dy !== null || this.dz !== null ? this.box(px, py, pz) : null;
    const test = (t: Target): boolean => {
      if (this.type !== null && typeOf(t) !== this.type) return false;
      if (box) {
        const w = isPlayer(t) ? 0.6 : t.width, h = isPlayer(t) ? 1.8 : t.height;
        if (t.x + w / 2 <= box[0] || t.x - w / 2 >= box[3] || t.y + h <= box[1] || t.y >= box[4] || t.z + w / 2 <= box[2] || t.z - w / 2 >= box[5]) return false;
      }
      if (this.distance) {
        const d = Math.hypot(t.x - px, t.y - py, t.z - pz);
        if (!inRange(this.distance, d)) return false;
      }
      for (const p of this.predicates) if (!p(t)) return false;
      return true;
    };
    let list: Target[];
    if (this.currentEntity) list = src.entity && test(src.entity) ? [src.entity] : [];
    else if (!this.includesEntities) list = s.allPlayers.filter(test);
    else {
      list = s.allPlayers.filter(test);
      for (const e of s.entities.values()) if (test(e)) list.push(e);
    }
    return this.sortAndLimit(list, px, py, pz, src);
  }

  private sortAndLimit(list: Target[], x: number, y: number, z: number, src: CommandSource): Target[] {
    if (list.length > 1) {
      const d2 = (t: Target) => (t.x - x) ** 2 + (t.y - y) ** 2 + (t.z - z) ** 2;
      if (this.sort === 'nearest') list.sort((a, b) => d2(a) - d2(b));
      else if (this.sort === 'furthest') list.sort((a, b) => d2(b) - d2(a));
      else if (this.sort === 'random') {
        const r = src.server.rand;
        for (let i = list.length - 1; i > 0; i--) {
          const j = r.nextInt(i + 1);
          [list[i], list[j]] = [list[j]!, list[i]!];
        }
      }
    }
    return list.slice(0, this.maxResults);
  }

  /** AABB from the position to position + d (each side extended by one block toward positive). */
  private box(x: number, y: number, z: number): [number, number, number, number, number, number] {
    const dx = this.dx ?? 0, dy = this.dy ?? 0, dz = this.dz ?? 0;
    return [x + Math.min(0, dx), y + Math.min(0, dy), z + Math.min(0, dz), x + Math.max(0, dx) + 1, y + Math.max(0, dy) + 1, z + Math.max(0, dz) + 1];
  }

  checkPermissions(src: CommandSource): void {
    if (this.usesSelector && !src.hasPermission(2)) throw new CommandSyntaxError('Selector not allowed');
  }

  findPlayers(src: CommandSource): Target[] {
    return this.find(src).filter(isPlayer);
  }
}

/** EntitySelectorParser.parse */
export function parseSelector(reader: StringReader, allowSelectors = true): EntitySelector {
  const sel = new EntitySelector();
  const start = reader.cursor;
  if (reader.canRead() && reader.peek() === '@') {
    if (!allowSelectors) throw reader.error('Selector not allowed');
    reader.skip();
    sel.usesSelector = true;
    if (!reader.canRead()) throw reader.error('Missing selector type');
    const c = reader.next();
    let typeLimited = false;
    if (c === 'p') {
      sel.maxResults = 1;
      sel.includesEntities = false;
      sel.sort = 'nearest';
      sel.type = 'player';
      typeLimited = true;
    } else if (c === 'a') {
      sel.includesEntities = false;
      sel.type = 'player';
      typeLimited = true;
    } else if (c === 'r') {
      sel.maxResults = 1;
      sel.includesEntities = false;
      sel.sort = 'random';
      sel.type = 'player';
      typeLimited = true;
    } else if (c === 's') {
      sel.maxResults = 1;
      sel.currentEntity = true;
    } else if (c === 'e') {
      sel.predicates.push(isAlive);
    } else {
      reader.cursor = start;
      throw reader.error(`Unknown selector type '@${c}'`);
    }
    if (reader.canRead() && reader.peek() === '[') {
      reader.skip();
      parseOptions(reader, sel, typeLimited);
    }
  } else {
    // a player name or UUID
    const s = reader.cursor;
    while (reader.canRead() && reader.peek() !== ' ') reader.skip();
    const name = reader.string.slice(s, reader.cursor);
    if (!name || name.length > 16 && !/^[0-9a-f-]{32,36}$/i.test(name)) {
      reader.cursor = start;
      throw reader.error('Invalid name or UUID');
    }
    sel.playerName = name;
    sel.maxResults = 1;
    sel.includesEntities = false;
  }
  return sel;
}

const OPTIONS = ['name', 'distance', 'level', 'x', 'y', 'z', 'dx', 'dy', 'dz', 'x_rotation', 'y_rotation', 'limit', 'sort', 'gamemode', 'team', 'type', 'tag', 'nbt', 'scores', 'advancements', 'predicate'];

function skipBraces(reader: StringReader): void {
  // compound NBT / scores / advancements: balanced braces, strings respected
  let depth = 0;
  do {
    if (!reader.canRead()) throw reader.error('Expected end of options');
    const ch = reader.next();
    if (ch === '"' || ch === "'") reader.readStringUntil(ch);
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  } while (depth > 0);
}

function parseOptions(reader: StringReader, sel: EntitySelector, typeLimited: boolean): void {
  const seen = new Set<string>();
  let typeSet = typeLimited;
  let gamemodeSet = false, nameSet = false, sortSet = false, limitSet = false;
  reader.skipWhitespace();
  while (reader.canRead() && reader.peek() !== ']') {
    reader.skipWhitespace();
    const optStart = reader.cursor;
    const key = reader.readString();
    if (!OPTIONS.includes(key)) {
      reader.cursor = optStart;
      throw reader.error(`Unknown option '${key}'`);
    }
    reader.skipWhitespace();
    if (!reader.canRead() || reader.peek() !== '=') {
      reader.cursor = optStart;
      throw reader.error(`Expected value for option '${key}'`);
    }
    reader.skip();
    reader.skipWhitespace();
    const inapplicable = () => {
      reader.cursor = optStart;
      return reader.error(`Option '${key}' isn't applicable here`);
    };
    const negated = () => {
      reader.skipWhitespace();
      if (reader.canRead() && reader.peek() === '!') {
        reader.skip();
        reader.skipWhitespace();
        return true;
      }
      return false;
    };
    switch (key) {
      case 'name': {
        const not = negated();
        if (nameSet && !not) throw inapplicable();
        const name = reader.readString();
        if (!not) nameSet = true;
        sel.predicates.push((t) => (nameOf(t) === name) !== not);
        break;
      }
      case 'distance': {
        if (sel.distance) throw inapplicable();
        const s = reader.cursor;
        const r = readRange(reader, false);
        if ((r.min !== null && r.min < 0) || (r.max !== null && r.max < 0)) {
          reader.cursor = s;
          throw reader.error('Distance cannot be negative');
        }
        sel.distance = r;
        break;
      }
      case 'level': {
        if (seen.has(key)) throw inapplicable();
        const s = reader.cursor;
        const r = readRange(reader, true);
        if ((r.min !== null && r.min < 0) || (r.max !== null && r.max < 0)) {
          reader.cursor = s;
          throw reader.error('Level cannot be negative');
        }
        sel.includesEntities = false;
        sel.predicates.push((t) => isPlayer(t) && inRange(r, t.living.experienceLevel));
        break;
      }
      case 'x': case 'y': case 'z': case 'dx': case 'dy': case 'dz': {
        if (sel[key] !== null) throw inapplicable();
        sel[key] = reader.readDouble();
        break;
      }
      case 'x_rotation': case 'y_rotation': {
        if (seen.has(key)) throw inapplicable();
        const r = readRange(reader, false);
        const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
        sel.predicates.push((t) => {
          const v = key === 'x_rotation' ? wrap(t.pitch) : wrap(t.yaw);
          const lo = r.min === null ? 0 : wrap(r.min), hi = r.max === null ? 359 : wrap(r.max);
          return lo > hi ? v >= lo || v <= hi : v >= lo && v <= hi;
        });
        break;
      }
      case 'limit': {
        if (sel.currentEntity || limitSet) throw inapplicable();
        const s = reader.cursor;
        const n = reader.readInt();
        if (n < 1) {
          reader.cursor = s;
          throw reader.error('Limit must be at least 1');
        }
        sel.maxResults = n;
        limitSet = true;
        break;
      }
      case 'sort': {
        if (sel.currentEntity || sortSet) throw inapplicable();
        const s = reader.cursor;
        const v = reader.readUnquotedString();
        if (v !== 'nearest' && v !== 'furthest' && v !== 'random' && v !== 'arbitrary') {
          reader.cursor = s;
          throw reader.error(`Invalid or unknown sort type '${v}'`);
        }
        sel.sort = v;
        sortSet = true;
        break;
      }
      case 'gamemode': {
        const s = reader.cursor;
        const not = negated();
        if (gamemodeSet && !not) throw inapplicable();
        const v = reader.readUnquotedString();
        const mode = GAME_MODES.indexOf(v);
        if (mode < 0) {
          reader.cursor = s;
          throw reader.error(`Invalid or unknown game mode '${v}'`);
        }
        sel.includesEntities = false;
        if (!not) gamemodeSet = true;
        sel.predicates.push((t) => isPlayer(t) && (t.gameMode === mode) !== not);
        break;
      }
      case 'type': {
        const s = reader.cursor;
        const not = negated();
        if (typeSet && !not) throw inapplicable();
        if (reader.canRead() && reader.peek() === '#') {
          reader.skip();
          const tag = reader.readResourceLocation();
          // no entity type tags yet: an unknown tag matches nothing
          void tag;
          sel.predicates.push(() => not);
          break;
        }
        const id = reader.readResourceLocation();
        const path = vanillaPath(id);
        if (!path || !ENTITIES_BY_NAME.has(path)) {
          reader.cursor = s;
          throw reader.error(`Invalid or unknown entity type '${fullId(id)}'`);
        }
        if (not) sel.predicates.push((t) => typeOf(t) !== path);
        else {
          typeSet = true;
          sel.type = path;
          if (path === 'player') sel.includesEntities = false;
        }
        break;
      }
      case 'tag': case 'team': {
        // entities carry no scoreboard tags or teams yet: "tag=" / "tag=!x" match everything
        const not = negated();
        const v = reader.readUnquotedString();
        if (!not && v !== '') sel.predicates.push(() => false);
        break;
      }
      case 'nbt': {
        negated();
        skipBraces(reader);
        break;
      }
      case 'scores': case 'advancements': {
        skipBraces(reader);
        break;
      }
      case 'predicate': {
        negated();
        reader.readResourceLocation();
        sel.predicates.push(() => false);
        break;
      }
    }
    seen.add(key);
    reader.skipWhitespace();
    if (reader.canRead() && reader.peek() === ',') {
      reader.skip();
      continue;
    }
    if (!reader.canRead() || reader.peek() !== ']') throw reader.error('Expected end of options');
  }
  if (!reader.canRead()) throw reader.error('Expected end of options');
  reader.skip();
}

/** Suggestions for an entity/player argument (names, selector types, selector options). */
export function suggestSelector(b: SuggestionsBuilder, src: CommandSource, playersOnly: boolean): void {
  const rem = b.remaining;
  if (!rem.includes('[')) {
    if (src.hasPermission(2)) {
      const types: [string, string][] = [['@p', 'Nearest player'], ['@r', 'Random player'], ['@a', 'All players'], ['@s', 'Self']];
      if (!playersOnly) types.push(['@e', 'All entities']);
      for (const [t, tip] of types) if (t.startsWith(rem)) b.suggest(t, tip);
    }
    b.suggestMatching(src.server.allPlayers.map((p) => p.name));
    return;
  }
  // inside the options: suggest keys after '[' or ',', and values for a few options
  const open = rem.indexOf('[');
  const body = rem.slice(open + 1);
  const lastSep = Math.max(body.lastIndexOf(','), -1);
  const cur = body.slice(lastSep + 1).trimStart();
  const prefix = rem.slice(0, rem.length - cur.length);
  const eq = cur.indexOf('=');
  if (eq < 0) {
    for (const o of OPTIONS) if (o.startsWith(cur)) b.suggest(`${prefix}${o}=`);
    return;
  }
  const key = cur.slice(0, eq), val = cur.slice(eq + 1);
  const base = prefix + key + '=';
  let values: string[] = [];
  if (key === 'type') values = ENTITIES.flatMap((e) => [`minecraft:${e.name}`, `!minecraft:${e.name}`]);
  else if (key === 'gamemode') values = GAME_MODES.flatMap((m) => [m, `!${m}`]);
  else if (key === 'sort') values = ['nearest', 'furthest', 'random', 'arbitrary'];
  else if (key === 'name') values = src.server.allPlayers.map((p) => p.name);
  for (const v of values) if (v.startsWith(val) || v.replace(/^(!?)minecraft:/, '$1').startsWith(val)) b.suggest(base + v);
}
