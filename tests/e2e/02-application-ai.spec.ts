// Journey 2 — application from an offer link → duplicated CV → test-provider
// suggestions → accept one, reject the other.
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeProvider } from './fakeProvider';
import { FIXTURES, connectFakeProvider, importFiles, launch, openCv } from './harness';

test('create an application from a link, get suggestions, accept one and reject one', async () => {
  const fake = await startFakeProvider('rewrite');
  const offerHtml = readFileSync(join(FIXTURES, 'offer-maison.html'));
  const site = createServer((req, res) => {
    if (req.url === '/jobs/frontend') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(offerHtml);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx']);
  await connectFakeProvider(s, fake);

  // Offer by link: a broken link shows the alternate error state, then the real one is read.
  await win.getByRole('tab', { name: 'Applications' }).click();
  await win.getByTestId('new-application').click();
  await win.getByRole('tab', { name: 'Link' }).click();
  await win.getByLabel('Offer link').fill(`${base}/jobs/missing`);
  await win.getByLabel('Offer link').press('Enter');
  await expect(win.getByTestId('link-error')).toBeVisible();
  await s.shot('10-new-application-link-error');
  await win.getByLabel('Offer link').fill(`${base}/jobs/frontend`);
  await win.getByLabel('Offer link').press('Enter');
  await expect(win.getByTestId('offer-text')).toHaveValue(/React and TypeScript/);
  await expect(win.getByTestId('na-company')).toHaveValue('Maison');
  await expect(win.getByTestId('na-role')).toHaveValue('Frontend Engineer');
  await s.shot('11-new-application');
  await win.getByTestId('create-draft').click();

  // The application gets its own copy of the CV.
  await win.getByTestId('workspace').waitFor();
  await expect(win.getByTestId('job-chip')).toContainText('Maison');
  const firstBullet = win.locator('.cv-bullet-text').first();
  const secondBullet = win.locator('.cv-bullet-text').nth(1);
  await expect(firstBullet).toHaveText('Je développe des interfaces avec React et TypeScript.');
  await expect(secondBullet).toHaveText('Je travaille avec les designers.');

  await win.getByTestId('ai-action').selectOption('adapt');
  await win.getByTestId('ai-scope').selectOption('cv');
  await expect(win.locator('.context-preview')).toContainText('Job offer — Maison');
  await win.getByTestId('get-suggestions').click();
  await expect(win.getByTestId('review-suggestions')).toHaveText(/Review 2 suggestions/, { timeout: 30_000 });
  // Nothing changed before review.
  await expect(firstBullet).toHaveText('Je développe des interfaces avec React et TypeScript.');
  // The offer was sent as untrusted data, fenced.
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0].user).toContain('<<<UNTRUSTED JOB_OFFER (Maison — Frontend Engineer)');

  // The review opens by itself; the document is read-only while reviewing.
  await expect(win.getByTestId('review')).toBeVisible();
  await expect(win.locator('.cv-pages .cv-editable')).toHaveCount(0);
  await expect(win.getByTestId('review-progress')).toHaveText('1 of 2');
  await expect(win.getByTestId('diff-proposed')).toContainText('Au quotidien');
  await s.shot('12-review-changes');
  await win.getByTestId('accept').click();
  await expect(win.getByTestId('review-progress')).toHaveText('1 of 1');
  await win.getByTestId('reject').click();
  await expect(win.getByTestId('review')).toHaveCount(0);

  await expect(firstBullet).toHaveText('Au quotidien, je développe des interfaces avec React et TypeScript.');
  await expect(secondBullet).toHaveText('Je travaille avec les designers.');
  await s.shot('13-after-review');

  // Undo/redo the accepted suggestion.
  await win.getByTestId('undo').click();
  await expect(firstBullet).toHaveText('Je développe des interfaces avec React et TypeScript.');
  await win.getByTestId('redo').click();
  await expect(firstBullet).toHaveText('Au quotidien, je développe des interfaces avec React et TypeScript.');
  await expect(win.getByTestId('save-status')).toHaveText('Saved on this Mac');

  // The base CV is untouched.
  await win.getByTestId('back').click();
  await expect(win.getByTestId('dossier')).toBeVisible();
  await s.shot('14-application-dossier');
  await openCv(s, 'CV_FR');
  await expect(win.locator('.cv-bullet-text').first()).toHaveText('Je développe des interfaces avec React et TypeScript.');

  await s.close();
  await fake.close();
  site.close();
});
