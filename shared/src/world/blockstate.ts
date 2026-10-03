/**
 * Global block-state palette, using the 1.17.1 state numbering (0..20341).
 *
 * A state id encodes a block and the value of each of its properties. Within a
 * block the last property varies fastest; boolean properties are ordered
 * [true, false] like vanilla.
 */
import { BLOCKS, BLOCKS_BY_NAME, BLOCK_STATE_COUNT, type BlockData } from '../data';

export type StateId = number;
export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

/** stateId -> block id */
export const STATE_TO_BLOCK = new Uint16Array(BLOCK_STATE_COUNT);
for (const b of BLOCKS) {
  for (let s = b.minStateId; s <= b.maxStateId; s++) STATE_TO_BLOCK[s] = b.id;
}

interface PropInfo {
  name: string;
  values: PropValue[];
  stride: number;
}

const propInfo: PropInfo[][] = [];
for (const b of BLOCKS) {
  const props: PropInfo[] = [];
  let stride = 1;
  for (let i = b.states.length - 1; i >= 0; i--) {
    const s = b.states[i]!;
    let values: PropValue[];
    if (s.type === 'bool') values = [true, false];
    else if (s.type === 'int') values = (s.values ?? []).map(Number);
    else values = s.values ?? [];
    props.unshift({ name: s.name, values, stride });
    stride *= s.num_values;
  }
  propInfo[b.id] = props;
}

export function blockOf(state: StateId): BlockData {
  return BLOCKS[STATE_TO_BLOCK[state]!]!;
}

export function blockIdOf(state: StateId): number {
  return STATE_TO_BLOCK[state]!;
}

export function blockNameOf(state: StateId): string {
  return BLOCKS[STATE_TO_BLOCK[state]!]!.name;
}

/** Decode all properties of a state. Allocates; avoid in hot loops. */
export function propsOf(state: StateId): Props {
  const b = blockOf(state);
  const rel = state - b.minStateId;
  const out: Props = {};
  for (const p of propInfo[b.id]!) {
    out[p.name] = p.values[Math.floor(rel / p.stride) % p.values.length]!;
  }
  return out;
}

/** Read one property. Returns undefined if the block lacks it. */
export function getProp(state: StateId, name: string): PropValue | undefined {
  const b = blockOf(state);
  const rel = state - b.minStateId;
  for (const p of propInfo[b.id]!) {
    if (p.name === name) return p.values[Math.floor(rel / p.stride) % p.values.length];
  }
  return undefined;
}

/** Return the state with one property changed (unchanged if invalid). */
export function withProp(state: StateId, name: string, value: PropValue): StateId {
  const b = blockOf(state);
  const rel = state - b.minStateId;
  for (const p of propInfo[b.id]!) {
    if (p.name !== name) continue;
    const newIdx = p.values.indexOf(value);
    if (newIdx < 0) return state;
    const oldIdx = Math.floor(rel / p.stride) % p.values.length;
    return state + (newIdx - oldIdx) * p.stride;
  }
  return state;
}

/** Build a state from a block name and (partial) properties; missing props use the default. */
export function stateOf(blockName: string, props?: Props): StateId {
  const b = BLOCKS_BY_NAME.get(blockName);
  if (!b) throw new Error(`unknown block ${blockName}`);
  let s = b.defaultState;
  if (props) for (const k in props) s = withProp(s, k, props[k]!);
  return s;
}

export function defaultState(blockName: string): StateId {
  const b = BLOCKS_BY_NAME.get(blockName);
  if (!b) throw new Error(`unknown block ${blockName}`);
  return b.defaultState;
}

/** Parse "minecraft:oak_stairs[facing=east,half=top]" or "oak_stairs[...]". */
export function parseState(str: string): StateId {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(str.trim());
  if (!m) throw new Error(`bad block state ${str}`);
  const props: Props = {};
  if (m[2]) {
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=').map((x) => x.trim());
      if (!k || v === undefined) continue;
      props[k] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v;
    }
  }
  return stateOf(m[1]!, props);
}

export function stateToString(state: StateId): string {
  const b = blockOf(state);
  const props = propsOf(state);
  const keys = Object.keys(props);
  if (!keys.length) return b.name;
  return `${b.name}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]`;
}

export const AIR = 0;
