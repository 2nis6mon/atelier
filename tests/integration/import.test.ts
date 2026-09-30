import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { Store } from '../../src/main/db/store';
import { extractDocx } from '../../src/main/import/docx';
import { extractPdf, itemsToLines } from '../../src/main/import/pdf';
import { decodeIwa, iwaTextStorages, parseProtobuf, readPages, snappyDecompress } from '../../src/main/import/pages';
import { ImportService, extractText, formatFromName } from '../../src/main/import/service';
import { PagesConversionError, convertPagesToDocx, pagesAppPath } from '../../src/main/import/pagesConvert';
import { fetchOffer, validateOfferUrl } from '../../src/main/import/offerFetch';
import { openStore } from '../helpers/store';
import { tempDir } from '../helpers/tempdir';

const FIX = join(__dirname, '..', 'fixtures');
let dir: ReturnType<typeof tempDir>;
let store: Store;
let service: ImportService;

beforeEach(() => {
  dir = tempDir();
  store = openStore(join(dir.path, 'data'));
  service = new ImportService(store, () => '2026-01-15T10:00:00.000Z');
});
afterEach(() => {
  store.db.close();
  dir.cleanup();
});

async function blankPdf(path: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 700, width: 200, height: 40, color: rgb(0.2, 0.2, 0.2) });
  writeFileSync(path, await pdf.save());
}

describe('extractors', () => {
  it('reads DOCX paragraphs, list items and tab columns', async () => {
    const { text } = await extractDocx(readFileSync(join(FIX, 'CV_FR.docx')));
    expect(text).toContain('Camille Laurent');
    expect(text).toContain('Atelier Nova\tParis, France');
    expect(text).toContain('• Je travaille avec les designers.');
    expect(text).toContain("Amélioration des performances et de l'accessibilité.");
  });

  it('reads PDF text with accents, columns and wrapped lines', async () => {
    const r = await extractPdf(readFileSync(join(FIX, 'CV_2024.pdf')));
    expect(r).toMatchObject({ pageCount: 1, needsOcr: false });
    expect(r.text).toContain('EXPÉRIENCE PROFESSIONNELLE');
    expect(r.text).toContain('Atelier Nova\tParis, France');
    expect(r.text).toContain("2021 – aujourd'hui");
  });

  it('flags PDFs without a text layer for OCR and rejects non-PDF data', async () => {
    const p = join(dir.path, 'scan.pdf');
    await blankPdf(p);
    expect((await extractPdf(readFileSync(p))).needsOcr).toBe(true);
    await expect(extractPdf(new TextEncoder().encode('not a pdf'))).rejects.toThrow(/could not be read/);
    const r = await extractText('pdf', readFileSync(p));
    expect(r.status).toBe('needs-ocr');
    expect((await extractText('pdf', new TextEncoder().encode('junk'))).status).toBe('failed');
  });

  it('reconstructs reading order for two-column layouts', () => {
    const items = [];
    for (let i = 0; i < 8; i++) {
      items.push({ str: `Side ${i}`, x: 30, y: 800 - i * 20, width: 120, height: 10 });
      items.push({ str: `Main ${i} with a longer line of text`, x: 250, y: 800 - i * 20, width: 300, height: 10 });
    }
    const lines = itemsToLines(items, 595).filter(Boolean);
    expect(lines.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => `Side ${i}`));
    expect(lines[8]).toBe('Main 0 with a longer line of text');
  });

  it('reads Pages files: embedded preview PDF and experimental IWA text', async () => {
    const old = readPages(join(FIX, 'CV_2015.pages'));
    expect(old.method).toBe('pages:preview-pdf');
    const r = await extractText('pages', new Uint8Array(), join(FIX, 'CV_2015.pages'));
    expect(r).toMatchObject({ status: 'extracted', method: 'pages:preview-pdf' });
    const iwa = readPages(join(FIX, 'CV_Synthetic_IWA.pages'));
    expect(iwa.method).toBe('pages:iwa-experimental');
    expect(iwa.text).toContain('Développeuse Frontend');
    expect(iwa.warnings[0]).toMatch(/experimental/);
    const bad = join(dir.path, 'bad.pages');
    writeFileSync(bad, 'not a zip');
    expect(readPages(bad).method).toBe('pages:none');
    expect((await extractText('pages', new Uint8Array(), bad)).status).toBe('conversion-needed');
    // package folder variant
    const pkg = join(dir.path, 'Folder.pages');
    const entries = unzipSync(readFileSync(join(FIX, 'CV_2015.pages')));
    for (const [name, content] of Object.entries(entries)) {
      mkdirSync(join(pkg, name, '..'), { recursive: true });
      writeFileSync(join(pkg, name), content);
    }
    expect(readPages(pkg).method).toBe('pages:preview-pdf');
    expect(() => readPages(join(dir.path, 'missing.pages'))).toThrow();
  });

  it('decodes Snappy copies and protobuf wire types', () => {
    // "abcabcabc": literal "abc" + copy(offset 3, len 6)
    const snappy = new Uint8Array([9, (3 - 1) << 2, 97, 98, 99, ((6 - 4) << 2) | 1, 3]);
    expect(new TextDecoder().decode(snappyDecompress(snappy))).toBe('abcabcabc');
    const copy2 = new Uint8Array([6, (3 - 1) << 2, 120, 121, 122, ((3 - 1) << 2) | 2, 3, 0]);
    expect(new TextDecoder().decode(snappyDecompress(copy2))).toBe('xyzxyz');
    const copy4 = new Uint8Array([6, (3 - 1) << 2, 120, 121, 122, ((3 - 1) << 2) | 3, 3, 0, 0, 0]);
    expect(new TextDecoder().decode(snappyDecompress(copy4))).toBe('xyzxyz');
    const longLit = new Uint8Array([61, 60 << 2, 60, ...new Array(61).fill(65)]);
    expect(snappyDecompress(longLit).length).toBe(61);
    expect(() => snappyDecompress(new Uint8Array([5, 1]))).toThrow();
    expect(() => snappyDecompress(new Uint8Array([3, 1, 5]))).toThrow(/bad copy/);
    expect(() => decodeIwa(new Uint8Array([1, 0, 0, 0]))).toThrow(/header/);
    expect(() => decodeIwa(new Uint8Array([0, 9, 0, 0, 1]))).toThrow(/truncated/);
    const fields = parseProtobuf(new Uint8Array([8, 150, 1, 17, 0, 0, 0, 0, 0, 0, 0, 0, 29, 0, 0, 0, 0, 18, 1, 65]));
    expect(fields.map((f) => [f.num, f.wire])).toEqual([[1, 0], [2, 2]]); // fixed32/64 fields are skipped
    expect(() => parseProtobuf(new Uint8Array([11]))).toThrow(/wire type/);
    expect(iwaTextStorages(new Uint8Array())).toEqual([]);
  });

  it('maps file names to formats', () => {
    expect(formatFromName('a.DOCX')).toBe('docx');
    expect(formatFromName('a.markdown')).toBe('md');
    expect(formatFromName('a.doc')).toBe('unknown');
  });
});

