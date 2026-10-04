import type { Tex } from '../lib';

export interface ItemTexDef {
  /** texture name (usually the item id; extra frames like bow_pulling_0 use their vanilla model names) */
  name: string;
  make: () => Tex;
  /** held like a tool (vanilla item/handheld or item/handheld_rod models) */
  handheld?: boolean | 'rod';
}
