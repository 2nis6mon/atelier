// Smoke test of the PACKAGED app (the .app from the DMG), outside the
// development tree: it launches, creates its local data space, imports a CV and
// exports PDF + Word. Run by CI after `npm run dist:mac` with
//   ATELIER_APP_PATH=/path/to/Atelier.app/Contents/MacOS/Atelier
import { expect, test } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importFiles, launch, openCv, tempDir } from '../e2e/harness';
import { pdfText } from '../e2e/helpers';

test('packaged app: launch, local data space, import, export', async () => {
  const appPath = process.env.ATELIER_APP_PATH;
  expect(appPath, 'set ATELIER_APP_PATH to the packaged executable').toBeTruthy();
  expect(existsSync(appPath!)).toBe(true);

  const s = await launch();
  const info = await s.app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), exe: app.getPath('exe'), userData: app.getPath('userData'), arch: process.arch, platform: process.platform }));
  expect(info.packaged).toBe(true);
  expect(info.exe).toBe(appPath);
  expect(info.userData).toBe(s.dataDir);
  console.log(`Packaged Atelier ${info.version} (${info.platform}/${info.arch}) at ${info.exe}`);

  await expect(s.win.getByTestId('welcome')).toBeVisible();
  await s.shot('smoke-01-welcome');
  await s.win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx', 'CV_2024.pdf'], { pick: 1 });
  expect(readdirSync(join(s.dataDir, 'data')).some((f) => f.endsWith('.db'))).toBe(true);

  await openCv(s, 'CV_FR');
  await s.shot('smoke-02-editor');
  const out = tempDir('atelier-smoke-');
  await s.win.getByTestId('export').click();
  await s.stubOpen([out]);
  await s.win.getByTestId('choose-dir').click();
  await s.win.getByTestId('export-name').fill('Smoke');
  await s.win.getByTestId('export-files').click();
  await expect(s.win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 });
  const pdf = await pdfText(join(out, 'Smoke.pdf'));
  expect(pdf.pages.length).toBeGreaterThanOrEqual(1);
  expect(pdf.pages.join(' ')).toContain('Développeuse Frontend');
  expect(existsSync(join(out, 'Smoke.docx'))).toBe(true);
  await s.shot('smoke-03-exported');

  // About shows the version and where data lives.
  await s.win.keyboard.press('Escape');
  await s.win.getByTestId('back').click();
  await s.win.getByTestId('open-settings').click();
  await s.win.getByRole('tab', { name: 'About' }).click();
  await expect(s.win.getByTestId('settings')).toContainText(info.version);
  await s.shot('smoke-04-about');
  await s.close();
});
