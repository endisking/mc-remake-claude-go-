import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Exposes the list of PNGs in public/textures/overrides as `virtual:texture-overrides`. */
function textureOverrides(): Plugin {
  const id = 'virtual:texture-overrides';
  const dir = fileURLToPath(new URL('./public/textures/overrides', import.meta.url));
  return {
    name: 'texture-overrides',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load(s) {
      if (s !== '\0' + id) return null;
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
      return `export default ${JSON.stringify(files)};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.on('all', (_e, file) => {
        if (file.startsWith(dir)) {
          const m = server.moduleGraph.getModuleById('\0' + id);
          if (m) server.moduleGraph.invalidateModule(m);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [textureOverrides()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)), '@server': fileURLToPath(new URL('../server/src', import.meta.url)) },
  },
  server: { port: 5173, host: true },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
