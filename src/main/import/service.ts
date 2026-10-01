// Import orchestration: store originals → extract text → parse candidates →
// group duplicates/conflicts with the library → (user review) → commit.
// The batch is persisted so an interrupted review survives a restart.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { parseCvText, type ParsedCandidate } from '../../shared/cvparse';
import { type GroupResolution, type MergeGroup, groupCandidates, resolveGroup } from '../../shared/dedupe';
import { buildDocumentFromLibrary, newId } from '../../shared/document';
import { detectLang } from '../../shared/lang';
import type { ExtractionStatus, Lang, SourceFormat } from '../../shared/types';
import type { Store } from '../db/store';
import { sha256 } from '../storage/files';
import { extractDocx } from './docx';
import { PdfError, extractPdf } from './pdf';
import { readPages } from './pages';

export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

export interface ImportFile {
  sourceId: string | null;
  filename: string;
  format: SourceFormat;
  status: ExtractionStatus | 'duplicate' | 'unsupported';
  method: string;
  warnings: string[];
  text: string;
  lang: Lang;
  candidates: ParsedCandidate[];
  duplicateOf: string | null;
}

export interface ImportBatch {
  id: string;
  createdAt: string;
  files: ImportFile[];
  groups: MergeGroup[];
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  /** CVs created from the imported documents (one per readable document, when requested). */
  cvs: Array<{ id: string; name: string }>;
}

export type GroupDecision = GroupResolution & { skip?: boolean };

const UNSUPPORTED: Record<string, string> = {
  '.doc': 'Old Word format (.doc). Open it in Word or Pages and save it as .docx, then import the .docx.',
  '.odt': 'OpenDocument text. Save it as .docx, then import it.',
  '.rtf': 'Rich Text Format. Save it as .docx, then import it.',
  '.docm': 'Word documents with macros are not imported. Save a copy as .docx (without macros).',
};

export function formatFromName(name: string): SourceFormat {
  const ext = extname(name).toLowerCase();
  if (ext === '.docx') return 'docx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.pages') return 'pages';
  if (ext === '.txt') return 'txt';
  if (ext === '.md' || ext === '.markdown') return 'md';
  return 'unknown';
}

export interface ExtractResult {
  text: string;
  status: ExtractionStatus;
  method: string;
  warnings: string[];
}

/** Extracts text from bytes (or a Pages path). Never throws for bad content. */
export async function extractText(format: SourceFormat, data: Uint8Array, path?: string): Promise<ExtractResult> {
  try {
    switch (format) {
      case 'docx': {
        const r = await extractDocx(data);
        return { text: r.text, status: r.text.trim() ? 'extracted' : 'failed', method: 'docx', warnings: r.text.trim() ? r.warnings : ['No text found in this document.'] };
      }
      case 'pdf': {
        const r = await extractPdf(data);
        if (r.needsOcr) {
          return { text: r.text, status: 'needs-ocr', method: 'pdf:text', warnings: ['This PDF looks scanned (no text layer). Atelier can read it with on-device text recognition (OCR).'] };
        }
        return { text: r.text, status: 'extracted', method: 'pdf:text', warnings: [] };
      }
      case 'pages': {
        if (!path) throw new Error('Pages files are read from disk');
        const r = readPages(path);
        if (r.method === 'pages:preview-pdf' && r.previewPdf) {
          const pdf = await extractPdf(r.previewPdf);
          if (!pdf.needsOcr) return { text: pdf.text, status: 'extracted', method: r.method, warnings: [] };
        }
        if (r.method === 'pages:iwa-experimental') return { text: r.text, status: 'needs-review', method: r.method, warnings: r.warnings };
        return {
          text: '',
          status: 'conversion-needed',
          method: 'pages:none',
          warnings: r.warnings.length ? r.warnings : ['Export this document to Word (.docx) from Pages, then import the .docx.'],
        };
      }
      case 'txt':
      case 'md': {
        const text = new TextDecoder('utf-8').decode(data);
        return { text, status: text.trim() ? 'extracted' : 'failed', method: format, warnings: [] };
      }
      default:
        return { text: '', status: 'failed', method: 'none', warnings: ['Unsupported file type.'] };
    }
  } catch (e) {
    if (e instanceof PdfError) return { text: '', status: 'failed', method: 'pdf:text', warnings: [e.message] };
    return { text: '', status: 'failed', method: format, warnings: ['This file could not be read. It may be damaged.'] };
  }
}

