import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Coverage policy (see docs/TESTING.md):
//  - Two suites measure the same sources: this one (unit + integration +
//    component tests, Node/jsdom) and the end-to-end suite (Playwright driving
//    the built app; Chromium and Node V8 coverage mapped back to src/).
//  - scripts/coverage-gate.mjs merges them per file and per metric, keeping the
//    higher of the two (a lower bound of their true union), and enforces the
//    global gate: ≥80% lines/functions/statements and ≥75% branches over all
//    of src/, with no source file left unmeasured.
//  - Critical logic (proposals, versions, history, database and storage
//    integrity, backup/restore) must reach ≥90% lines here, per file, from
//    unit/integration tests alone.
const CRITICAL = { lines: 90, functions: 85, branches: 75, statements: 90 };

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          include: ['tests/components/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/components/setup.ts'],
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'json', 'html'],
      reportsDirectory: 'coverage/unit',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        'src/shared/proposals.ts': CRITICAL,
        'src/shared/versions.ts': CRITICAL,
        'src/shared/history.ts': CRITICAL,
        'src/main/db/**': CRITICAL,
        'src/main/storage/**': CRITICAL,
      },
    },
  },
});
