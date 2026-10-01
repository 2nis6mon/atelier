// Production build: main + preload (esbuild, CommonJS for Electron), renderer
// (Vite) and on-device OCR assets (Tesseract worker, WASM core, fra/eng data).
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: 'linked', logLevel: 'warning', legalComments: 'none' };
await build({ ...common, entryPoints: [join(root, 'src/main/index.ts')], outfile: join(dist, 'main/index.cjs'), external: ['electron', 'pdfjs-dist', 'pdfjs-dist/*'] });
await build({ ...common, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(dist, 'preload/index.cjs'), external: ['electron'] });
// ATELIER_DEBUG_BUILD=1 keeps React's development build (readable errors) for local debugging only.
// ATELIER_COVERAGE_BUILD=1 keeps the production build but unminified, so E2E coverage maps precisely to sources.
const debug = process.env.ATELIER_DEBUG_BUILD === '1';
const coverage = process.env.ATELIER_COVERAGE_BUILD === '1';
await viteBuild({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn', ...(debug ? { mode: 'development', build: { minify: false } } : coverage ? { build: { minify: false } } : {}) });

// OCR assets, served locally from app://atelier/ocr/
const ocr = join(dist, 'renderer/ocr');
mkdirSync(join(ocr, 'lang'), { recursive: true });
cpSync(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), join(ocr, 'worker.min.js'));
for (const f of readdirSync(join(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) cpSync(join(root, 'node_modules/tesseract.js-core', f), join(ocr, f));
}
for (const l of ['eng', 'fra']) cpSync(join(root, `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`), join(ocr, 'lang', `${l}.traineddata.gz`));
console.log('build complete →', dist);
