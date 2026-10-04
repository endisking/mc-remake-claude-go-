/**
 * World export/import as a .zip with the same layout as a dedicated-server world folder:
 *   <world>/level.json, <world>/players/<id>.json, <world>/region/r.X.Z.bcr
 */
import { Region, regionFileName, regionOf, parseRegionFileName } from './region';
import { writeZip, readZip, type ZipEntry } from './zip';
import type { LevelMeta, PlayerData, WorldStorage, ChunkRecord } from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function safeFolderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _.-]/g, '_').trim().slice(0, 48) || 'world';
}

export async function exportWorld(storage: WorldStorage): Promise<Uint8Array> {
  const meta = await storage.getMeta();
  if (!meta) throw new Error('world has no level data');
  const folder = safeFolderName(meta.name);
  const entries: ZipEntry[] = [{ name: `${folder}/level.json`, data: enc.encode(JSON.stringify(meta, null, 2)) }];
  for (const id of await storage.listPlayers()) {
    const p = await storage.getPlayer(id);
    if (p) entries.push({ name: `${folder}/players/${encodeURIComponent(id)}.json`, data: enc.encode(JSON.stringify(p)) });
  }
  const regions = new Map<string, Region>();
  for (const [cx, cz] of await storage.listChunks()) {
    const data = await storage.getChunk(cx, cz);
    if (!data) continue;
    const [rx, rz] = regionOf(cx, cz);
    const k = `${rx},${rz}`;
    let r = regions.get(k);
    if (!r) regions.set(k, (r = new Region(rx, rz)));
    r.set(cx, cz, data);
  }
  for (const r of regions.values()) entries.push({ name: `${folder}/region/${regionFileName(r.rx, r.rz)}`, data: r.encode() });
  return writeZip(entries);
}

/** Import an exported world into an empty storage; returns its level data. */
export async function importWorld(bytes: Uint8Array, storage: WorldStorage): Promise<LevelMeta> {
  const entries = await readZip(bytes);
  const level = entries.find((e) => e.name === 'level.json' || e.name.endsWith('/level.json'));
  if (!level) throw new Error('no level.json in the archive');
  const prefix = level.name.slice(0, level.name.length - 'level.json'.length);
  const meta = JSON.parse(dec.decode(level.data)) as LevelMeta;
  if (typeof meta.seed !== 'string' || !/^-?\d+$/.test(meta.seed)) throw new Error('level.json has no valid seed');
  for (const e of entries) {
    if (!e.name.startsWith(prefix)) continue;
    const rel = e.name.slice(prefix.length);
    const pm = /^players\/(.+)\.json$/.exec(rel);
    if (pm) {
      await storage.putPlayer(decodeURIComponent(pm[1]!), JSON.parse(dec.decode(e.data)) as PlayerData);
      continue;
    }
    const rm = /^region\/(.+)$/.exec(rel);
    const rc = rm ? parseRegionFileName(rm[1]!) : null;
    if (rc) {
      const region = Region.decode(rc[0], rc[1], e.data);
      const batch: ChunkRecord[] = region.coords().map(([cx, cz]) => ({ cx, cz, data: region.get(cx, cz)! }));
      await storage.putChunks(batch);
    }
  }
  await storage.putMeta(meta);
  return meta;
}
