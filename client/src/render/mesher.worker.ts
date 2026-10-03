/// <reference lib="webworker" />
/** Mesher worker: receives padded section snapshots, returns packed vertex buffers. */
import { Mesher, type MeshInput, type MesherOptions } from './mesher';
import { bakeBlockModels, type TextureManifest } from './blockmodels';

let mesher: Mesher | null = null;

export type MesherRequest =
  | { type: 'init'; manifest: TextureManifest; opts: MesherOptions }
  | { type: 'mesh'; id: number; input: MeshInput };

self.onmessage = (e: MessageEvent<MesherRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const { bake, fluids } = bakeBlockModels(msg.manifest, msg.opts.fancy);
    mesher = new Mesher(bake, fluids, msg.opts);
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'mesh' && mesher) {
    const t0 = performance.now();
    const out = mesher.mesh(msg.input);
    const ms = performance.now() - t0;
    (self as unknown as Worker).postMessage(
      { type: 'mesh', id: msg.id, out, ms },
      [out.passes[0].buffer, out.passes[1].buffer, out.passes[2].buffer, out.centers.buffer, out.visibility.buffer],
    );
  }
};
