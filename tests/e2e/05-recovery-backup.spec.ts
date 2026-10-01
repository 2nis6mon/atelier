// Journey 5 — unsaved edits survive a crash; backup to a single file and restore
// it (into an empty Mac and over existing data, with collision choices).
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { importFiles, launch, openCv, tempDir } from './harness';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const TYPED = "Texte écrit juste avant l'arrêt brutal de l'application.";
const TYPED_AFTER = 'Modification faite après la sauvegarde.';

test('recover unsaved work after a crash, then back up and restore', async () => {
  const s = await launch();
  await s.win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx']);
  await openCv(s, 'CV_FR');
  const bullet = s.win.locator('.cv-bullet-text').first();
  await bullet.click();
  await s.win.keyboard.press(`${MOD}+A`);
  await s.win.keyboard.type(TYPED);
  await s.win.waitForTimeout(250); // journaled, but the autosave (600 ms) has not run yet
  await s.kill();

  // Relaunch: the draft on disk is the old one, and Atelier offers the unsaved changes.
  const r = await launch({ dataDir: s.dataDir });
  if (!(await r.win.getByTestId('workspace').isVisible())) await openCv(r, 'CV_FR');
  await expect(r.win.locator('.ws-recovery')).toContainText('Unsaved changes');
  await expect(r.win.locator('.cv-bullet-text').first()).toHaveText('Je développe des interfaces avec React et TypeScript.');
  await r.shot('40-recovery');
  await r.win.getByRole('button', { name: 'Recover them' }).click();
  await expect(r.win.locator('.cv-bullet-text').first()).toHaveText(TYPED);
  await expect(r.win.getByTestId('save-status')).toHaveText('Saved on this Mac');

  // Back up everything to one file.
  const backup = join(tempDir('atelier-backup-'), 'Atelier.atelierbackup');
  await r.stubSave(backup);
  await r.win.getByTestId('back').click();
  await r.win.getByTestId('open-settings').click();
  await r.win.getByRole('tab', { name: 'Storage' }).click();
  await r.win.getByTestId('export-backup').click();
  await expect(r.win.locator('.toast')).toContainText('Backup saved and verified');
  await r.shot('41-backup-saved');
  expect(existsSync(backup)).toBe(true);
  const zip = unzipSync(new Uint8Array(readFileSync(backup)));
  const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as { counts: Record<string, number> };
  expect(manifest.counts.cvs).toBe(1);
  expect(Object.keys(zip).some((k) => /secret|keychain/i.test(k))).toBe(false);
  expect(strFromU8(zip['data.json'])).toContain(TYPED);

  // Change something after the backup, so restoring over it shows a collision.
  await r.win.keyboard.press('Escape');
  await openCv(r, 'CV_FR');
  const b2 = r.win.locator('.cv-bullet-text').first();
  await b2.click();
  await r.win.keyboard.press(`${MOD}+A`);
  await r.win.keyboard.type(TYPED_AFTER);
  await expect(r.win.getByTestId('save-status')).toHaveText('Saved on this Mac');
  await r.win.getByTestId('back').click();

  // Restore over existing data: nothing is overwritten unless chosen.
  await r.stubOpen([backup]);
  await r.win.getByTestId('open-settings').click();
  await r.win.getByRole('tab', { name: 'Storage' }).click();
  await r.win.getByTestId('restore-backup').click();
  const inspection = r.win.getByTestId('backup-inspection');
  await expect(inspection).toContainText('differ from what you have');
  await r.shot('42-restore-collisions');
  await r.win.getByTestId('confirm-restore').click();
  await expect(r.win.locator('.toast').last()).toContainText('kept as they were');
  await r.win.keyboard.press('Escape');
  await openCv(r, 'CV_FR');
  await expect(r.win.locator('.cv-bullet-text').first()).toHaveText(TYPED_AFTER);
  await r.close();

  // Restore into a new, empty Mac.
  const fresh = await launch();
  await fresh.win.getByTestId('welcome-skip').click();
  await fresh.stubOpen([backup]);
  await fresh.win.getByTestId('open-settings').click();
  await fresh.win.getByRole('tab', { name: 'Storage' }).click();
  await fresh.win.getByTestId('restore-backup').click();
  await expect(fresh.win.getByTestId('backup-inspection')).toBeVisible();
  await fresh.win.getByTestId('confirm-restore').click();
  await expect(fresh.win.locator('.toast').last()).toContainText('Restored');
  await fresh.win.keyboard.press('Escape');
  await openCv(fresh, 'CV_FR');
  await expect(fresh.win.locator('.cv-bullet-text').first()).toHaveText(TYPED);
  await fresh.win.getByTestId('back').click();
  await fresh.win.getByRole('tab', { name: 'Sources' }).click();
  await expect(fresh.win.getByTestId('source-row')).toHaveCount(1);
  await fresh.close();
});
