import { defineConfig } from '@playwright/test';

// Smoke test of the packaged application (see tests/smoke/packaged.spec.ts).
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/smoke-results.json' }]],
  outputDir: 'test-results/smoke',
  use: { trace: 'retain-on-failure' },
});
