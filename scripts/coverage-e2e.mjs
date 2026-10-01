// Converts the raw V8 coverage written by the E2E suite (ATELIER_COVERAGE_DIR)
// into an Istanbul report mapped back to the TypeScript sources, using the
// build's source maps (renderer, preload and main process).
import MCR from 'monocart-coverage-reports';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const raw = resolve(process.argv[2] ?? join(root, 'coverage', 'e2e-raw'));
const outputDir = join(root, 'coverage', 'e2e');

const IN_SCOPE = (p) => /^src\/.+\.tsx?$/.test(p) && !p.endsWith('.d.ts');

const mcr = MCR({
  name: 'Atelier — end-to-end coverage',
  outputDir,
  cleanCache: true,
  reports: [['json', { file: 'coverage-final.json' }], ['json-summary', { file: 'coverage-summary.json' }], 'text-summary'],
  entryFilter: (entry) => entry.url.startsWith('app://atelier/assets/') || entry.url.includes('/dist/preload/index.cjs') || entry.url.includes('/dist/main/index.cjs'),
  sourcePath: (filePath) => {
    const i = filePath.indexOf('src/');
    return i >= 0 && !filePath.includes('node_modules') ? filePath.slice(i) : filePath;
  },
  sourceFilter: (sourcePath) => {
    if (sourcePath.includes('node_modules')) return false; // dependencies ship their own src/ folders
    const i = sourcePath.indexOf('src/');
    return i >= 0 && IN_SCOPE(sourcePath.slice(i));
  },
});

function mapFor(url) {
  let file = null;
  if (url.startsWith('app://atelier/assets/')) file = join(root, 'dist', 'renderer', 'assets', url.slice('app://atelier/assets/'.length));
  else if (url.includes('/dist/preload/index.cjs')) file = join(root, 'dist', 'preload', 'index.cjs');
  else if (url.includes('/dist/main/index.cjs')) file = join(root, 'dist', 'main', 'index.cjs');
  if (!file || !existsSync(`${file}.map`)) return undefined;
  return JSON.parse(readFileSync(`${file}.map`, 'utf8'));
}

const rendererDir = join(raw, 'renderer');
let n = 0;
if (existsSync(rendererDir)) {
  for (const f of readdirSync(rendererDir)) {
    const entries = JSON.parse(readFileSync(join(rendererDir, f), 'utf8')).map((e) => ({ ...e, sourceMap: mapFor(e.url) }));
    await mcr.add(entries);
    n++;
  }
}
const mainDir = join(raw, 'main');
if (existsSync(mainDir)) {
  for (const f of readdirSync(mainDir)) {
    const data = JSON.parse(readFileSync(join(mainDir, f), 'utf8'));
    const entries = (data.result ?? [])
      .filter((e) => e.url.includes('/dist/main/index.cjs'))
      .map((e) => {
        const path = new URL(e.url).pathname;
        return { ...e, source: readFileSync(path, 'utf8'), sourceMap: mapFor(e.url) };
      });
    if (entries.length) await mcr.add(entries);
    n++;
  }
}
if (n === 0) {
  console.error(`No E2E coverage found in ${raw}. Run the E2E suite with ATELIER_COVERAGE_DIR set.`);
  process.exit(1);
}
await mcr.generate();
console.log(`E2E coverage written to ${outputDir}`);
