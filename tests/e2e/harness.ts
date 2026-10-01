// Launches the built app (or a packaged binary) in an isolated data folder and
// exposes the few helpers the journeys share. Native dialogs are replaced in the
// main process for the duration of a test, because they cannot be driven.

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FakeProvider } from './fakeProvider';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const FIXTURES = join(ROOT, 'tests', 'fixtures');
export const SHOTS = process.env.ATELIER_SCREENSHOTS ?? join(ROOT, 'test-results', 'screenshots');
/** When set, V8 coverage of the renderer, preload and main process is written there (see scripts/coverage-e2e.mjs). */
const COVERAGE_DIR = process.env.ATELIER_APP_PATH ? undefined : process.env.ATELIER_COVERAGE_DIR;
let coverageRun = 0;

export interface Session {
  app: ElectronApplication;
  win: Page;
  dataDir: string;
  errors: string[];
  shot(name: string): Promise<void>;
  stubOpen(paths: string[]): Promise<void>;
  stubSave(path: string): Promise<void>;
  close(): Promise<void>;
  /** Simulates a crash: the process is killed without a chance to save. */
  kill(): Promise<void>;
}

export function tempDir(prefix = 'atelier-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function launch(opts: { dataDir?: string; size?: [number, number] } = {}): Promise<Session> {
  const dataDir = opts.dataDir ?? tempDir();
  const packaged = process.env.ATELIER_APP_PATH;
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(ROOT, 'dist', 'main', 'index.cjs')] }),
    env: { ...process.env, ATELIER_E2E: '1', ATELIER_DATA_DIR: dataDir, ...(COVERAGE_DIR ? { NODE_V8_COVERAGE: join(COVERAGE_DIR, 'main') } : {}) },
    timeout: 60_000,
  });
  const win = await app.firstWindow();
  if (COVERAGE_DIR) {
    // Count from the very first script: start coverage, then reload the window.
    await win.coverage.startJSCoverage({ resetOnNavigation: false });
    await win.reload();
  }
  const saveCoverage = async () => {
    if (!COVERAGE_DIR) return;
    const entries = await win.coverage.stopJSCoverage().catch(() => []);
    const keep = entries.filter((e) => e.url.startsWith('app://atelier/assets/') || e.url.endsWith('/preload/index.cjs'));
    mkdirSync(join(COVERAGE_DIR, 'renderer'), { recursive: true });
    writeFileSync(join(COVERAGE_DIR, 'renderer', `${process.pid}-${Date.now()}-${coverageRun++}.json`), JSON.stringify(keep));
  };
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const [w, h] = opts.size ?? [1320, 860];
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h]);
  await win.waitForLoadState('domcontentloaded');
  await win.locator('[data-testid="welcome"], .shell, [data-testid="workspace"]').first().waitFor();
  mkdirSync(SHOTS, { recursive: true });
  return {
    app,
    win,
    dataDir,
    errors,
    shot: async (name) => {
      await win.waitForTimeout(350); // let lens/menus settle
      await win.screenshot({ path: join(SHOTS, `${name}.png`) });
    },
    stubOpen: (paths) =>
      app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = (async () => ({ canceled: p.length === 0, filePaths: p })) as typeof dialog.showOpenDialog;
      }, paths),
    stubSave: (path) =>
      app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
      }, path),
    close: async () => {
      expect(errors, 'uncaught renderer errors').toEqual([]);
      await saveCoverage();
      await app.close();
    },
    kill: async () => {
      await saveCoverage();
      app.process().kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

export const ALL_FIXTURES = ['CV_FR.docx', 'CV_2024.pdf', 'CV_EN.pdf', 'CV_2015.pages'];

/** Imports files through the Import sheet, choosing the option at `pick` for every conflict. */
export async function importFiles(s: Session, files: string[], opts: { pick?: number; separate?: boolean; createCvs?: boolean; fromWelcome?: boolean; shots?: string } = {}) {
  const { win } = s;
  await s.stubOpen(files.map((f) => join(FIXTURES, f)));
  await win.getByTestId(opts.fromWelcome ? 'welcome-import' : 'open-import').click();
  await win.getByTestId('choose-files').click();
  await expect(win.getByTestId('import-file')).toHaveCount(files.length, { timeout: 60_000 });
  if (opts.shots) await s.shot(`${opts.shots}-files`);
  await win.getByTestId('to-review').click();
  const conflicts = win.getByTestId('conflict');
  if (opts.shots) await s.shot(`${opts.shots}-review`);
  if (opts.separate) {
    const groups = win.getByTestId('group-card').filter({ has: win.getByTestId('conflict') });
    while ((await groups.count()) > 0) await groups.first().getByTestId('keep-separate').click();
  }
  const n = await conflicts.count();
  for (let i = 0; i < n; i++) await conflicts.nth(i).locator('input[type=radio]').nth(opts.pick ?? 0).check();
  if (opts.createCvs === false) await win.getByTestId('create-cvs').uncheck();
  await win.getByTestId('save-import').click();
  await win.getByTestId('import-summary').waitFor();
  if (opts.shots) await s.shot(`${opts.shots}-saved`);
  await win.getByTestId('import-done').click();
  await expect(win.getByTestId('import-sheet')).toHaveCount(0);
}

/** Connects the test-only fake provider through the regular "Local model" settings. */
export async function connectFakeProvider(s: Session, fake: FakeProvider) {
  const { win } = s;
  await win.getByTestId('open-settings').click();
  await win.getByTestId('local-url').fill(fake.url);
  await win.getByTestId('local-save').click();
  await expect(win.getByTestId('provider-compatible')).toContainText('Connected', { timeout: 15_000 });
  await win.getByTestId('default-compatible').check();
  await expect(win.getByTestId('default-compatible')).toBeChecked();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('settings')).toHaveCount(0);
}

export async function openCv(s: Session, name: string) {
  await s.win.getByRole('tab', { name: 'Library' }).click();
  await s.win.getByRole('tab', { name: 'CVs' }).click();
  await s.win.locator('.cv-card').filter({ has: s.win.getByText(name, { exact: true }) }).click();
  await s.win.getByTestId('workspace').waitFor();
  await expect(s.win.locator('.cv-pages')).toBeVisible();
}