function zipDirectory(dir: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else entries[relative(dir, p).split('\\').join('/')] = new Uint8Array(readFileSync(p));
    }
  };
  walk(dir);
  return zipSync(entries, { mtime: new Date('2000-01-01T00:00:00Z') });
}

export class ImportService {
  constructor(
    private readonly store: Store,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  pending(): ImportBatch | null {
    return this.store.pendingImportBatch<ImportBatch>()?.data ?? null;
  }

  private save(batch: ImportBatch): ImportBatch {
    batch.groups = this.regroup(batch);
    this.store.saveImportBatch(batch.id, batch);
    return batch;
  }

  private regroup(batch: ImportBatch): MergeGroup[] {
    const items = batch.files.flatMap((f) =>
      f.sourceId ? f.candidates.map((candidate) => ({ candidate, source: { sourceId: f.sourceId!, label: f.filename } })) : [],
    );
    return groupCandidates(items, this.store.listRecords());
  }

  /** Imports files into a new batch, or adds them to the given pending batch. */
  async importPaths(paths: string[], batchId?: string): Promise<ImportBatch> {
    const batch: ImportBatch =
      (batchId && this.pending()?.id === batchId ? this.pending() : null) ?? { id: newId(), createdAt: this.now(), files: [], groups: [] };
    for (const path of paths) batch.files.push(await this.importOne(path, batch));
    return this.save(batch);
  }

  private async importOne(path: string, batch: ImportBatch): Promise<ImportFile> {
    const filename = basename(path);
    const format = formatFromName(filename);
    const base: ImportFile = { sourceId: null, filename, format, status: 'unsupported', method: 'none', warnings: [], text: '', lang: 'fr', candidates: [], duplicateOf: null };
    const ext = extname(filename).toLowerCase();
    if (format === 'unknown') return { ...base, warnings: [UNSUPPORTED[ext] ?? 'This file type is not supported. Use .docx, .pdf, .pages or .txt.'] };
    if (!existsSync(path)) return { ...base, status: 'failed', warnings: ['File not found.'] };
    const isDir = statSync(path).isDirectory();
    if (isDir && format !== 'pages') return { ...base, warnings: ['Folders cannot be imported.'] };
    let data: Uint8Array;
    if (isDir) {
      // Pages package folder: keep the original as a zip (same layout as single-file .pages).
      data = zipDirectory(path);
      if (data.byteLength > MAX_IMPORT_BYTES) return { ...base, status: 'failed', warnings: ['This file is larger than 40 MB.'] };
    } else {
      if (statSync(path).size > MAX_IMPORT_BYTES) return { ...base, status: 'failed', warnings: ['This file is larger than 40 MB.'] };
      data = new Uint8Array(readFileSync(path));
    }
    const hash = sha256(data);
    const dup = this.store.findSourceBySha(hash) ?? null;
    const inBatch = batch.files.find((f) => f.sourceId && this.store.getSource(f.sourceId)?.sha256 === hash);
    if (dup || inBatch) {
      return { ...base, status: 'duplicate', warnings: [`Already imported as ${dup?.filename ?? inBatch!.filename}.`], duplicateOf: dup?.id ?? inBatch!.sourceId };
    }
    const extracted = await extractText(format, data, path);
    const sourceId = newId();
    const stored = this.store.files.write('sources', sourceId, filename, data);
    this.store.addSource({
      id: sourceId,
      filename,
      format,
      sha256: hash,
      size: stored.size,
      storedPath: stored.relPath,
      status: extracted.status,
      method: extracted.method,
      extractedText: extracted.text,
      warnings: extracted.warnings,
      convertedFromId: null,
    });
    return this.parsed({ ...base, sourceId, status: extracted.status, method: extracted.method, warnings: extracted.warnings, text: extracted.text });
  }

  private parsed(file: ImportFile): ImportFile {
    if (!file.text.trim()) return { ...file, candidates: [] };
    const lang = detectLang(file.text);
    const cv = parseCvText(file.text, { langHint: lang });
    const lowConfidence = cv.candidates.some((c) => c.confidence === 'low');
    const status: ImportFile['status'] = file.status === 'extracted' && lowConfidence ? 'needs-review' : file.status;
    return { ...file, lang, candidates: cv.candidates, status };
  }

  /** Replaces a file's text (OCR result, converted document or manual correction) and re-parses it. */
  setText(batchId: string, sourceId: string, text: string, method: string): ImportBatch {
    const batch = this.requireBatch(batchId);
    const idx = batch.files.findIndex((f) => f.sourceId === sourceId);
    if (idx < 0) throw new Error('File not in this import');
    const status: ExtractionStatus = text.trim() ? (method.includes('ocr') ? 'needs-review' : 'extracted') : 'failed';
    this.store.updateSource(sourceId, { extractedText: text, method, status, warnings: method.includes('ocr') ? ['Text recognised by OCR: check names, dates and accents.'] : [] });
    batch.files[idx] = this.parsed({ ...batch.files[idx], text, method, status, warnings: this.store.getSource(sourceId)!.warnings });
    return this.save(batch);
  }

  /** Links a .docx converted from a Pages file to its original and imports its text. */
  async attachConversion(batchId: string, pagesSourceId: string, docxPath: string): Promise<ImportBatch> {
    const batch = this.requireBatch(batchId);
    const idx = batch.files.findIndex((f) => f.sourceId === pagesSourceId);
    if (idx < 0) throw new Error('File not in this import');
    const data = new Uint8Array(readFileSync(docxPath));
    const extracted = await extractText('docx', data);
    const id = newId();
    const name = basename(docxPath);
    const stored = this.store.files.write('sources', id, name, data);
    this.store.addSource({
      id,
      filename: name,
      format: 'docx',
      sha256: stored.sha256,
      size: stored.size,
      storedPath: stored.relPath,
      status: extracted.status,
      method: 'pages:converted-docx',
      extractedText: extracted.text,
      warnings: extracted.warnings,
      convertedFromId: pagesSourceId,
    });
    this.store.updateSource(pagesSourceId, { status: 'extracted', method: 'pages:converted', extractedText: extracted.text, warnings: [`Converted to ${name}.`] });
    batch.files[idx] = this.parsed({ ...batch.files[idx], status: extracted.status, method: 'pages:converted', warnings: [`Converted to Word: ${name}`], text: extracted.text });
    return this.save(batch);
  }

  removeFile(batchId: string, sourceId: string): ImportBatch {
    const batch = this.requireBatch(batchId);
    batch.files = batch.files.filter((f) => f.sourceId !== sourceId);
    if (this.store.getSource(sourceId)?.recordCount === 0) this.store.deleteSource(sourceId);
    return this.save(batch);
  }

  /** Saves the reviewed records. Conflicts must be resolved (or the group kept separate / skipped). */
  commit(batchId: string, decisions: Record<string, GroupDecision>, opts: { createCvs?: boolean } = {}): CommitResult {
    const batch = this.requireBatch(batchId);
    // Recompute groups against the library as it is now, but keep the reviewed ids.
    const groups = batch.groups;
    const resolved = groups.flatMap((g) => {
      const d = decisions[g.id] ?? { mode: 'merge', choices: {} };
      if (d.skip) return [];
      return resolveGroup(g, d).map((r) => ({
        ...r,
        // The candidates this record came from, to rebuild each document's own lists (bullets…) in its CV.
        members: g.members.filter((m) => m.origin === 'candidate' && m.sources.some((s) => r.sources.some((rs) => rs.sourceId === s.sourceId))),
      }));
    });
    let created = 0;
    let updated = 0;
    const perSource = new Map<string, number>();
    const recordsBySource = new Map<string, Array<{ recordId: string; own: Record<string, unknown> }>>();
    const cvs: CommitResult['cvs'] = [];
    const run = () => {
      for (const r of resolved) {
        let recordId: string;
        if (r.existingRecordId && this.store.getRecord(r.existingRecordId)) {
          this.store.updateRecord(r.existingRecordId, { data: r.data, addSources: r.sources, fieldSources: r.fieldSources });
          recordId = r.existingRecordId;
          updated++;
        } else {
          recordId = this.store.createRecord({ kind: r.kind, lang: r.lang, data: r.data, sources: r.sources, fieldSources: r.fieldSources }).id;
          created++;
        }
        for (const s of r.sources) perSource.set(s.sourceId, (perSource.get(s.sourceId) ?? 0) + 1);
        for (const m of r.members) {
          for (const s of m.sources) recordsBySource.set(s.sourceId, [...(recordsBySource.get(s.sourceId) ?? []), { recordId, own: m.data }]);
        }
      }
      if (opts.createCvs) {
        // Each readable document becomes its own editable CV, built only from the records it contributed.
        for (const f of batch.files) {
          const entries = f.sourceId ? recordsBySource.get(f.sourceId) : undefined;
          if (!entries?.length) continue;
          const seen = new Set<string>();
          const records = entries.flatMap(({ recordId, own }) => {
            const rec = this.store.getRecord(recordId);
            if (!rec || seen.has(recordId)) return [];
            seen.add(recordId);
            // Reviewed values (dates, titles…) come from the library record; lists stay as written in this document.
            const lists = Object.fromEntries(Object.entries(own).filter(([k, v]) => Array.isArray(v) && k !== 'links'));
            return [{ ...rec, data: { ...rec.data, ...lists } } as typeof rec];
          });
          const name = f.filename.replace(/\.(docx|pdf|pages|txt|md)$/i, '');
          const cv = this.store.createCv({ name, lang: f.lang, document: buildDocumentFromLibrary(records, f.lang), description: `Imported from ${f.filename}` });
          cvs.push({ id: cv.id, name: cv.name });
        }
      }
      for (const f of batch.files) {
        if (!f.sourceId || !this.store.getSource(f.sourceId)) continue;
        const status = f.status === 'needs-ocr' || f.status === 'conversion-needed' || f.status === 'failed' ? f.status : 'extracted';
        this.store.updateSource(f.sourceId, { recordCount: perSource.get(f.sourceId) ?? 0, status: status as ExtractionStatus });
      }
      this.store.saveImportBatch(batch.id, batch, 'done');
    };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      run();
      this.store.db.exec('COMMIT');
    } catch (e) {
      this.store.db.exec('ROLLBACK');
      throw e;
    }
    const skipped = groups.filter((g) => decisions[g.id]?.skip).length;
    return { created, updated, skipped, cvs };
  }

  /** Cancels an import: originals added by this batch are removed again. */
  discard(batchId: string): void {
    const batch = this.requireBatch(batchId);
    for (const f of batch.files) if (f.sourceId && this.store.getSource(f.sourceId)?.recordCount === 0) this.store.deleteSource(f.sourceId);
    this.store.saveImportBatch(batch.id, batch, 'discarded');
  }

  private requireBatch(batchId: string): ImportBatch {
    const b = this.pending();
    if (!b || b.id !== batchId) throw new Error('This import is no longer pending.');
    return b;
  }
}
