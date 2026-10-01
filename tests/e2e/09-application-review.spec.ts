// Journey 9 — a full application workflow: job context, every kind of AI
// suggestion reviewed (edit, accept, reject, answer, dismiss), add from the
// library, style and section controls, a translated copy, then the board and
// the dossier (statuses, notes, deletion).
import { expect, test } from '@playwright/test';
import { startFakeProvider } from './fakeProvider';
import { connectFakeProvider, importFiles, launch } from './harness';

test('application workflow with every review action, layout controls and the board', async () => {
  const fake = await startFakeProvider('mixed');
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx', 'CV_EN.pdf']);
  await connectFakeProvider(s, fake);

  await win.getByRole('tab', { name: 'Applications' }).click();
  await expect(win.getByText('No applications yet')).toBeVisible();
  await win.getByTestId('new-application').click();
  await win.getByTestId('offer-text').fill('Poste : Développeuse Frontend\nEntreprise : Maison\nReact, TypeScript, accessibilité et design system.');
  await win.getByTestId('base-cv').selectOption({ label: 'CV_FR — Imported from CV_FR.docx' });
  await win.getByTestId('na-company').fill('Maison');
  await win.getByTestId('create-draft').click();
  await win.getByTestId('workspace').waitFor();

  // Job context: edit the offer and notes, then ask for adaptations from there.
  await win.getByTestId('job-chip').click();
  const ctx = win.getByTestId('job-context');
  await ctx.getByRole('button', { name: 'Edit' }).first().click();
  await ctx.getByLabel('Job description').fill('React, TypeScript, accessibilité, design system et tests.');
  await ctx.getByRole('button', { name: 'Save' }).click();
  await expect(ctx).toContainText('design system et tests');
  await ctx.getByRole('button', { name: 'Edit' }).last().click();
  await ctx.getByLabel('My notes').fill('Mettre en avant l’accessibilité.');
  await ctx.getByRole('button', { name: 'Save' }).click();
  await s.shot('80-job-context');
  await ctx.getByTestId('suggest-adaptations').click();

  // Review every kind of suggestion.
  const review = win.getByTestId('review');
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(win.getByTestId('review-progress')).toHaveText('1 of 7');
  await review.getByRole('button', { name: 'Next suggestion' }).click();
  await expect(win.getByTestId('review-progress')).toHaveText('2 of 7');
  await review.getByRole('button', { name: 'Previous suggestion' }).click();
  // 1. rewrite → edited before accepting
  await expect(review).toContainText('Proposed change');
  await win.getByTestId('edit-proposal').click();
  await review.getByLabel('Edit proposed text').fill('Je conçois des interfaces React et TypeScript accessibles.');
  await win.getByTestId('accept').click();
  // 2. new bullet → accepted
  await expect(review).toContainText('Proposed addition');
  await win.getByTestId('accept').click();
  // 3. removal → rejected
  await expect(review).toContainText('Proposed removal');
  await expect(review).toContainText('your library keeps it');
  await win.getByTestId('reject').click();
  // 4. reorder → accepted
  await expect(review).toContainText('Proposed new order');
  await s.shot('81-review-reorder');
  await win.getByTestId('accept').click();
  // 5. from the library → added
  await expect(review).toContainText('From your library');
  await win.getByTestId('accept').click();
  // 6. a question is answered in the assistant, never turned into content
  await expect(review).toContainText('Question for you');
  await s.shot('82-review-question');
  await review.getByRole('button', { name: 'Answer' }).click();
  await expect(review).toHaveCount(0);
  await expect(win.getByTestId('ai-instructions')).toHaveValue(/About your question/);
  // 7. the remaining comment is dismissed
  await win.getByTestId('review-suggestions').click();
  await expect(review).toContainText('Comment');
  await review.getByRole('button', { name: 'Dismiss' }).click();
  await expect(review).toHaveCount(0);

  const page = win.locator('.cv-pages');
  await expect(page).toContainText('Je conçois des interfaces React et TypeScript accessibles.');
  await expect(page).toContainText('Je documente les composants React et TypeScript.');
  await expect(page).toContainText("Amélioration des performances et de l'accessibilité.");
  // reorder accepted: the most recent entry is no longer first
  const orgs = await win.locator('.cv-org').allTextContents();
  expect(orgs.indexOf('Studio Forma')).toBeLessThan(orgs.indexOf('Atelier Nova'));

  // Add from library by hand.
  await win.getByTestId('add-from-library').click();
  const dialog = win.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Skills' }).click();
  await dialog.locator('input[type=checkbox]').first().check();
  await win.getByTestId('add-selected').click();
  await expect(dialog).toHaveCount(0);

  // Style controls.
  await win.getByRole('tab', { name: 'Style' }).click();
  const size = () => win.locator('.cv-pages').evaluate((el) => getComputedStyle(el).getPropertyValue('--cv-size'));
  const before = await size();
  await win.getByRole('button', { name: 'Larger text' }).click();
  await win.getByRole('button', { name: 'Larger text' }).click();
  await win.getByRole('button', { name: 'Smaller text' }).click();
  expect(await size()).not.toBe(before);
  await win.locator('#font-body').selectOption({ index: 1 });
  await win.locator('#font-heading').selectOption({ index: 2 });
  await win.getByRole('radiogroup', { name: 'Heading colour' }).getByRole('radio').nth(1).click();
  await win.getByRole('radiogroup', { name: 'Accent colour' }).getByRole('radio').nth(2).click();
  for (const id of ['#style-lineHeight', '#style-marginMm', '#style-sectionSpacing']) {
    await win.locator(id).focus();
    await win.keyboard.press('ArrowRight');
  }
  await s.shot('83-style');

  // Section menus in Layout mode.
  await win.getByRole('tab', { name: 'Layout' }).click();
  const item = (t: string) => win.getByTestId('palette-item').filter({ hasText: t });
  const menu = async (t: string, action: string) => {
    await item(t).getByRole('button', { name: `Actions for ${t}` }).click();
    await win.getByRole('menuitem', { name: action }).click();
  };
  await menu('Formation', 'Move up');
  await menu('Formation', 'Move down');
  await menu('Formation', 'Start on a new page');
  await expect(win.locator('.cv-sheet')).toHaveCount(2);
  await menu('Formation', 'Remove page break before');
  await menu('Langues', 'Hide from CV');
  await expect(item('Langues')).toHaveClass(/is-hidden/);
  await menu('Langues', 'Show in CV');
  await win.getByRole('button', { name: 'Add a section' }).click();
  await win.getByRole('menuitem', { name: 'Custom section' }).click();
  await expect(item('Nouvelle section')).toHaveCount(1);
  await menu('Nouvelle section', 'Remove section from this CV');
  await expect(item('Nouvelle section')).toHaveCount(0);
  await win.locator('.template-card', { hasText: 'Compact' }).click();
  await expect(win.locator('.cv-pages.template-compact')).toBeVisible();

  // A translated copy: a separate CV whose standard titles switch language.
  await win.getByRole('button', { name: 'CV actions' }).click();
  await win.getByRole('menuitem', { name: 'Create English version…' }).click();
  await expect(win.getByTestId('cv-title')).toContainText('(EN)');
  await expect(win.locator('.cv-pages')).toContainText('Experience');
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.getByTestId('close-review').click();

  // Board: move with the keyboard and the card menu, filter, open the dossier.
  await win.getByTestId('back').click();
  await win.getByRole('tab', { name: 'Applications' }).click();
  const card = win.getByTestId('app-card');
  await expect(card).toHaveCount(1);
  await card.focus();
  await win.keyboard.press('Alt+ArrowRight');
  await expect(win.locator('.column', { hasText: 'Applied' }).getByTestId('app-card')).toHaveCount(1);
  await card.getByTestId('app-card-menu').click();
  await win.getByTestId('move-interview').click();
  await expect(win.locator('.column', { hasText: 'Interview' }).getByTestId('app-card')).toHaveCount(1);
  await win.getByLabel('Status filter').selectOption('interview');
  await expect(card).toHaveCount(1);
  await win.getByLabel('Status filter').selectOption('rejected');
  await expect(card).toHaveCount(0);
  await win.getByLabel('Status filter').selectOption('all');
  await s.shot('84-board');
  await card.getByRole('button', { name: 'Maison Développeuse Frontend' }).click();
  await expect(win.getByTestId('dossier')).toBeVisible();
  await win.getByTestId('status-select').selectOption('offer');
  await expect(win.getByTestId('dossier')).toContainText('Offer');
  await win.getByRole('button', { name: 'Application actions' }).click();
  await win.getByRole('menuitem', { name: 'Delete application…' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(win.getByText('No applications yet')).toBeVisible();
  await s.close();
  await fake.close();
});
