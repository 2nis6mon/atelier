// Journey 8 — library management: AI duplicate check (on request only), merge
// with explicit choices, editing records of every kind, and CV housekeeping.
import { expect, test } from '@playwright/test';
import { startFakeProvider } from './fakeProvider';
import { connectFakeProvider, importFiles, launch } from './harness';

test('check the library with AI, merge duplicates by choice, edit records and manage CVs', async () => {
  const fake = await startFakeProvider('rewrite');
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx', 'CV_2024.pdf'], { separate: true });
  await connectFakeProvider(s, fake);

  // Two separate "Atelier Nova" records were kept; the AI check runs only on request.
  await win.getByRole('tab', { name: 'Experience' }).click();
  const nova = win.getByTestId('record-item').filter({ hasText: 'Atelier Nova' });
  await expect(nova).toHaveCount(2);
  expect(fake.requests).toHaveLength(0);
  await win.getByRole('button', { name: 'Library actions' }).click();
  await win.getByRole('menuitem', { name: 'Check for duplicates with AI' }).click();
  const findings = win.getByTestId('findings');
  await expect(findings).toContainText('Duplicate');
  await expect(findings).toContainText('Contradiction');
  await s.shot('70-ai-findings');
  await findings.getByRole('button', { name: 'Review and merge…' }).first().click();

  // Merge: every differing field needs an explicit choice.
  const merge = win.getByTestId('confirm-merge');
  await expect(merge).toBeDisabled();
  const conflict = win.locator('fieldset.conflict').first();
  await expect(conflict).toContainText('differs');
  await s.shot('71-merge-dialog');
  for (const fs of await win.locator('fieldset.conflict').all()) await fs.locator('input[type=radio]').last().check();
  await merge.click();
  await expect(nova).toHaveCount(1);
  const editor = win.getByTestId('record-editor');
  await expect(editor.getByTestId('record-source')).toHaveCount(2);

  // Edit fields: invalid dates are refused, valid edits are saved with "edited by you" provenance.
  await editor.locator('#f-start').fill('2021-13');
  await editor.locator('#f-start').press('Enter');
  await expect(editor).toContainText('Use YYYY or YYYY-MM');
  await editor.locator('#f-start').fill('2021-03');
  await editor.locator('#f-start').press('Enter');
  await expect(editor).not.toContainText('Use YYYY or YYYY-MM');
  await editor.locator('#f-location').fill('Lyon, France');
  await editor.locator('#f-location').blur();
  await expect(editor).toContainText('edited by you');
  await editor.locator('#f-current').uncheck();
  await editor.locator('#f-end').fill('2025');
  await editor.locator('#f-end').blur();
  await editor.getByRole('button', { name: 'Add' }).nth(1).click(); // achievements
  await editor.getByRole('textbox', { name: 'Achievements 1' }).fill('Refonte accessible du tunnel de commande');
  await editor.getByRole('textbox', { name: 'Achievements 1' }).blur();
  await editor.locator('#f-technologies').fill('React, TypeScript');
  await editor.locator('#f-technologies').blur();
  await editor.getByRole('button', { name: 'Remove key responsibilities 1' }).click();
  await expect(nova).toContainText('2021 – 2025');
  await s.shot('72-record-edited');
  await editor.getByLabel('Content language').selectOption('en');
  await expect(nova).toContainText('EN');

  // Merge from the record menu can also be cancelled ("Keep separate").
  await editor.getByRole('button', { name: 'Record actions' }).click();
  await win.getByRole('menuitem', { name: 'Merge with another record…' }).click();
  await win.getByLabel('Merge with').selectOption({ index: 1 });
  await win.getByRole('button', { name: 'Keep separate' }).click();
  await expect(win.getByTestId('record-item')).toHaveCount(3);

  // Every kind can be added, edited and deleted by hand.
  const kinds = ['Education', 'Skills', 'Languages', 'Certifications', 'Projects', 'Profiles', 'Personal details', 'Custom sections'];
  for (const k of kinds) {
    await win.locator('.nav-item', { hasText: k }).click();
    const before = await win.getByTestId('record-item').count();
    await win.getByTestId('add-record').click();
    await expect(win.getByTestId('record-item')).toHaveCount(before + 1);
    await expect(editor).toBeVisible();
  }
  await win.locator('.nav-item', { hasText: 'Personal details' }).click();
  await win.getByTestId('record-item').last().click();
  await editor.locator('#f-fullName').fill('Camille L.');
  await editor.locator('#f-fullName').blur();
  await editor.getByRole('button', { name: 'Add link' }).click();
  await editor.getByLabel('Link address').last().fill('https://example.com/camille');
  await editor.getByLabel('Link address').last().blur();
  await win.locator('.nav-item', { hasText: 'Skills' }).click();
  const skills = await win.getByTestId('record-item').count();
  await win.getByTestId('record-item').last().click();
  await editor.getByRole('button', { name: 'Record actions' }).click();
  await win.getByRole('menuitem', { name: 'Delete from library…' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete record' }).click();
  await expect(win.getByTestId('record-item')).toHaveCount(skills - 1);

  // Sources: read the extracted text.
  await win.getByRole('tab', { name: 'Sources' }).click();
  await win.getByTestId('source-row').first().getByRole('button', { name: 'View text' }).click();
  await expect(win.getByRole('dialog')).toContainText('Camille Laurent');
  await win.keyboard.press('Escape');

  // CVs: create from the library in English, rename, duplicate, delete.
  await win.getByRole('tab', { name: 'CVs' }).click();
  await win.getByTestId('new-cv').click();
  await win.locator('#new-cv-name').fill('CV Anglais');
  await win.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'English' }).click();
  await win.getByRole('radiogroup', { name: 'Template' }).getByRole('radio', { name: 'Compact' }).click();
  await s.shot('73-new-cv');
  await win.getByTestId('create-cv').click();
  await win.getByTestId('workspace').waitFor();
  await expect(win.locator('.cv-pages.template-compact')).toBeVisible();
  await expect(win.locator('.cv-pages')).toContainText('Experience');
  await win.getByTestId('back').click();

  const card = (name: string) => win.locator('.cv-card').filter({ has: win.getByText(name, { exact: true }) });
  await card('CV Anglais').getByRole('button', { name: 'Actions for CV Anglais' }).click();
  await win.getByRole('menuitem', { name: 'Rename…' }).click();
  await win.getByRole('dialog').getByRole('textbox').first().fill('CV English');
  await win.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(card('CV English')).toHaveCount(1);
  await card('CV English').getByRole('button', { name: 'Actions for CV English' }).click();
  await win.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(card('CV English (copy)')).toHaveCount(1);
  await card('CV English (copy)').getByRole('button', { name: 'Actions for CV English (copy)' }).click();
  await win.getByRole('menuitem', { name: 'Delete…' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete CV' }).click();
  await expect(card('CV English (copy)')).toHaveCount(0);
  await expect(win.locator('.cv-card')).toHaveCount(3);
  await s.close();
  await fake.close();
});
