import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ['src/hooks/**/*.test.ts', 'src/hooks/**/*.test.tsx', 'src/plugins/**/*.test.ts', 'src/queryStore/vitest/**/*.test.ts'],
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
