// Journey 3 — manual editing → undo/redo → template → move sections →
// multi-page → export PDF and DOCX → inspect the files.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { importFiles, launch, openCv, tempDir } from './harness';
import { pdfText } from './helpers';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('edit by hand, change layout, export PDF and Word and check the files', async () => {
  const s = await launch();
  const { win } = s;
  await win.getByTestId('welcome-skip').click();
  await importFiles(s, ['CV_FR.docx']);
  await openCv(s, 'CV_FR');

  // Edit a bullet in place.
  const bullet = win.locator('.cv-bullet-text').first();
  await bullet.click();
  await win.keyboard.press(`${MOD}+A`);
  await win.keyboard.type('Je conçois des interfaces accessibles avec React et TypeScript.');
  await expect(bullet).toHaveText('Je conçois des interfaces accessibles avec React et TypeScript.');
  await expect(win.getByTestId('save-status')).toHaveText('Saved on this Mac');

  // Bold a word with the keyboard.
  await bullet.dblclick({ position: { x: 30, y: 6 } });
  await win.keyboard.press(`${MOD}+B`);
  await expect(bullet.locator('strong')).toHaveCount(1);

  // Undo the bold and the edit, then redo the edit.
  await win.getByTestId('undo').click();
  await expect(bullet.locator('strong')).toHaveCount(0);
  await win.getByTestId('undo').click();
  await expect(bullet).toHaveText('Je développe des interfaces avec React et TypeScript.');
  await win.getByTestId('redo').click();
  await expect(bullet).toHaveText('Je conçois des interfaces accessibles avec React et TypeScript.');

  // Add bullets with Enter until the CV needs a second page (text is never shrunk).
  await bullet.click();
  await win.keyboard.press('End');
  for (let i = 1; i <= 26; i++) {
    await win.keyboard.press('Enter');
    await win.keyboard.type(`Résultat mesurable n° ${i} : livraison d'un écran accessible, testé et documenté avec l'équipe.`);
  }
  await expect(win.locator('.cv-sheet')).toHaveCount(2);
  await s.shot('20-two-pages');

  // Sidebar template, then move sections with the keyboard (order and column).
  await win.getByRole('tab', { name: 'Layout' }).click();
  await win.locator('.template-card', { hasText: 'Sidebar' }).click();
  await expect(win.locator('.cv-pages.template-sidebar')).toBeVisible();
  const palette = win.getByTestId('sections-palette');
  const skills = palette.getByTestId('palette-item').filter({ hasText: 'Compétences' });
  await skills.focus();
  await win.keyboard.press('Alt+ArrowLeft'); // to the main column
  await expect(win.locator('.cv-col-main')).toContainText('Compétences');
  const formation = palette.getByTestId('palette-item').filter({ hasText: 'Formation' });
  await formation.focus();
  await win.keyboard.press('Alt+ArrowUp');
  await win.keyboard.press('Alt+ArrowUp');
  const titles = await win.locator('.cv-col-main .cv-block-title').allTextContents();
  expect(titles.indexOf('Formation')).toBeLessThan(titles.indexOf('Expérience professionnelle'));
  // Hide a section: kept in the CV, left out of exports.
  await palette.getByTestId('palette-item').filter({ hasText: 'Langues' }).getByTestId('toggle-visibility').click();
  await expect(win.locator('.cv-pages')).not.toContainText('Anglais');
  await s.shot('21-layout-sidebar');

  // Export both formats.
  const out = tempDir('atelier-export-');
  await win.getByTestId('export').click();
  await s.stubOpen([out]);
  await win.getByTestId('choose-dir').click();
  await expect(win.getByTestId('export-dir')).toHaveText(out);
  await win.getByTestId('export-name').fill('Camille_Laurent_Sidebar');
  await s.shot('22-export-sheet');
  await win.getByTestId('export-files').click();
  await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 });
  await s.shot('23-export-done');

  const pdf = await pdfText(join(out, 'Camille_Laurent_Sidebar.pdf'));
  expect(pdf.pages).toHaveLength(2);
  for (const p of pdf.pages) expect(p.trim().length, 'no blank page').toBeGreaterThan(100);
  const all = pdf.pages.join(' ');
  expect(all).toContain('Je conçois des interfaces accessibles avec React et TypeScript.');
  expect(all).toContain('Résultat mesurable n° 26');
  expect(all).toContain('Développeuse Frontend');
  expect(all).not.toContain('Anglais');
  expect(pdf.links).toEqual(expect.arrayContaining(['mailto:camille.laurent@example.com']));

  const docx = unzipSync(new Uint8Array(readFileSync(join(out, 'Camille_Laurent_Sidebar.docx'))));
  const xml = strFromU8(docx['word/document.xml']);
  expect(xml).toContain('Je conçois des interfaces accessibles avec React et TypeScript.');
  expect(xml).toContain('w:val="Heading1"');
  expect(xml.match(/<w:numPr>/g)?.length ?? 0).toBeGreaterThan(26);
  expect(xml).not.toContain('<w:drawing');
  expect(xml).not.toContain('<w:tbl>');
  expect(xml).not.toContain('Anglais');
  await s.close();
});
