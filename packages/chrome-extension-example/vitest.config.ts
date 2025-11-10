import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000, // 30 seconds timeout for tests (helps catch hanging tests in CI)
  },
});
