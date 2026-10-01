import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportError, ExportService } from '../../src/main/export/service';
import type { Store } from '../../src/main/db/store';
import { setText, headerPath } from '../../src/shared/document';
import { sampleDocument } from '../helpers/sample';
import { openStore } from '../helpers/store';
import { tempDir } from '../helpers/tempdir';

let dir: ReturnType<typeof tempDir>;
let store: Store;
let out: string;
const PDF = new TextEncoder().encode('%PDF-1.7 rendered for test');
const renderPdf = vi.fn(async () => ({ data: PDF, pageCount: 1 }));

beforeEach(() => {
  dir = tempDir();
  store = openStore(join(dir.path, 'data'));
  out = join(dir.path, 'out');
  mkdirSync(out);
  renderPdf.mockClear();
});
afterEach(() => {
  store.db.close();
  dir.cleanup();
});

function setup() {
  const base = store.createCv({ name: 'Général', lang: 'fr', document: sampleDocument() });
  const app = store.createApplication({ company: 'Maison', role: 'Frontend Engineer', lang: 'fr', offerText: 'Offre' });
  const cv = store.createApplicationDraft(app.id, base.id);
  return { app, cv, service: new ExportService(store, renderPdf) };
}

describe('export service', () => {
  it('writes PDF and DOCX, then records exactly those bytes as sent', async () => {
    const { app, cv, service } = setup();
    const r = await service.run({ cvId: cv.id, formats: ['pdf', 'docx', 'pdf'], directory: out, baseName: ' Camille_Laurent_FR ', overwrite: false });
    expect(r.files.map((f) => f.kind)).toEqual(['pdf', 'docx']);
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(out, 'Camille_Laurent_FR.pdf'))).toEqual(Buffer.from(PDF));
    const docx = readFileSync(join(out, 'Camille_Laurent_FR.docx'));
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    expect(r.files[0]).toMatchObject({ pageCount: 1, size: PDF.byteLength });
    expect(existsSync(join(out, 'Camille_Laurent_FR.pdf.atelier-tmp'))).toBe(false);

    // Files changed on disk afterwards do not affect what is recorded.
    writeFileSync(join(out, 'Camille_Laurent_FR.pdf'), 'edited elsewhere');
    const v = service.markSent(r.exportId, app.id);
    const pdf = v.files.find((f) => f.kind === 'pdf')!;
    expect(store.readSentFile(pdf.id).data).toEqual(Buffer.from(PDF));
    expect(store.readSentFile(v.files.find((f) => f.kind === 'docx')!.id).data).toEqual(docx);
    // An export can be recorded only once.
    expect(() => service.markSent(r.exportId, app.id)).toThrow(ExportError);
  });

  it('never overwrites without consent and validates every input', async () => {
    const { cv, service } = setup();
    await service.run({ cvId: cv.id, formats: ['docx'], directory: out, baseName: 'CV', overwrite: false });
    await expect(service.run({ cvId: cv.id, formats: ['docx'], directory: out, baseName: 'CV', overwrite: false })).rejects.toMatchObject({ code: 'exists' });
    await expect(service.run({ cvId: cv.id, formats: ['docx'], directory: out, baseName: 'CV', overwrite: true })).resolves.toMatchObject({ files: [{ kind: 'docx' }] });
    await expect(service.run({ cvId: 'missing', formats: ['pdf'], directory: out, baseName: 'CV', overwrite: false })).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.run({ cvId: cv.id, formats: [], directory: out, baseName: 'CV', overwrite: false })).rejects.toMatchObject({ code: 'no-format' });
    await expect(service.run({ cvId: cv.id, formats: ['pdf'], directory: out, baseName: 'a/b', overwrite: false })).rejects.toMatchObject({ code: 'invalid-name' });
    await expect(service.run({ cvId: cv.id, formats: ['pdf'], directory: join(out, 'nope'), baseName: 'CV', overwrite: false })).rejects.toMatchObject({ code: 'no-directory' });
    expect(() => service.markSent('unknown', 'x')).toThrow(/Export the files again/);
  });

  it('reports rendering and writing failures without touching the CV', async () => {
    const { cv, app } = setup();
    const failing = new ExportService(store, async () => {
      throw new Error('renderer crashed');
    });
    const before = store.getCv(cv.id)!.document;
    await expect(failing.run({ cvId: cv.id, formats: ['pdf'], directory: out, baseName: 'CV', overwrite: false })).rejects.toMatchObject({ code: 'render', detail: ['renderer crashed'] });
    expect(store.getCv(cv.id)!.document).toEqual(before);

    const service = new ExportService(store, renderPdf);
    mkdirSync(join(out, 'CV.pdf.atelier-tmp')); // a directory where the temp file must go
    await expect(service.run({ cvId: cv.id, formats: ['pdf'], directory: out, baseName: 'CV', overwrite: false })).rejects.toMatchObject({ code: 'write' });

    // Editing after export makes the export stale: it cannot be recorded as sent.
    const r = await service.run({ cvId: cv.id, formats: ['docx'], directory: out, baseName: 'Other', overwrite: false });
    const current = store.getCv(cv.id)!;
    store.saveCvDocument(cv.id, setText(current.document, headerPath('headline'), 'Autre titre'), current.revision);
    expect(() => service.markSent(r.exportId, app.id)).toThrow(/changed after these files were exported/);
  });
});
