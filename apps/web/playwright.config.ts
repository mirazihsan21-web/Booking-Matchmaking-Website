import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end journeys against the local stack (`pnpm env:local`, `pnpm brand:setup --name "Demo Arena" --demo`).
// Results and the report go to the OS temp folder, never into the repo: files written inside it make
// `next dev` recompile and reload the page in a loop.
const out = join(tmpdir(), 'bookingandmatchmaking-e2e');

export default defineConfig({
  testDir: 'e2e',
  outputDir: join(out, 'results'),
  reporter: [['list'], ['html', { outputFolder: join(out, 'report'), open: 'never' }]],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
});
