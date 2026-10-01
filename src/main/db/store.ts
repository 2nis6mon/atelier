// Repository for everything Atelier keeps on disk. All multi-step changes run
// in a transaction; sent versions are immutable (enforced here and by SQLite
// triggers).

import { documentHash, emptyDocument, newId } from '../../shared/document';
import { canRecordSend, canTransition, statusAfterSend, transitionMessage, STATUS_LABEL } from '../../shared/status';
import { assertMutable, nextVersionNumber, versionLabel } from '../../shared/versions';
import { validateDocument, validateRecordData } from '../../shared/validation';
import type {
  AppEvent,
  AppEventType,
  AppStatus,
  Application,
  ApplicationSummary,
  ConversationMessage,
  Cv,
  CvDocument,
  CvSummary,
  CvVersion,
  Lang,
  LibraryRecord,
  Proposal,
  RecordKind,
  SentContext,
  SentFile,
  Settings,
  SourceFile,
  SourceRef,
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { FileStore } from '../storage/files';
import { type Db, tx } from './connection';

type Row = Record<string, unknown>;

export class StoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const nowIso = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

function toSource(r: Row): SourceFile {
  return {
    id: String(r.id),
    filename: String(r.filename),
    format: r.format as SourceFile['format'],
    sha256: String(r.sha256),
    size: Number(r.size),
    importedAt: String(r.imported_at),
    status: r.status as SourceFile['status'],
    method: String(r.method),
    extractedText: String(r.extracted_text ?? ''),
    warnings: parse(r.warnings, [] as string[]),
    convertedFromId: (r.converted_from_id as string | null) ?? null,
    recordCount: Number(r.record_count ?? 0),
  };
}

function toRecord(r: Row): LibraryRecord {
  return {
    id: String(r.id),
    kind: r.kind as RecordKind,
    lang: r.lang as Lang,
    data: parse(r.data, {}) as LibraryRecord['data'],
    sources: parse(r.sources, [] as SourceRef[]),
    fieldSources: parse(r.field_sources, {}),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toCv(r: Row): Cv {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ''),
    lang: r.lang as Lang,
    applicationId: (r.application_id as string | null) ?? null,
    baseCvId: (r.base_cv_id as string | null) ?? null,
    document: parse(r.document, emptyDocument(r.lang as Lang)),
    revision: Number(r.revision),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toApplication(r: Row): Application {
  return {
    id: String(r.id),
    company: String(r.company),
    role: String(r.role),
    location: String(r.location ?? ''),
    lang: r.lang as Lang,
    status: r.status as AppStatus,
    offerText: String(r.offer_text ?? ''),
    offerUrl: String(r.offer_url ?? ''),
    offerFileName: String(r.offer_file_name ?? ''),
    notes: String(r.notes ?? ''),
    cvId: (r.cv_id as string | null) ?? null,
    baseCvId: (r.base_cv_id as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    appliedAt: (r.applied_at as string | null) ?? null,
  };
}

function toSentFile(r: Row): SentFile {
  return {
    id: String(r.id),
    versionId: String(r.version_id),
    kind: r.kind as SentFile['kind'],
    filename: String(r.filename),
    sha256: String(r.sha256),
    size: Number(r.size),
    createdAt: String(r.created_at),
  };
}

export interface NewRecordInput {
  kind: RecordKind;
  lang: Lang;
  data: Record<string, unknown>;
  sources?: SourceRef[];
  fieldSources?: LibraryRecord['fieldSources'];
}

export interface NewApplicationInput {
  company: string;
  role: string;
  location?: string;
  lang: Lang;
  offerText?: string;
  offerUrl?: string;
  offerFileName?: string;
  notes?: string;
  baseCvId?: string | null;
}

export interface SentFileInput {
  kind: 'pdf' | 'docx';
  filename: string;
  data: Uint8Array;
}

export class Store {
  constructor(
    readonly db: Db,
    readonly files: FileStore,
  ) {}

  // ---------------------------------------------------------------- settings

  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[];
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      if (String(r.key) in DEFAULT_SETTINGS) s[String(r.key)] = parse(r.value, null);
    }
    return s as unknown as Settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    tx(this.db, () => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS)) throw new StoreError('invalid', `Unknown setting ${k}`);
        stmt.run(k, json(v));
      }
    });
    return this.getSettings();
  }

  // ----------------------------------------------------------------- sources

  addSource(input: Omit<SourceFile, 'id' | 'importedAt' | 'recordCount'> & { storedPath: string; id?: string }): SourceFile {
    const id = input.id ?? newId();
    this.db
      .prepare(
        `INSERT INTO sources (id, filename, format, sha256, size, stored_path, imported_at, status, method, extracted_text, warnings, converted_from_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.filename,
        input.format,
        input.sha256,
        input.size,
        input.storedPath,
        nowIso(),
        input.status,
        input.method,
        input.extractedText,
        json(input.warnings),
        input.convertedFromId,
      );
    return this.getSource(id)!;
  }

  getSource(id: string): SourceFile | null {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Row | undefined;
    return r ? toSource(r) : null;
  }

  sourceStoredPath(id: string): string | null {
    const r = this.db.prepare('SELECT stored_path FROM sources WHERE id = ?').get(id) as Row | undefined;
    return r ? String(r.stored_path) : null;
  }

  findSourceBySha(sha: string): SourceFile | null {
    const r = this.db.prepare('SELECT * FROM sources WHERE sha256 = ? ORDER BY imported_at LIMIT 1').get(sha) as Row | undefined;
    return r ? toSource(r) : null;
  }

  listSources(): SourceFile[] {
    return (this.db.prepare('SELECT * FROM sources ORDER BY imported_at DESC').all() as Row[]).map(toSource);
  }

  updateSource(id: string, patch: Partial<Pick<SourceFile, 'status' | 'method' | 'extractedText' | 'warnings' | 'recordCount'>>): SourceFile {
    const cur = this.getSource(id);
    if (!cur) throw new StoreError('not-found', 'Source not found');
    const next = { ...cur, ...patch };
    this.db
      .prepare('UPDATE sources SET status = ?, method = ?, extracted_text = ?, warnings = ?, record_count = ? WHERE id = ?')
      .run(next.status, next.method, next.extractedText, json(next.warnings), next.recordCount, id);
    return this.getSource(id)!;
  }

  /** Removes an original document. Library records keep their provenance label. */
  deleteSource(id: string): void {
    const path = this.sourceStoredPath(id);
    tx(this.db, () => {
      this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    });
    if (path) this.files.remove(path);
  }

  // ----------------------------------------------------------------- records

  listRecords(kind?: RecordKind): LibraryRecord[] {
    const rows = kind
      ? (this.db.prepare('SELECT * FROM records WHERE kind = ? ORDER BY updated_at DESC').all(kind) as Row[])
      : (this.db.prepare('SELECT * FROM records ORDER BY kind, updated_at DESC').all() as Row[]);
    return rows.map(toRecord);
  }

  getRecord(id: string): LibraryRecord | null {
    const r = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Row | undefined;
    return r ? toRecord(r) : null;
  }

  createRecord(input: NewRecordInput): LibraryRecord {
    const data = validateRecordData(input.kind, input.data);
    const id = newId();
    const now = nowIso();
    this.db
      .prepare('INSERT INTO records (id, kind, lang, data, sources, field_sources, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.kind, input.lang, json(data), json(input.sources ?? []), json(input.fieldSources ?? {}), now, now);
    return this.getRecord(id)!;
  }

  updateRecord(
    id: string,
    patch: { data?: Record<string, unknown>; lang?: Lang; addSources?: SourceRef[]; fieldSources?: LibraryRecord['fieldSources'] },
  ): LibraryRecord {
    const cur = this.getRecord(id);
    if (!cur) throw new StoreError('not-found', 'Record not found');
    const data = patch.data ? validateRecordData(cur.kind, { ...(cur.data as unknown as Record<string, unknown>), ...patch.data }) : cur.data;
    const sources = [...cur.sources];
    for (const s of patch.addSources ?? []) if (!sources.some((x) => x.sourceId === s.sourceId)) sources.push(s);
    const fieldSources = { ...cur.fieldSources, ...(patch.fieldSources ?? {}) };
    this.db
      .prepare('UPDATE records SET data = ?, lang = ?, sources = ?, field_sources = ?, updated_at = ? WHERE id = ?')
      .run(json(data), patch.lang ?? cur.lang, json(sources), json(fieldSources), nowIso(), id);
    return this.getRecord(id)!;
  }

  /** Deleting a library record never changes CVs: they hold their own copies. */
  deleteRecord(id: string): void {
    this.db.prepare('DELETE FROM records WHERE id = ?').run(id);
  }

  /**
   * Merges duplicate records after the user chose every differing value.
   * Sources are united; working drafts that referenced a removed record are
   * re-linked to the kept one (sent versions are never touched).
   */
  mergeRecords(keepId: string, removeIds: string[], data: Record<string, unknown>, fieldSources: LibraryRecord['fieldSources']): LibraryRecord {
    return tx(this.db, () => {
      const keep = this.getRecord(keepId);
      if (!keep) throw new StoreError('not-found', 'Record not found');
      const others = removeIds.filter((id) => id !== keepId).map((id) => this.getRecord(id));
      if (others.some((r) => !r || r.kind !== keep.kind)) throw new StoreError('invalid', 'Only records of the same kind can be merged.');
      const addSources = others.flatMap((r) => r!.sources);
      const merged = this.updateRecord(keepId, { data, addSources, fieldSources });
      for (const r of others) this.deleteRecord(r!.id);
      const rows = this.db.prepare('SELECT id, document FROM cvs').all() as Row[];
      for (const row of rows) {
        const text = String(row.document);
        if (!others.some((r) => text.includes(r!.id))) continue;
        const doc = parse<CvDocument>(text, null as unknown as CvDocument);
        for (const b of doc.blocks) for (const i of b.items) if (i.recordId && others.some((r) => r!.id === i.recordId)) i.recordId = keepId;
        this.db.prepare('UPDATE cvs SET document = ? WHERE id = ?').run(json(doc), String(row.id));
      }
      return merged;
    });
  }

  /** CVs whose content was copied from a record. */
  recordUsage(recordId: string): Array<{ cvId: string; name: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, name, document, updated_at FROM cvs WHERE document LIKE ?').all(`%${recordId}%`) as Row[];
    return rows
      .filter((r) => {
        const doc = parse<CvDocument | null>(r.document, null);
        return doc?.blocks.some((b) => b.items.some((i) => i.recordId === recordId)) ?? false;
      })
      .map((r) => ({ cvId: String(r.id), name: String(r.name), updatedAt: String(r.updated_at) }));
  }

  // --------------------------------------------------------------------- CVs

  listCvs(): CvSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM cv_versions v WHERE v.cv_id = c.id) AS version_count,
          (SELECT COUNT(*) FROM cv_versions v WHERE v.cv_id = c.id AND v.kind = 'sent') AS sent_count,
          (SELECT COUNT(*) FROM proposals p WHERE p.cv_id = c.id AND p.status IN ('pending','stale')) AS pending
         FROM cvs c ORDER BY c.updated_at DESC`,
      )
      .all() as Row[];
    return rows.map((r) => {
      const cv = toCv(r);
      const { document, ...rest } = cv;
      return {
        ...rest,
        headerName: document.header.fullName,
        headline: document.header.headline,
        versionCount: Number(r.version_count),
        sentCount: Number(r.sent_count),
        pendingProposals: Number(r.pending),
      };
    });
  }

  getCv(id: string): Cv | null {
    const r = this.db.prepare('SELECT * FROM cvs WHERE id = ?').get(id) as Row | undefined;
    return r ? toCv(r) : null;
  }

  private requireCv(id: string): Cv {
    const cv = this.getCv(id);
    if (!cv) throw new StoreError('not-found', 'CV not found');
    return cv;
  }

  createCv(input: { name: string; lang: Lang; document: CvDocument; description?: string; applicationId?: string | null; baseCvId?: string | null }): Cv {
    const doc = validateDocument(input.document);
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        'INSERT INTO cvs (id, name, description, lang, application_id, base_cv_id, document, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(id, input.name.trim() || 'Untitled CV', input.description ?? '', input.lang, input.applicationId ?? null, input.baseCvId ?? null, json(doc), now, now);
    return this.getCv(id)!;
  }

  /** Copies a CV's current draft into a new, independent CV. */
  duplicateCv(id: string, opts: { name?: string; applicationId?: string | null; description?: string } = {}): Cv {
    const src = this.requireCv(id);
    return this.createCv({
      name: opts.name ?? `${src.name} (copy)`,
      lang: src.lang,
      document: src.document,
      description: opts.description ?? src.description,
      applicationId: opts.applicationId ?? null,
      baseCvId: src.id,
    });
  }

  updateCvMeta(id: string, patch: { name?: string; description?: string; lang?: Lang }): Cv {
    const cv = this.requireCv(id);
    const name = patch.name !== undefined ? patch.name.trim() : cv.name;
    if (!name) throw new StoreError('invalid', 'A CV needs a name.');
    this.db
      .prepare('UPDATE cvs SET name = ?, description = ?, lang = ?, updated_at = ? WHERE id = ?')
      .run(name, patch.description ?? cv.description, patch.lang ?? cv.lang, nowIso(), id);
    return this.getCv(id)!;
  }

  /**
   * Autosave of the working draft. `expectedRevision` protects against
   * overwriting a newer save made elsewhere (e.g. a restore in another window).
   */
  saveCvDocument(id: string, document: CvDocument, expectedRevision: number): { revision: number; updatedAt: string } {
    const doc = validateDocument(document);
    return tx(this.db, () => {
      const cv = this.requireCv(id);
      if (cv.revision !== expectedRevision) {
        throw new StoreError('revision-conflict', 'This CV was changed elsewhere. Reload it to continue.');
      }
      const now = nowIso();
      const revision = cv.revision + 1;
      this.db.prepare('UPDATE cvs SET document = ?, revision = ?, lang = ?, updated_at = ? WHERE id = ?').run(json(doc), revision, doc.lang, now, id);
      return { revision, updatedAt: now };
    });
  }

  deleteCv(id: string): void {
    const cv = this.requireCv(id);
    const sent = this.db.prepare("SELECT COUNT(*) AS n FROM cv_versions WHERE cv_id = ? AND locked = 1").get(id) as Row;
    if (Number(sent.n) > 0) {
      throw new StoreError('has-sent', 'This CV has sent versions, which are kept permanently. It cannot be deleted.');
    }
    tx(this.db, () => {
      this.db.prepare('UPDATE applications SET cv_id = NULL WHERE cv_id = ?').run(id);
      this.db.prepare('DELETE FROM cvs WHERE id = ?').run(cv.id);
    });
  }

  // ---------------------------------------------------------------- versions

  listVersions(cvId: string): CvVersion[] {
    const rows = this.db.prepare('SELECT * FROM cv_versions WHERE cv_id = ? ORDER BY number DESC').all(cvId) as Row[];
    return rows.map((r) => this.toVersion(r));
  }

  getVersion(id: string): CvVersion | null {
    const r = this.db.prepare('SELECT * FROM cv_versions WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toVersion(r) : null;
  }

  private toVersion(r: Row): CvVersion {
    const files = (this.db.prepare('SELECT * FROM sent_files WHERE version_id = ? ORDER BY kind').all(String(r.id)) as Row[]).map(toSentFile);
    return {
      id: String(r.id),
      cvId: String(r.cv_id),
      number: Number(r.number),
      kind: r.kind as CvVersion['kind'],
      label: String(r.label),
      document: parse(r.document, emptyDocument('fr')),
      docHash: String(r.doc_hash),
      locked: Number(r.locked) === 1,
      applicationId: (r.application_id as string | null) ?? null,
      createdAt: String(r.created_at),
      files,
      sentContext: r.sent_context ? parse<SentContext | null>(r.sent_context, null) : null,
    };
  }

  private nextNumber(cvId: string): number {
    const nums = (this.db.prepare('SELECT number FROM cv_versions WHERE cv_id = ?').all(cvId) as Row[]).map((r) => Number(r.number));
    return nextVersionNumber(nums);
  }

  /** Saves a named snapshot of the current draft (editable history, not sent). */
  createCheckpoint(cvId: string, label?: string): CvVersion {
    return tx(this.db, () => {
      const cv = this.requireCv(cvId);
      const n = this.nextNumber(cvId);
      const id = newId();
      this.db
        .prepare('INSERT INTO cv_versions (id, cv_id, number, kind, label, document, doc_hash, locked, application_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
        .run(id, cvId, n, 'checkpoint', label?.trim() || versionLabel('checkpoint', n), json(cv.document), documentHash(cv.document), cv.applicationId, nowIso());
      return this.getVersion(id)!;
    });
  }

  renameVersion(id: string, label: string): CvVersion {
    const v = this.getVersion(id);
    if (!v) throw new StoreError('not-found', 'Version not found');
    assertMutable(v);
    this.db.prepare('UPDATE cv_versions SET label = ? WHERE id = ?').run(label.trim() || v.label, id);
    return this.getVersion(id)!;
  }

  deleteVersion(id: string): void {
    const v = this.getVersion(id);
    if (!v) return;
    assertMutable(v);
    this.db.prepare('DELETE FROM cv_versions WHERE id = ?').run(id);
  }

  /**
   * Mark as sent: freezes the exact document and the exact exported files.
   * `exportedDocHash` must match the current draft, proving the files were
   * exported from what is being recorded.
   */
  recordSent(cvId: string, applicationId: string, exportedDocHash: string, files: SentFileInput[]): CvVersion {
    if (files.length === 0) throw new StoreError('invalid', 'Export the files you sent first.');
    const cv = this.requireCv(cvId);
    const app = this.getApplication(applicationId);
    if (!app) throw new StoreError('not-found', 'Application not found');
    if (!canRecordSend(app.status)) {
      throw new StoreError('closed', `This application is ${STATUS_LABEL[app.status].toLowerCase()}. Reopen it before recording a new send.`);
    }
    if (documentHash(cv.document) !== exportedDocHash) {
      throw new StoreError('stale-export', 'The CV changed after these files were exported. Export again, then mark as sent.');
    }
    const versionId = newId();
    const sentContext: SentContext = { company: app.company, role: app.role, offerText: app.offerText, offerUrl: app.offerUrl, notes: app.notes };
    const written: string[] = [];
    try {
      const stored = files.map((f) => {
        const s = this.files.write('sent', versionId, f.filename, f.data, { readOnly: true });
        written.push(s.relPath);
        return { ...f, ...s };
      });
      return tx(this.db, () => {
        const n = this.nextNumber(cvId);
        const now = nowIso();
        this.db
          .prepare('INSERT INTO cv_versions (id, cv_id, number, kind, label, document, doc_hash, locked, application_id, created_at, sent_context) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
          .run(versionId, cvId, n, 'sent', versionLabel('sent', n), json(cv.document), exportedDocHash, applicationId, now, json(sentContext));
        const ins = this.db.prepare(
          'INSERT INTO sent_files (id, version_id, kind, filename, stored_path, sha256, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const f of stored) ins.run(newId(), versionId, f.kind, f.filename, f.relPath, f.sha256, f.size, now);
        const to = statusAfterSend(app.status);
        this.db
          .prepare('UPDATE applications SET status = ?, applied_at = COALESCE(applied_at, ?), cv_id = COALESCE(cv_id, ?), updated_at = ? WHERE id = ?')
          .run(to, now, cvId, now, applicationId);
        this.addEvent(applicationId, 'sent', `Marked as sent — ${versionLabel('sent', n)} (${stored.map((f) => f.kind.toUpperCase()).join(' + ')})`, {
          versionId,
          cvId,
        });
        if (to !== app.status) this.addEvent(applicationId, 'status', transitionMessage(app.status, to), { from: app.status, to });
        return this.getVersion(versionId)!;
      });
    } catch (e) {
      for (const p of written) {
        try {
          this.files.remove(p);
        } catch {
          // best effort cleanup of files that never made it into the database
        }
      }
      throw e;
    }
  }

  /** Reads a sent file, verifying it still matches its recorded checksum. */
  readSentFile(fileId: string): { file: SentFile; data: Buffer } {
    const r = this.db.prepare('SELECT * FROM sent_files WHERE id = ?').get(fileId) as Row | undefined;
    if (!r) throw new StoreError('not-found', 'File not found');
    return { file: toSentFile(r), data: this.files.readVerified(String(r.stored_path), String(r.sha256)) };
  }

  sentFilePath(fileId: string): string {
    const r = this.db.prepare('SELECT stored_path FROM sent_files WHERE id = ?').get(fileId) as Row | undefined;
    if (!r) throw new StoreError('not-found', 'File not found');
    return this.files.resolvePath(String(r.stored_path));
  }

  /**
   * Makes a previous version the working draft. The current draft is saved as
   * a checkpoint first; the old version itself is left untouched.
   */
  restoreVersionAsDraft(cvId: string, versionId: string): Cv {
    return tx(this.db, () => {
      const cv = this.requireCv(cvId);
      const v = this.getVersion(versionId);
      if (!v || v.cvId !== cvId) throw new StoreError('not-found', 'Version not found');
      this.createCheckpoint(cvId, `Before restoring ${v.label}`);
      this.db
        .prepare('UPDATE cvs SET document = ?, revision = ?, updated_at = ? WHERE id = ?')
        .run(json(v.document), cv.revision + 1, nowIso(), cvId);
      return this.getCv(cvId)!;
    });
  }

  // ------------------------------------------------------------ applications

  listApplications(): ApplicationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT a.*,
           (SELECT COUNT(*) FROM cv_versions v WHERE v.application_id = a.id AND v.kind = 'sent') AS sent_count,
           (SELECT MAX(v.created_at) FROM cv_versions v WHERE v.application_id = a.id AND v.kind = 'sent') AS last_sent_at,
           (SELECT COUNT(*) FROM proposals p WHERE p.cv_id = a.cv_id AND p.status IN ('pending','stale')) AS pending,
           (SELECT c.lang FROM cvs c WHERE c.id = a.cv_id) AS cv_lang
         FROM applications a ORDER BY a.updated_at DESC`,
      )
      .all() as Row[];
    return rows.map((r) => {
      const app = toApplication(r);
      const lastSentAt = (r.last_sent_at as string | null) ?? null;
      let lastSentFiles: Array<'pdf' | 'docx'> = [];
      if (lastSentAt) {
        const f = this.db
          .prepare(
            `SELECT DISTINCT f.kind FROM sent_files f JOIN cv_versions v ON v.id = f.version_id
             WHERE v.application_id = ? AND v.created_at = ? ORDER BY f.kind DESC`,
          )
          .all(app.id, lastSentAt) as Row[];
        lastSentFiles = f.map((x) => x.kind as 'pdf' | 'docx');
      }
      return {
        ...app,
        sentCount: Number(r.sent_count),
        lastSentAt,
        lastSentFiles,
        pendingProposals: Number(r.pending ?? 0),
        cvLang: (r.cv_lang as Lang | null) ?? null,
      };
    });
  }

  getApplication(id: string): Application | null {
    const r = this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row | undefined;
    return r ? toApplication(r) : null;
  }

  createApplication(input: NewApplicationInput): Application {
    const company = input.company.trim();
    const role = input.role.trim();
    if (!company && !role) throw new StoreError('invalid', 'Add at least a company or a role.');
    const id = newId();
    const now = nowIso();
    tx(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO applications (id, company, role, location, lang, status, offer_text, offer_url, offer_file_name, notes, cv_id, base_cv_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(id, company, role, input.location ?? '', input.lang, input.offerText ?? '', input.offerUrl ?? '', input.offerFileName ?? '', input.notes ?? '', input.baseCvId ?? null, now, now);
      this.addEvent(id, 'created', 'Application created', {});
    });
    return this.getApplication(id)!;
  }

  /** Creates the application's tailored draft by duplicating the base CV. */
  createApplicationDraft(applicationId: string, baseCvId: string): Cv {
    return tx(this.db, () => {
      const app = this.getApplication(applicationId);
      if (!app) throw new StoreError('not-found', 'Application not found');
      const base = this.requireCv(baseCvId);
      const cv = this.duplicateCv(baseCvId, {
        name: [app.role, app.company].filter(Boolean).join(' · ') || `${base.name} (application)`,
        applicationId,
        description: `Tailored from ${base.name}`,
      });
      this.db.prepare('UPDATE applications SET cv_id = ?, base_cv_id = ?, updated_at = ? WHERE id = ?').run(cv.id, baseCvId, nowIso(), applicationId);
      this.addEvent(applicationId, 'cv', `Draft created from “${base.name}”`, { cvId: cv.id, baseCvId });
      return cv;
    });
  }

  updateApplication(id: string, patch: Partial<Pick<Application, 'company' | 'role' | 'location' | 'lang' | 'offerText' | 'offerUrl' | 'notes' | 'cvId'>>): Application {
    const app = this.getApplication(id);
    if (!app) throw new StoreError('not-found', 'Application not found');
    const next = { ...app, ...patch };
    tx(this.db, () => {
      this.db
        .prepare('UPDATE applications SET company = ?, role = ?, location = ?, lang = ?, offer_text = ?, offer_url = ?, notes = ?, cv_id = ?, updated_at = ? WHERE id = ?')
        .run(next.company, next.role, next.location, next.lang, next.offerText, next.offerUrl, next.notes, next.cvId, nowIso(), id);
      if (patch.offerText !== undefined && patch.offerText !== app.offerText) this.addEvent(id, 'offer', 'Job offer text updated', {});
      if (patch.notes !== undefined && patch.notes !== app.notes) this.addEvent(id, 'note', 'Notes updated', {});
    });
    return this.getApplication(id)!;
  }

  setOfferFile(id: string, filename: string, data: Uint8Array): Application {
    const stored = this.files.write('offers', id, filename, data);
    this.db.prepare('UPDATE applications SET offer_file_name = ?, updated_at = ? WHERE id = ?').run(stored.relPath.split(/[\\/]/).pop()!, nowIso(), id);
    return this.getApplication(id)!;
  }

  setStatus(id: string, to: AppStatus): Application {
    return tx(this.db, () => {
      const app = this.getApplication(id);
      if (!app) throw new StoreError('not-found', 'Application not found');
      if (app.status === to) return app;
      if (!canTransition(app.status, to)) {
        throw new StoreError('invalid-transition', `An application cannot move from ${STATUS_LABEL[app.status]} to ${STATUS_LABEL[to]}.`);
      }
      const now = nowIso();
      this.db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?').run(to, now, id);
      this.addEvent(id, 'status', transitionMessage(app.status, to), { from: app.status, to });
      return this.getApplication(id)!;
    });
  }

  deleteApplication(id: string): void {
    const sent = this.db.prepare("SELECT COUNT(*) AS n FROM cv_versions WHERE application_id = ? AND kind = 'sent'").get(id) as Row;
    if (Number(sent.n) > 0) throw new StoreError('has-sent', 'This application has sent versions. Set it to Withdrawn instead.');
    tx(this.db, () => {
      this.db.prepare('DELETE FROM applications WHERE id = ?').run(id);
    });
    this.files.removeOwner('offers', id);
  }

  addEvent(applicationId: string, type: AppEventType, message: string, data: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO app_events (id, application_id, at, type, message, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), applicationId, nowIso(), type, message, json(data));
  }

  listEvents(applicationId: string): AppEvent[] {
    return (this.db.prepare('SELECT * FROM app_events WHERE application_id = ? ORDER BY at DESC, rowid DESC').all(applicationId) as Row[]).map((r) => ({
      id: String(r.id),
      applicationId: String(r.application_id),
      at: String(r.at),
      type: r.type as AppEventType,
      message: String(r.message),
      data: parse(r.data, {}),
    }));
  }

  // ---------------------------------------------------------------- proposals

  saveProposals(list: Proposal[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO proposals (id, cv_id, request_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
    );
    tx(this.db, () => {
      for (const p of list) stmt.run(p.id, p.cvId, p.requestId, p.status, json(p), p.createdAt, p.updatedAt);
    });
  }

  listProposals(cvId: string, statuses?: Proposal['status'][]): Proposal[] {
    const rows = this.db.prepare('SELECT data FROM proposals WHERE cv_id = ? ORDER BY created_at, rowid').all(cvId) as Row[];
    const all = rows.map((r) => parse<Proposal>(r.data, null as unknown as Proposal)).filter(Boolean);
    return statuses ? all.filter((p) => statuses.includes(p.status)) : all;
  }

  updateProposal(id: string, patch: Partial<Pick<Proposal, 'status' | 'confirmed' | 'proposedText'>>): Proposal {
    const r = this.db.prepare('SELECT data FROM proposals WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new StoreError('not-found', 'Suggestion not found');
    const p = { ...parse<Proposal>(r.data, null as unknown as Proposal), ...patch, updatedAt: nowIso() };
    this.saveProposals([p]);
    return p;
  }

  // ------------------------------------------------------------ conversation

  addMessage(m: ConversationMessage): void {
    this.db.prepare('INSERT INTO messages (id, cv_id, data, created_at) VALUES (?, ?, ?, ?)').run(m.id, m.cvId, json(m), m.createdAt);
  }

  updateMessage(m: ConversationMessage): void {
    this.db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(json(m), m.id);
  }

  listMessages(cvId: string): ConversationMessage[] {
    return (this.db.prepare('SELECT data FROM messages WHERE cv_id = ? ORDER BY created_at, rowid').all(cvId) as Row[]).map((r) =>
      parse<ConversationMessage>(r.data, null as unknown as ConversationMessage),
    );
  }

  // ------------------------------------------------------------ import batch

  saveImportBatch(id: string, data: unknown, status: 'pending' | 'done' | 'discarded' = 'pending'): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO import_batches (id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(id, status, json(data), now, now);
  }

  pendingImportBatch<T>(): { id: string; data: T } | null {
    const r = this.db.prepare("SELECT id, data FROM import_batches WHERE status = 'pending' ORDER BY updated_at DESC LIMIT 1").get() as Row | undefined;
    return r ? { id: String(r.id), data: parse<T>(r.data, null as unknown as T) } : null;
  }

  // ---------------------------------------------------------------- summary

  counts(): Record<string, number> {
    const n = (sql: string) => Number((this.db.prepare(sql).get() as Row).n);
    return {
      cvs: n('SELECT COUNT(*) AS n FROM cvs'),
      records: n('SELECT COUNT(*) AS n FROM records'),
      sources: n('SELECT COUNT(*) AS n FROM sources'),
      applications: n('SELECT COUNT(*) AS n FROM applications'),
      versions: n('SELECT COUNT(*) AS n FROM cv_versions'),
      sentFiles: n('SELECT COUNT(*) AS n FROM sent_files'),
    };
  }
}
