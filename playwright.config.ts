import { defineConfig } from '@playwright/test';

// End-to-end journeys drive the built Electron app (dist/) through Playwright's
// Electron support. Run with `npm run test:e2e` (builds first).
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  outputDir: 'test-results/e2e',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
