// Runs Vitest on Electron's embedded Node runtime (ELECTRON_RUN_AS_NODE) so
// unit and integration tests execute on exactly the Node/SQLite version that
// ships inside Atelier.app. Set ATELIER_TEST_NODE=system to use plain Node.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const useSystem = process.env.ATELIER_TEST_NODE === 'system';
const bin = useSystem ? process.execPath : require('electron');
const child = spawn(bin, [vitestCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
