/**
 * Freesound search helper (CC0 only): prints candidate sounds for a query so they can be
 * picked into sources.ts. Excludes anything mentioning Minecraft (no ripped game audio).
 * Usage: pnpm tsx tools/soundgen/search.ts "gravel footsteps" [maxDuration]
 */
export interface Candidate {
  id: number;
  user: string;
  title: string;
  duration: number;
  downloads: number;
  preview: string;
}

import { execFileSync } from 'node:child_process';

/** HTTP GET through curl (it honours the session's HTTPS proxy, unlike Node's fetch). */
export function curlText(url: string): string {
  return execFileSync('curl', ['-sSL', '--max-time', '60', url], { maxBuffer: 64 << 20 }).toString();
}

export async function searchFreesound(query: string, page = 1): Promise<Candidate[]> {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(query)}&f=license%3A%22Creative+Commons+0%22&page=${page}`;
  const html = curlText(url);
  const out: Candidate[] = [];
  const re = /data-sound-id="(\d+)"\s+data-username="([^"]+)"[\s\S]*?data-ogg="([^"]+)"[\s\S]*?data-title="([^"]*)"\s+data-duration="([\d.]+)"[\s\S]*?data-num-downloads="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const title = m[4]!.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
    if (/minecraft|mojang/i.test(title)) continue;
    out.push({ id: Number(m[1]), user: m[2]!, preview: m[3]!.replace('-lq.ogg', '-hq.ogg'), title, duration: Number(m[5]), downloads: Number(m[6]) });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv[2] ?? 'footsteps';
  const maxDur = Number(process.argv[3] ?? 60);
  const res = (await searchFreesound(q)).filter((c) => c.duration <= maxDur).sort((a, b) => b.downloads - a.downloads);
  for (const c of res) console.log(`${c.id}\t${c.duration.toFixed(2)}s\t${c.downloads}\t${c.user}\t${c.title}`);
}
