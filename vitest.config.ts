import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) },
  },
  test: {
    include: ['shared/src/**/*.test.ts', 'client/src/**/*.test.ts', 'server/src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
