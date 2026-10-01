// Coverage gate. Merges the unit/integration/component report (coverage/unit)
// with the end-to-end report (coverage/e2e): for every source file and every
// metric it keeps the higher of the two. Both suites ran the real code, so the
// result is a lower bound of their combined (union) coverage — never more.
// Fails (exit 1) if the global thresholds are not met, if a critical file is
// below its own threshold, or if any file in src/ was not measured at all.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const GLOBAL = { lines: 80, statements: 80, functions: 80, branches: 75 };
const CRITICAL = { lines: 90, statements: 90, functions: 85, branches: 75 };
const CRITICAL_FILES = [/^src\/shared\/(proposals|versions|history)\.ts$/, /^src\/main\/db\//, /^src\/main\/storage\//];
const METRICS = ['lines', 'statements', 'functions', 'branches'];

function load(path) {
  if (!existsSync(path)) {
    console.error(`Missing ${relative(root, path)} — run the suite that produces it first.`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const out = new Map();
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'total') continue;
    const rel = k.startsWith('/') ? relative(root, k) : k;
    out.set(rel.replace(/\\/g, '/'), v);
  }
  return out;
}

function sources(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(n) && !n.endsWith('.d.ts') ? [relative(root, p).replace(/\\/g, '/')] : [];
  });
}

const unit = load(join(root, 'coverage', 'unit', 'coverage-summary.json'));
const e2e = load(join(root, 'coverage', 'e2e', 'coverage-summary.json'));
const files = sources(join(root, 'src')).sort();

const rows = [];
const totals = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));
const problems = [];
const pct = (c, t) => (t === 0 ? 100 : (100 * c) / t);

for (const f of files) {
  const u = unit.get(f);
  const e = e2e.get(f);
  if (!u && !e) {
    problems.push(`${f}: not measured by any suite`);
    continue;
  }
  const row = { file: f, from: {} };
  for (const m of METRICS) {
    const cu = u?.[m];
    const ce = e?.[m];
    const pick = !ce || (cu && cu.total > 0 && pct(cu.covered, cu.total) >= pct(ce.covered, ce.total)) ? { ...cu, src: 'unit' } : { ...ce, src: 'e2e' };
    // A file with no instrumentable code of this kind counts as fully covered for it.
    const covered = pick.total ? pick.covered : 0;
    row[m] = { covered, total: pick.total ?? 0, pct: pct(covered, pick.total ?? 0) };
    row.from[m] = pick.src;
    totals[m].covered += covered;
    totals[m].total += pick.total ?? 0;
  }
  rows.push(row);
  if (CRITICAL_FILES.some((r) => r.test(f))) {
    // Critical logic must meet its bar from unit/integration tests alone.
    for (const m of METRICS) {
      const cu = u?.[m];
      const p = cu ? pct(cu.covered, cu.total) : 0;
      if (p < CRITICAL[m]) problems.push(`${f}: ${m} ${p.toFixed(1)}% < ${CRITICAL[m]}% (critical, unit/integration)`);
    }
  }
}

const summary = Object.fromEntries(METRICS.map((m) => [m, { ...totals[m], pct: pct(totals[m].covered, totals[m].total) }]));
for (const m of METRICS) if (summary[m].pct < GLOBAL[m]) problems.push(`global ${m} ${summary[m].pct.toFixed(2)}% < ${GLOBAL[m]}%`);

const fmt = (x) => `${x.pct.toFixed(1)}%`;
const lines = [
  '# Coverage',
  '',
  'Merged per file and per metric from unit/integration/component tests (`unit`) and the end-to-end suite (`e2e`), keeping the higher value — a lower bound of the real combined coverage.',
  '',
  '| Metric | Covered | Total | % | Threshold |',
  '|---|---:|---:|---:|---:|',
  ...METRICS.map((m) => `| ${m} | ${summary[m].covered} | ${summary[m].total} | ${fmt(summary[m])} | ${GLOBAL[m]}% |`),
  '',
  '| File | Lines | Statements | Functions | Branches | Source (lines) |',
  '|---|---:|---:|---:|---:|---|',
  ...rows.map((r) => `| ${r.file} | ${fmt(r.lines)} | ${fmt(r.statements)} | ${fmt(r.functions)} | ${fmt(r.branches)} | ${r.from.lines} |`),
  '',
];
writeFileSync(join(root, 'coverage', 'SUMMARY.md'), lines.join('\n'));
writeFileSync(join(root, 'coverage', 'summary.json'), JSON.stringify({ thresholds: GLOBAL, critical: CRITICAL, summary, files: rows, problems }, null, 2));

console.log('Merged coverage (unit ∪ e2e, per-file max):');
for (const m of METRICS) console.log(`  ${m.padEnd(11)} ${fmt(summary[m]).padStart(7)}  (${summary[m].covered}/${summary[m].total}, threshold ${GLOBAL[m]}%)`);
if (problems.length) {
  console.error(`\nCoverage gate FAILED:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nCoverage gate passed. Details: coverage/SUMMARY.md');
