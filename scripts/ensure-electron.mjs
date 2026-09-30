// Ensures the Electron binary is present after `npm install`.
// Normal installs let Electron's own postinstall download the binary. In
// restricted build environments (proxy that breaks Node's downloader) run the
// install with ELECTRON_SKIP_BINARY_DOWNLOAD=1 after placing the official,
// checksum-verified zip in ~/.cache/electron; this script then extracts it.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const electronDir = join(root, 'node_modules', 'electron');
if (!existsSync(electronDir)) process.exit(0);
if (existsSync(join(electronDir, 'path.txt'))) process.exit(0);

const { version } = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8'));
const platform = process.platform;
const arch = process.arch;
const zipName = `electron-v${version}-${platform}-${arch}.zip`;
const cacheDir = join(homedir(), '.cache', 'electron');
const zip = join(cacheDir, zipName);
const sums = join(cacheDir, 'SHASUMS256.txt');
if (!existsSync(zip) || !existsSync(sums)) {
  console.warn(`[ensure-electron] ${zipName} not in ${cacheDir}; Electron binary missing.`);
  process.exit(0);
}
const expected = readFileSync(sums, 'utf8')
  .split('\n')
  .find((l) => l.endsWith(`*${zipName}`))
  ?.split(' ')[0];
const actual = createHash('sha256').update(readFileSync(zip)).digest('hex');
if (!expected || expected !== actual) {
  console.error('[ensure-electron] checksum mismatch — refusing to use cached zip');
  process.exit(1);
}
const dist = join(electronDir, 'dist');
mkdirSync(dist, { recursive: true });
execFileSync('unzip', ['-q', '-o', zip, '-d', dist]);
const exe = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron';
writeFileSync(join(electronDir, 'path.txt'), exe);
console.log(`[ensure-electron] extracted verified ${zipName}`);