describe('import service', () => {
  it('imports several files, keeps originals and detects the conflicting start date', async () => {
    const batch = await service.importPaths([join(FIX, 'CV_FR.docx'), join(FIX, 'CV_2024.pdf'), join(FIX, 'CV_Synthetic_IWA.pages')]);
    expect(batch.files.map((f) => [f.filename, f.status])).toEqual([
      ['CV_FR.docx', 'extracted'],
      ['CV_2024.pdf', 'extracted'],
      ['CV_Synthetic_IWA.pages', 'needs-review'],
    ]);
    const src = store.getSource(batch.files[0].sourceId!)!;
    expect(store.files.read(store.sourceStoredPath(src.id)!).equals(readFileSync(join(FIX, 'CV_FR.docx')))).toBe(true);
    const nova = batch.groups.find((g) => g.kind === 'experience' && g.title.startsWith('Atelier Nova'))!;
    expect(nova.members.length).toBeGreaterThanOrEqual(2);
    const start = nova.conflicts.find((c) => c.field === 'start')!;
    expect(start.options.map((o) => [o.display, o.sources[0].label])).toEqual(
      expect.arrayContaining([
        ['2022', 'CV_FR.docx'],
        ['2021', 'CV_2024.pdf'],
      ]),
    );
    // pending batch survives a restart
    store.db.close();
    store = openStore(join(dir.path, 'data'));
    service = new ImportService(store);
    expect(service.pending()?.id).toBe(batch.id);
  });

  it('refuses to commit unresolved conflicts, then saves with provenance', async () => {
    const batch = await service.importPaths([join(FIX, 'CV_FR.docx'), join(FIX, 'CV_2024.pdf')]);
    expect(() => service.commit(batch.id, {})).toThrow(/Choose a value/);
    const decisions: Record<string, { mode: 'merge'; choices: Record<string, number> }> = {};
    for (const g of batch.groups) {
      const choices: Record<string, number> = {};
      for (const c of g.conflicts) choices[c.field] = c.options.findIndex((o) => o.sources.some((s) => s.label === 'CV_2024.pdf')) ?? 0;
      for (const [k, v] of Object.entries(choices)) if (v < 0) choices[k] = 0;
      decisions[g.id] = { mode: 'merge', choices };
    }
    const result = service.commit(batch.id, decisions);
    expect(result.created).toBeGreaterThan(5);
    const nova = store.listRecords('experience').find((r) => (r.data as { company: string }).company === 'Atelier Nova')!;
    expect(nova.data).toMatchObject({ start: '2021', current: true });
    expect(nova.sources.map((s) => s.label).sort()).toEqual(['CV_2024.pdf', 'CV_FR.docx']);
    expect(nova.fieldSources.start).toMatchObject({ label: 'CV_2024.pdf' });
    expect(store.getSource(batch.files[0].sourceId!)!.recordCount).toBeGreaterThan(0);
    expect(service.pending()).toBeNull();
    // re-importing the same file is detected, and new evidence attaches to existing records
    const again = await service.importPaths([join(FIX, 'CV_FR.docx'), join(FIX, 'CV_EN.pdf')]);
    expect(again.files[0]).toMatchObject({ status: 'duplicate' });
    expect(again.files[1].lang).toBe('en');
  });

  it('keeps separate, skips groups and discards imports', async () => {
    const batch = await service.importPaths([join(FIX, 'CV_FR.docx'), join(FIX, 'CV_2024.pdf')]);
    const decisions: Record<string, { mode: 'merge' | 'separate'; choices: Record<string, number>; skip?: boolean }> = {};
    for (const g of batch.groups) decisions[g.id] = g.conflicts.length ? { mode: 'separate', choices: {} } : { mode: 'merge', choices: {}, skip: g.kind === 'language' };
    const r = service.commit(batch.id, decisions);
    expect(r.skipped).toBeGreaterThan(0);
    expect(store.listRecords('language')).toHaveLength(0);
    expect(store.listRecords('experience').filter((x) => (x.data as { company: string }).company === 'Atelier Nova')).toHaveLength(2);

    const b2 = await service.importPaths([join(FIX, 'CV_EN.pdf')]);
    const srcId = b2.files[0].sourceId!;
    service.discard(b2.id);
    expect(store.getSource(srcId)).toBeNull();
    expect(() => service.commit(b2.id, {})).toThrow(/no longer pending/);
  });

  it('handles unsupported, missing, OCR and Pages conversion paths', async () => {
    const scan = join(dir.path, 'scan.pdf');
    await blankPdf(scan);
    const doc = join(dir.path, 'old.doc');
    writeFileSync(doc, 'x');
    const batch = await service.importPaths([doc, join(dir.path, 'nope.pdf'), scan, join(FIX, 'CV_2015.pages')]);
    expect(batch.files.map((f) => f.status)).toEqual(['unsupported', 'failed', 'needs-ocr', 'extracted']);
    expect(batch.files[0].warnings[0]).toMatch(/save it as .docx/i);
    const scanId = batch.files[2].sourceId!;
    const ocr = service.setText(batch.id, scanId, 'Camille Laurent\nDéveloppeuse Frontend\n\nEXPÉRIENCE\nAtelier Nova\n2021 – 2023\n• Interfaces React.', 'pdf:ocr');
    const f = ocr.files.find((x) => x.sourceId === scanId)!;
    expect(f.status).toBe('needs-review');
    expect(f.candidates.some((c) => c.kind === 'experience')).toBe(true);
    expect(store.getSource(scanId)?.method).toBe('pdf:ocr');
    // Pages converted with Pages.app (simulated) is linked to its original
    const pagesId = batch.files[3].sourceId!;
    const converted = await service.attachConversion(batch.id, pagesId, join(FIX, 'CV_FR.docx'));
    expect(converted.files[3].method).toBe('pages:converted');
    expect(store.listSources().find((s) => s.convertedFromId === pagesId)?.method).toBe('pages:converted-docx');
    const removed = service.removeFile(batch.id, scanId);
    expect(removed.files.some((x) => x.sourceId === scanId)).toBe(false);
    expect(() => service.setText(batch.id, 'none', 'x', 'manual')).toThrow();
    await expect(service.attachConversion(batch.id, 'none', 'x')).rejects.toThrow();
    expect(() => service.removeFile('other', 'x')).toThrow();
  });

  it('imports a Pages package folder as a zipped original', async () => {
    const pkg = join(dir.path, 'Paquet.pages');
    const entries = unzipSync(readFileSync(join(FIX, 'CV_2015.pages')));
    for (const [name, content] of Object.entries(entries)) {
      mkdirSync(join(pkg, name, '..'), { recursive: true });
      writeFileSync(join(pkg, name), content);
    }
    const b = await service.importPaths([pkg]);
    expect(b.files[0]).toMatchObject({ status: 'extracted', format: 'pages' });
    const stored = store.files.read(store.sourceStoredPath(b.files[0].sourceId!)!);
    expect(Object.keys(unzipSync(new Uint8Array(stored)))).toContain('QuickLook/Preview.pdf');
    cpSync(join(FIX, 'CV_FR.docx'), join(dir.path, 'folder.docx'));
    mkdirSync(join(dir.path, 'afolder'));
    const b2 = await service.importPaths([join(dir.path, 'afolder')], b.id);
    expect(b2.files.at(-1)?.status).toBe('unsupported');
  });
});

