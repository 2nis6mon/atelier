// Journey 1 — first launch → import several CVs → resolve a conflict → save.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { ALL_FIXTURES, FIXTURES, importFiles, launch } from './harness';
import { sha256, walk } from './helpers';

test('first launch, import Word/PDF/Pages, resolve the start-date conflict and save', async () => {
  const s = await launch();
  const { win } = s;
  await expect(win.getByTestId('welcome')).toBeVisible();
  await s.shot('01-welcome');

  await importFiles(s, ALL_FIXTURES, { fromWelcome: true, pick: 1, shots: '02-import' });

  // One editable CV per document, originals kept byte-for-byte.
  await expect(win.locator('.cv-card')).toHaveCount(4);
  await s.shot('03-library-cvs');
  const stored = walk(s.dataDir).map(sha256);
  for (const f of ALL_FIXTURES) expect(stored, `${f} kept unchanged`).toContain(sha256(join(FIXTURES, f)));

  // The conflicting start date was saved with the chosen value (2021), not merged arbitrarily.
  await win.getByRole('tab', { name: 'Experience' }).click();
  const nova = win.getByTestId('record-item').filter({ hasText: 'Atelier Nova' }).filter({ hasText: 'Développeuse Frontend' });
  await expect(nova).toHaveCount(1);
  await expect(nova).toContainText('2021');
  await nova.click();
  await expect(win.getByTestId('record-editor').getByText('Source files')).toBeVisible();
  for (const label of ['CV_FR.docx', 'CV_2024.pdf', 'CV_2015.pages']) await expect(win.getByTestId('record-source').filter({ hasText: label })).toHaveCount(1);
  await s.shot('04-library-experience');

  await win.getByRole('tab', { name: 'Sources' }).click();
  await expect(win.getByTestId('source-row')).toHaveCount(4);
  await s.shot('05-library-sources');

  // Restarting keeps everything and skips onboarding.
  await s.close();
  const again = await launch({ dataDir: s.dataDir });
  await expect(again.win.getByTestId('welcome')).toHaveCount(0);
  await again.win.getByRole('tab', { name: 'Library' }).click();
  await expect(again.win.locator('.cv-card')).toHaveCount(4);
  await again.close();
});
