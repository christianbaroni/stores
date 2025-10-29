import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true, // Run tests in a single thread to avoid worker cleanup issues
      },
    },
  },
});
