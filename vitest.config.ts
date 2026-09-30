import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Coverage policy (see docs/TESTING.md):
//  - Global: ≥80% lines/functions/statements, ≥75% branches over all
//    instrumentable application code in src/.
//  - Critical logic (proposals, versions/sent immutability, history, storage
//    integrity, backup/restore): ≥90% lines, enforced per file.
//  - Excluded (documented): process bootstrap files that only wire Electron
//    platform APIs together; they are exercised by the E2E suite instead.
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
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        // Electron process bootstrap & window wiring (platform API glue, covered by E2E):
        'src/main/index.ts',
        'src/main/app/**',
        'src/preload/**',
        'src/renderer/main.tsx',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
        'src/shared/proposals.ts': CRITICAL,
        'src/shared/versions.ts': CRITICAL,
        'src/shared/history.ts': CRITICAL,
        'src/main/db/**': CRITICAL,
        'src/main/storage/**': CRITICAL,
      },
    },
  },
});
