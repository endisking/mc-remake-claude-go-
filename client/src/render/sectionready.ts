/**
 * Whether a chunk's sections may be meshed: like vanilla's client, a section is only compiled
 * once all eight neighbouring chunk columns are loaded, so its border faces are culled against
 * real blocks instead of drawing walls of faces against chunks that have not arrived yet.
 */
export function hasAllNeighbours(isLoaded: (cx: number, cz: number) => boolean, cx: number, cz: number): boolean {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!isLoaded(cx + dx, cz + dz)) return false;
  return true;
}