describe('Pages conversion through the Pages app', () => {
  it('passes paths as arguments and maps errors', async () => {
    const calls: string[][] = [];
    const out = join(dir.path, 'out.docx');
    await convertPagesToDocx('/in/My CV.pages', out, async (file, args) => {
      calls.push([file, ...args]);
      writeFileSync(out, 'docx');
      return { stdout: '', stderr: '' };
    }, '/Applications/Pages.app');
    expect(calls[0][0]).toBe('/usr/bin/osascript');
    expect(calls[0].slice(-2)).toEqual(['/in/My CV.pages', out]);
    expect(calls[0].join(' ')).not.toContain('My CV.pages"');
    await expect(convertPagesToDocx('a', 'b', async () => ({ stdout: '', stderr: '' }), null)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(convertPagesToDocx('a', 'b', async () => { throw Object.assign(new Error('x'), { stderr: 'execution error: Not authorised to send Apple events to Pages. (-1743)' }); }, '/P')).rejects.toMatchObject({ reason: 'denied' });
    await expect(convertPagesToDocx('a', 'b', async () => { throw new Error('boom'); }, '/P')).rejects.toBeInstanceOf(PagesConversionError);
    await expect(convertPagesToDocx('a', join(dir.path, 'never.docx'), async () => ({ stdout: '', stderr: '' }), '/P')).rejects.toMatchObject({ reason: 'failed' });
    expect(pagesAppPath('linux')).toBeNull();
    expect(pagesAppPath('darwin', (p) => p === '/Applications/Pages.app')).toBe('/Applications/Pages.app');
    expect(pagesAppPath('darwin', () => false)).toBeNull();
  });
});

describe('job offers from links', () => {
  const html = readFileSync(join(FIX, 'offer-maison.html'), 'utf8');
  const respond = (body: BodyInit, init: ResponseInit) => async () => new Response(body, init);

  it('validates links', () => {
    expect(validateOfferUrl('file:///etc/passwd')).toBeNull();
    expect(validateOfferUrl('https://user:pw@x.com')).toBeNull();
    expect(validateOfferUrl('nonsense')).toBeNull();
    expect(validateOfferUrl('https://maison.example/jobs/1')?.hostname).toBe('maison.example');
  });

  it('extracts structured job postings', async () => {
    const r = await fetchOffer('https://maison.example/jobs/1', respond(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(r).toMatchObject({ ok: true, company: 'Maison', title: 'Frontend Engineer', structured: true });
    if (r.ok) expect(r.text).toContain('• Strong experience with React and TypeScript');
  });

  it('asks to paste when blocked, failing, slow or unsupported', async () => {
    expect(await fetchOffer('ftp://x', respond('', {}))).toMatchObject({ ok: false, reason: 'invalid-url' });
    expect(await fetchOffer('https://x.test', respond('', { status: 403 }))).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await fetchOffer('https://x.test', respond('', { status: 500 }))).toMatchObject({ ok: false, reason: 'http' });
    expect(await fetchOffer('https://x.test', respond('<html><body>Please sign in</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }))).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await fetchOffer('https://x.test', respond('{}', { status: 200, headers: { 'content-type': 'application/json' } }))).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(await fetchOffer('https://x.test', async () => { throw new TypeError('fetch failed'); })).toMatchObject({ ok: false, reason: 'network' });
    const slow = (_u: string, init: { signal: AbortSignal }) => new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    expect(await fetchOffer('https://x.test', slow, 20)).toMatchObject({ ok: false, reason: 'timeout' });
    const big = new Uint8Array(6 * 1024 * 1024);
    expect(await fetchOffer('https://x.test', respond(big, { status: 200, headers: { 'content-type': 'text/html' } }))).toMatchObject({ ok: false, reason: 'too-large' });
    const txt = await fetchOffer('https://x.test/offer.txt', respond('Poste : Développeuse\nNous recherchons…', { status: 200, headers: { 'content-type': 'text/plain' } }));
    expect(txt).toMatchObject({ ok: true });
    const pdf = await fetchOffer('https://x.test/o.pdf', respond(readFileSync(join(FIX, 'CV_EN.pdf')), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    expect(pdf.ok && pdf.text).toContain('Frontend Developer');
  });
});
