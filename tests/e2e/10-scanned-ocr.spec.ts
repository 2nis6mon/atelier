// Journey 10 — a scanned PDF (no text layer) is read on the Mac with the bundled
// Tesseract models, reviewed, and saved to the library. Also covers the Pages
// formats: preview PDF and the experimental reader.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES, launch } from './harness';

test('read a scanned CV with on-device OCR and import Pages documents', async () => {
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await s.stubOpen([join(FIXTURES, 'CV_scan.pdf'), join(FIXTURES, 'CV_Synthetic_IWA.pages')]);
  await win.getByTestId('open-import').click();
  await win.getByTestId('choose-files').click();
  await expect(win.getByTestId('import-file')).toHaveCount(2, { timeout: 60_000 });

  // Scanned PDF: detected, then recognised locally.
  await win.getByTestId('import-file').filter({ hasText: 'CV_scan.pdf' }).click();
  await expect(win.getByTestId('file-detail')).toContainText('This PDF is a scan');
  await s.shot('90-ocr-needed');
  await win.getByTestId('run-ocr').click();
  await expect(win.getByTestId('file-detail')).toContainText('Camille Laurent', { timeout: 150_000 });
  await expect(win.getByTestId('file-detail')).toContainText('Atelier Nova');
  await s.shot('91-ocr-done');

  // Pages document read by the experimental reader: flagged for careful review.
  await win.getByTestId('import-file').filter({ hasText: 'CV_Synthetic_IWA.pages' }).click();
  await expect(win.getByTestId('pages-help')).toContainText('Check this Pages text carefully');

  await win.getByTestId('to-review').click();
  const conflicts = win.getByTestId('conflict');
  for (let i = 0; i < (await conflicts.count()); i++) await conflicts.nth(i).locator('input[type=radio]').first().check();
  await win.getByTestId('save-import').click();
  await win.getByTestId('import-summary').waitFor();
  await win.getByTestId('import-done').click();

  await win.getByRole('tab', { name: 'Experience' }).click();
  await expect(win.getByTestId('record-item').filter({ hasText: 'Atelier Nova' }).first()).toBeVisible();
  await win.getByRole('tab', { name: 'Sources' }).click();
  await expect(win.getByTestId('source-row').filter({ hasText: 'CV_scan.pdf' })).toContainText('read with on-device OCR');
  await s.close();
});
