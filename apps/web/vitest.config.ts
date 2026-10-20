import { defineConfig } from 'vitest/config';

// Database-free unit tests. Integration tests live in test/integration (vitest.integration.config.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
  },
});
