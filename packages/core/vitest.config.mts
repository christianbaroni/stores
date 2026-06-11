import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'Date', 'performance'],
    },
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@/env': resolve(__dirname, 'src/env.web.ts'),
      '@/storage': resolve(__dirname, 'src/storesStorage.web.ts'),
    },
  },
});
