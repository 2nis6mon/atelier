// Full test run with the coverage gate:
//   1. unit + integration + component tests with V8 coverage (vitest)
//   2. an unminified production build, so E2E coverage maps precisely to sources
//   3. every E2E journey against that build, collecting renderer/preload/main coverage
//   4. conversion of the E2E coverage, then the merged gate (scripts/coverage-gate.mjs)
// Any failing test or a coverage below threshold makes the command fail.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const run = (cmd, args, env = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

rmSync(join(root, 'coverage'), { recursive: true, force: true });
run(process.execPath, ['scripts/run-vitest.mjs', 'run', '--coverage']);
run(process.execPath, ['scripts/build.mjs'], { ATELIER_COVERAGE_BUILD: '1' });
const rawDir = join(root, 'coverage', 'e2e-raw');
const headless = process.platform === 'linux' && !process.env.DISPLAY;
if (headless) run('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', 'npx', 'playwright', 'test'], { ATELIER_COVERAGE_DIR: rawDir });
else run('npx', ['playwright', 'test'], { ATELIER_COVERAGE_DIR: rawDir });
run(process.execPath, ['scripts/coverage-e2e.mjs', rawDir]);
run(process.execPath, ['scripts/coverage-gate.mjs']);
