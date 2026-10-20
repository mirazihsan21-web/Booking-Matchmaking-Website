import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests that talk to the local Supabase stack (`pnpm db:start` first). Kept out of `pnpm test`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
