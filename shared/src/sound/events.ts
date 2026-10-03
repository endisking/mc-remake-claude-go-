/** Sound event registry ids (minecraft-data 1.17.1) and category numbering. */
import { SOUND_EVENTS } from '../data';

const BY_NAME = new Map(SOUND_EVENTS.map((e) => [e.name, e.id]));
const BY_ID = new Map(SOUND_EVENTS.map((e) => [e.id, e.name]));

export function soundId(name: string): number {
  const id = BY_NAME.get(name);
  if (id === undefined) throw new Error(`unknown sound event ${name}`);
  return id;
}

export function soundName(id: number): string | undefined {
  return BY_ID.get(id);
}

/** vanilla SoundSource order */
export const SOUND_SOURCES = ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'] as const;
export type SoundSource = (typeof SOUND_SOURCES)[number];
export const sourceId = (s: SoundSource): number => SOUND_SOURCES.indexOf(s);
