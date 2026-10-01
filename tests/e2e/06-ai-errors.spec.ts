// Journey 6 — AI quota error, cancellation, invalid answer, text changed during
// the request and an unverified fact: the draft is never altered.
import { expect, test } from '@playwright/test';
import { startFakeProvider } from './fakeProvider';
import { connectFakeProvider, importFiles, launch, openCv } from './harness';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('errors, cancellation and conflicts never change the draft', async () => {
  const fake = await startFakeProvider('quota');
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx']);
  await connectFakeProvider(s, fake);
  await openCv(s, 'CV_FR');
  const bullets = win.locator('.cv-bullet-text');
  const before = await bullets.allTextContents();
  const runOnExperience = async () => {
    await win.getByTestId('ai-action').selectOption('rewrite');
    await win.getByTestId('ai-scope').selectOption('section');
    await win.getByLabel('Section', { exact: true }).selectOption({ label: 'Expérience professionnelle' });
    await win.getByTestId('get-suggestions').click();
  };

  // Quota: clear message, no retry on another provider, draft unchanged.
  await runOnExperience();
  const err = win.getByTestId('ai-error');
  await expect(err).toContainText('no remaining quota');
  await expect(err).toContainText('Your draft is unchanged');
  await expect(err).toContainText('No other provider is used automatically');
  await expect(err.getByRole('button', { name: 'AI settings' })).toBeVisible();
  expect(fake.requests).toHaveLength(1);
  expect(await bullets.allTextContents()).toEqual(before);
  await s.shot('50-ai-quota');
  await err.getByRole('button', { name: 'Keep editing' }).click();

  // Cancel while generating.
  fake.mode = 'slow';
  await runOnExperience();
  await expect(win.getByTestId('ai-running')).toContainText('Generating suggestions');
  await s.shot('51-ai-generating');
  await win.getByTestId('cancel-ai').click();
  await expect(win.getByTestId('ai-error')).toContainText('Request cancelled');
  await expect(win.getByTestId('review')).toHaveCount(0);
  expect(await bullets.allTextContents()).toEqual(before);
  await win.getByTestId('ai-error').getByRole('button', { name: 'Keep editing' }).click();

  // Invalid answer from the model.
  fake.mode = 'invalid';
  await runOnExperience();
  await expect(win.getByTestId('ai-error')).toContainText('could not be understood');
  expect(await bullets.allTextContents()).toEqual(before);
  await win.getByTestId('ai-error').getByRole('button', { name: 'Keep editing' }).click();

  // The text changes while the request runs: the suggestion cannot be applied blindly.
  fake.mode = 'slow';
  await runOnExperience();
  await expect(win.getByTestId('ai-running')).toBeVisible();
  await bullets.first().click();
  await win.keyboard.press(`${MOD}+A`);
  await win.keyboard.type('Je développe des interfaces modernes avec React et TypeScript.');
  await expect(win.getByTestId('review')).toBeVisible({ timeout: 30_000 });
  await expect(win.getByTestId('stale')).toContainText('Text changed during the request');
  await expect(win.getByTestId('accept')).toBeDisabled();
  await s.shot('52-review-conflict');
  await win.getByTestId('reject').click();
  await win.getByTestId('reject').click();
  await expect(bullets.first()).toHaveText('Je développe des interfaces modernes avec React et TypeScript.');
  expect((await bullets.allTextContents()).slice(1)).toEqual(before.slice(1));

  // A suggestion with a fact not found in the documents needs explicit confirmation.
  fake.mode = 'unverified';
  await runOnExperience();
  await expect(win.getByTestId('unverified')).toContainText('Kubernetes');
  await expect(win.getByTestId('accept')).toBeDisabled();
  await s.shot('53-review-unverified');
  await win.getByTestId('confirm-facts').check();
  await expect(win.getByTestId('accept')).toBeEnabled();
  await win.getByTestId('reject').click();
  await expect(win.locator('.cv-pages')).not.toContainText('Kubernetes');

  // Every attempt went to the one configured connection (no automatic fallback).
  expect(fake.requests).toHaveLength(5); // quota, cancelled, invalid, conflict, unverified
  await s.close();
  await fake.close();
});
