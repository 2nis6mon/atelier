import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import mammoth from 'mammoth';
import { buildDocx, exportBlocks, normalizeUrl } from '../../src/main/export/docx';
import { defaultExportName, fileSafe, validateExportName } from '../../src/shared/exportNames';
import { addBlock, createBlock, newEntryItem, newBullet, setBlockHidden, setItemHidden, setTemplate, setText, bulletPath } from '../../src/shared/document';
import type { EntryItem } from '../../src/shared/types';
import { sampleDocument } from '../helpers/sample';

async function unpack(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  return { files, xml: strFromU8(files['word/document.xml']), rels: strFromU8(files['word/_rels/document.xml.rels']), numbering: strFromU8(files['word/numbering.xml'] ?? new Uint8Array()) };
}

describe('DOCX export', () => {
  it('produces real headings, bullet lists, links and French characters', async () => {
    const doc = sampleDocument();
    const exp = doc.blocks[1];
    const entry = exp.items[0] as EntryItem;
    const withFormat = setText(doc, bulletPath(exp.id, entry.id, entry.bullets[0].id), 'Je développe des interfaces avec **React** et *TypeScript*.');
    const bytes = await buildDocx(withFormat, 'CV Camille');
    const { xml, rels, numbering, files } = await unpack(bytes);
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(4); // 3 + 1 bullets are real Word list items
    expect(numbering).toContain('w:val="bullet"');
    expect(xml).toContain('Expérience professionnelle');
    expect(xml).toContain('Amélioration des performances et de l&apos;accessibilité.');
    expect(xml).toMatch(/<w:b\/>[\s\S]{0,200}React/);
    expect(xml).toMatch(/<w:i\/>[\s\S]{0,200}TypeScript/);
    expect(xml).toContain('<w:hyperlink');
    expect(rels).toContain('mailto:camille.laurent@example.com');
    expect(rels).toContain('https://linkedin.com/in/camille-laurent-demo');
    expect(strFromU8(files['word/styles.xml'])).toContain('fr-FR');
    // No images, text boxes or tables
    expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(false);
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).not.toContain('<w:txbxContent>');
    // Readable by another DOCX reader
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    expect(value).toContain('Camille Laurent');
    expect(value).toContain("Développeuse Frontend — Atelier Nova");
    expect(value).toContain("Paris, France · 2021 – aujourd'hui");
    expect(value).toContain('Frontend : React, TypeScript, HTML, CSS');
    expect(value).toContain('Anglais — Courant (C1)');
  });

  it('exports only visible, accepted content in reading order', async () => {
    let doc = sampleDocument();
    doc = setBlockHidden(doc, doc.blocks[4].id, true);
    doc = setItemHidden(doc, doc.blocks[1].id, doc.blocks[1].items[1].id, true);
    const empty = createBlock('custom', 'fr', 'main', 'Vide');
    doc = addBlock(doc, empty);
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await buildDocx(doc)) });
    expect(value).not.toContain('Langues');
    expect(value).not.toContain('Studio Forma');
    expect(value).not.toContain('Vide');
    const side = setTemplate(sampleDocument(), 'sidebar');
    expect(exportBlocks(side).map((b) => b.type)).toEqual(['profile', 'experience', 'education', 'skills', 'languages']);
  });

  it('writes English documents and minimal CVs', async () => {
    const doc = sampleDocument();
    doc.lang = 'en';
    doc.header = { fullName: '', headline: '', email: '', phone: '', location: '', links: [{ label: 'x', url: '' }] };
    doc.blocks = [{ ...createBlock('experience', 'en'), items: [newEntryItem({ title: 'Developer', start: '2020', end: '2022', bullets: [newBullet(''), newBullet('Built things')] })] }];
    const bytes = await buildDocx(doc);
    const { files } = await unpack(bytes);
    expect(strFromU8(files['word/styles.xml'])).toContain('en-GB');
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    expect(value).toContain('Developer');
    expect(value).toContain('2020 – 2022');
  });

  it('builds safe default file names', () => {
    const doc = sampleDocument();
    expect(defaultExportName(doc, 'Maison')).toBe('Camille_Laurent_Maison_FR');
    expect(defaultExportName({ ...doc, header: { ...doc.header, fullName: 'Zoë Ævar Cœur' } }, 'Café & Co')).toBe('Zoe_Aevar_Coeur_Cafe_Co_FR');
    expect(defaultExportName({ ...doc, header: { ...doc.header, fullName: '' } })).toBe('CV_FR');
    expect(fileSafe('  a / b  ')).toBe('a_b');
    expect(validateExportName('')).toBeTruthy();
    expect(validateExportName('a/b')).toBeTruthy();
    expect(validateExportName('x'.repeat(200))).toBeTruthy();
    expect(validateExportName('Camille_Laurent_Maison_FR')).toBeNull();
    expect(normalizeUrl('linkedin.com/in/x')).toBe('https://linkedin.com/in/x');
    expect(normalizeUrl('a@b.fr')).toBe('mailto:a@b.fr');
    expect(normalizeUrl('https://x.dev')).toBe('https://x.dev');
  });
});
