// Export orchestration: renders the saved draft to PDF and/or DOCX, writes
// the files where the user chose (never overwriting without explicit
// consent), and keeps the exact bytes so "Mark as sent" freezes precisely
// what was exported.

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentHash, newId } from '../../shared/document';
import { validateExportName } from '../../shared/exportNames';
import type { ExportRequest, ExportResult } from '../../shared/api';
import type { CvDocument, CvVersion } from '../../shared/types';
import type { Store } from '../db/store';
import { StoreError } from '../db/store';
import { buildDocx } from './docx';

export type PdfRenderer = (doc: CvDocument) => Promise<{ data: Uint8Array; pageCount: number }>;

export class ExportError extends Error {
  constructor(
    readonly code: 'exists' | 'invalid-name' | 'no-directory' | 'no-format' | 'not-found' | 'render' | 'write' | 'unknown-export',
    message: string,
    readonly detail: string[] = [],
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

interface KeptExport {
  cvId: string;
  docHash: string;
  files: Array<{ kind: 'pdf' | 'docx'; filename: string; data: Uint8Array }>;
}

export class ExportService {
  private readonly exports = new Map<string, KeptExport>();

  constructor(
    private readonly store: Store,
    private readonly renderPdf: PdfRenderer,
  ) {}

  async run(req: ExportRequest): Promise<ExportResult> {
    const cv = this.store.getCv(req.cvId);
    if (!cv) throw new ExportError('not-found', 'CV not found.');
    const formats = [...new Set(req.formats)].filter((f) => f === 'pdf' || f === 'docx');
    if (formats.length === 0) throw new ExportError('no-format', 'Choose PDF, Word or both.');
    const nameError = validateExportName(req.baseName);
    if (nameError) throw new ExportError('invalid-name', nameError);
    if (!req.directory || !existsSync(req.directory) || !statSync(req.directory).isDirectory()) {
      throw new ExportError('no-directory', 'Choose a folder to save the files in.');
    }
    const targets = formats.map((kind) => ({ kind, filename: `${req.baseName.trim()}.${kind}`, path: join(req.directory, `${req.baseName.trim()}.${kind}`) }));
    const existing = targets.filter((t) => existsSync(t.path));
    if (existing.length && !req.overwrite) {
      throw new ExportError('exists', `A file with this name already exists: ${existing.map((t) => t.filename).join(', ')}. Replace it or choose another name.`, existing.map((t) => t.path));
    }
    const doc = cv.document;
    const docHash = documentHash(doc);
    const rendered: Array<{ kind: 'pdf' | 'docx'; filename: string; path: string; data: Uint8Array; pageCount?: number }> = [];
    for (const t of targets) {
      try {
        if (t.kind === 'pdf') {
          const pdf = await this.renderPdf(doc);
          rendered.push({ ...t, data: pdf.data, pageCount: pdf.pageCount });
        } else {
          rendered.push({ ...t, data: await buildDocx(doc, cv.name) });
        }
      } catch (e) {
        throw new ExportError('render', `The ${t.kind.toUpperCase()} could not be created. Your CV is unchanged.`, [String((e as Error)?.message ?? e)]);
      }
    }
    try {
      mkdirSync(req.directory, { recursive: true });
      for (const r of rendered) {
        const tmp = `${r.path}.atelier-tmp`;
        writeFileSync(tmp, r.data);
        renameSync(tmp, r.path);
      }
    } catch (e) {
      throw new ExportError('write', 'The files could not be saved in this folder. Check that it is writable and has free space.', [String((e as Error)?.message ?? e)]);
    }
    const exportId = newId();
    this.exports.set(exportId, { cvId: cv.id, docHash, files: rendered.map((r) => ({ kind: r.kind, filename: r.filename, data: r.data })) });
    return { exportId, docHash, files: rendered.map((r) => ({ kind: r.kind, path: r.path, size: r.data.byteLength, pageCount: r.pageCount })) };
  }

  /** Records the exact exported files as sent for an application. */
  markSent(exportId: string, applicationId: string): CvVersion {
    const kept = this.exports.get(exportId);
    if (!kept) throw new ExportError('unknown-export', 'Export the files again before marking them as sent.');
    try {
      const version = this.store.recordSent(kept.cvId, applicationId, kept.docHash, kept.files);
      this.exports.delete(exportId);
      return version;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw e;
    }
  }
}
