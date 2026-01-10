import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/plugins/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@/env': resolve(__dirname, 'src/env.web.ts'),
      '@/storage': resolve(__dirname, 'src/storesStorage.web.ts'),
    },
  },
});
