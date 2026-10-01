// Journey 4 — mark as sent → keep editing the draft → the sent snapshot and its
// exact files stay intact; an older version can seed a new draft.
import { expect, test } from '@playwright/test';
import { statSync, writeFileSync } from 'node:fs';
import { importFiles, launch, tempDir } from './harness';
import { sha256, walk } from './helpers';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const ORIGINAL = 'Je développe des interfaces avec React et TypeScript.';
const EDITED = 'Je développe des interfaces web avec React et TypeScript.';

test('a sent version never changes while the draft keeps evolving', async () => {
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx']);

  // Application from pasted text.
  await win.getByRole('tab', { name: 'Applications' }).click();
  await win.getByTestId('new-application').click();
  await win.getByTestId('offer-text').fill('Développeur·se Frontend chez Studio Lune.\nMissions : interfaces React accessibles, TypeScript, design system.');
  await win.getByTestId('na-company').fill('Studio Lune');
  await win.getByTestId('na-role').fill('Développeuse Frontend');
  await win.getByTestId('create-draft').click();
  await win.getByTestId('workspace').waitFor();

  // Export, then record the send.
  const out = tempDir('atelier-sent-');
  await win.getByTestId('export').click();
  await s.stubOpen([out]);
  await win.getByTestId('choose-dir').click();
  await win.getByTestId('export-files').click();
  await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 });
  const exported = walk(out);
  expect(exported).toHaveLength(2);
  const hashes = exported.map(sha256);
  await win.getByTestId('mark-sent').click();
  await expect(win.getByTestId('sent-confirmation')).toContainText('Sent v1');
  await s.shot('30-marked-sent');
  await win.keyboard.press('Escape');

  // Exact, read-only copies are kept with the application.
  const stored = walk(s.dataDir).filter((p) => hashes.includes(sha256(p)));
  expect(stored).toHaveLength(2);
  if (process.platform !== 'win32') for (const p of stored) expect(statSync(p).mode & 0o222).toBe(0);
  // Changing the exported files outside Atelier does not affect the kept copies.
  for (const p of exported) writeFileSync(p, 'changed elsewhere');

  // Keep editing the draft.
  const bullet = win.locator('.cv-bullet-text').first();
  await expect(bullet).toHaveText(ORIGINAL);
  await bullet.click();
  await win.keyboard.press(`${MOD}+A`);
  await win.keyboard.type(EDITED);
  await expect(win.getByTestId('save-status')).toHaveText('Saved on this Mac');

  // Versions: the sent snapshot still shows the text that was sent.
  await win.getByRole('tab', { name: 'Versions' }).click();
  const sent = win.getByTestId('version-item').filter({ hasText: 'Sent v1' });
  await expect(sent).toContainText('locked');
  await sent.click();
  await expect(win.getByTestId('version-details')).toContainText('Studio Lune');
  await expect(win.locator('.versions-center .cv-bullet-text').first()).toHaveText(ORIGINAL);
  await expect(win.getByTestId('open-sent-pdf')).toBeVisible();
  await expect(win.getByTestId('open-sent-docx')).toBeVisible();
  await s.shot('31-versions-sent');
  await win.getByTestId('compare').click();
  await expect(win.getByTestId('compare-dialog')).toContainText(EDITED);
  await s.shot('32-compare');
  await win.keyboard.press('Escape');

  // A new draft from the sent version: the current draft is saved first, the snapshot is untouched.
  await win.getByTestId('restore-version').click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Create new draft' }).click();
  await expect(win.getByTestId('version-item').filter({ hasText: 'Saved' })).toHaveCount(1);
  await win.getByRole('tab', { name: 'Content' }).click();
  await expect(win.locator('.cv-bullet-text').first()).toHaveText(ORIGINAL);
  expect(walk(s.dataDir).filter((p) => hashes.includes(sha256(p)))).toHaveLength(2);

  // The application now lists the sent version and moved to Applied.
  await win.getByTestId('back').click();
  await expect(win.getByTestId('sent-version')).toHaveCount(1);
  await expect(win.getByTestId('status-select')).toHaveValue('applied');
  await s.shot('33-dossier-sent');
  await s.close();
});
