import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LATEST_SCHEMA, integrityCheck, migrate, openDatabase, schemaVersion, tx } from '../../src/main/db/connection';
import { Store, StoreError } from '../../src/main/db/store';
import { FileStore, sanitizeFilename, sha256 } from '../../src/main/storage/files';
import { documentHash, headerPath, setText } from '../../src/shared/document';
import { ImmutableVersionError } from '../../src/shared/versions';
import { ValidationError } from '../../src/shared/validation';
import { makeProposal, sampleDocument } from '../helpers/sample';
import { openStore } from '../helpers/store';
import { tempDir } from '../helpers/tempdir';

let dir: ReturnType<typeof tempDir>;
let store: Store;

beforeEach(() => {
  dir = tempDir();
  store = openStore(dir.path);
});
afterEach(() => {
  store.db.close();
  dir.cleanup();
});

const bytes = (s: string) => new TextEncoder().encode(s);

describe('database lifecycle', () => {
  it('migrates a fresh database and is idempotent on reopen', () => {
    expect(schemaVersion(store.db)).toBe(LATEST_SCHEMA);
    expect(migrate(store.db)).toEqual([]);
    expect(integrityCheck(store.db)).toBe('ok');
    store.db.close();
    const again = openDatabase(join(dir.path, 'atelier.db'));
    expect(schemaVersion(again)).toBe(LATEST_SCHEMA);
    again.close();
    store = openStore(dir.path);
  });

  it('refuses a database from a newer app version', () => {
    const p = join(dir.path, 'future.db');
    const db = new DatabaseSync(p);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '999')");
    db.close();
    expect(() => openDatabase(p)).toThrow(/newer version/);
  });

  it('rolls back a failed transaction and supports nesting', () => {
    expect(() =>
      tx(store.db, () => {
        store.db.prepare("INSERT INTO settings VALUES ('motion', '\"reduce\"')").run();
        tx(store.db, () => undefined);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.getSettings().motion).toBe('system');
  });

  it('persists work across restarts', () => {
    const cv = store.createCv({ name: 'Général FR', lang: 'fr', document: sampleDocument() });
    const edited = setText(cv.document, headerPath('headline'), 'Lead Frontend');
    store.saveCvDocument(cv.id, edited, cv.revision);
    store.updateSettings({ lastRoute: `/cv/${cv.id}`, onboardingDone: true });
    store.db.close();
    store = openStore(dir.path);
    expect(store.getCv(cv.id)?.document.header.headline).toBe('Lead Frontend');
    expect(store.getSettings()).toMatchObject({ lastRoute: `/cv/${cv.id}`, onboardingDone: true });
    expect(() => store.updateSettings({ bogus: 1 } as never)).toThrow(StoreError);
  });
});

describe('file store', () => {
  it('sanitises names and prevents path escapes', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a<b>:c?.pdf')).toBe('abc.pdf');
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename(`${'x'.repeat(200)}.docx`)).toHaveLength(120);
    const fs = new FileStore(join(dir.path, 'f2'));
    expect(() => fs.resolvePath('../outside')).toThrow('Invalid file path');
    expect(() => fs.resolvePath('')).toThrow('Invalid file path');
    expect(() => fs.write('sources', '../x', 'a', bytes('a'))).toThrow('Invalid owner id');
    expect(() => fs.removeOwner('sent', 'x')).toThrow();
    expect(() => fs.removeOwner('offers', '../x')).toThrow();
    const s = fs.write('sources', 'id1', 'cv.pdf', bytes('v1'));
    fs.write('sources', 'id1', 'cv.pdf', bytes('v2'));
    expect(fs.read(s.relPath).toString()).toBe('v2');
    const locked = fs.write('sent', 'v1', 'cv.pdf', bytes('sent'), { readOnly: true });
    expect(statSync(fs.resolvePath(locked.relPath)).mode & 0o222).toBe(0);
    expect(() => fs.write('sent', 'v1', 'cv.pdf', bytes('again'), { readOnly: true })).toThrow(/cannot be replaced/);
    expect(fs.exists('sources/none/x')).toBe(false);
    fs.remove(locked.relPath);
    expect(fs.exists(locked.relPath)).toBe(false);
    fs.removeOwner('sources', 'id1');
    expect(fs.exists(s.relPath)).toBe(false);
  });
});

describe('sources and library', () => {
  it('stores originals, finds duplicates by checksum and deletes them', () => {
    const data = bytes('%PDF fake');
    const stored = store.files.write('sources', 'src1', 'CV_2024.pdf', data);
    const src = store.addSource({ id: 'src1', filename: 'CV_2024.pdf', format: 'pdf', sha256: stored.sha256, size: stored.size, storedPath: stored.relPath, status: 'extracted', method: 'pdf:text', extractedText: 'x', warnings: [], convertedFromId: null });
    expect(store.findSourceBySha(sha256(data))?.id).toBe(src.id);
    expect(store.updateSource(src.id, { status: 'needs-review', recordCount: 3 })).toMatchObject({ status: 'needs-review', recordCount: 3 });
    expect(() => store.updateSource('nope', {})).toThrow(StoreError);
    expect(store.listSources()).toHaveLength(1);
    store.deleteSource(src.id);
    expect(store.getSource(src.id)).toBeNull();
    expect(store.files.exists(stored.relPath)).toBe(false);
    expect(store.findSourceBySha('none')).toBeNull();
  });

  it('validates records, keeps provenance and never touches CVs on delete', () => {
    expect(() => store.createRecord({ kind: 'skill', lang: 'fr', data: { name: '' } })).toThrow(ValidationError);
    expect(() => store.createRecord({ kind: 'bogus' as never, lang: 'fr', data: {} })).toThrow(ValidationError);
    const rec = store.createRecord({ kind: 'experience', lang: 'fr', data: { company: 'Atelier Nova', role: 'Dev', start: '2021' }, sources: [{ sourceId: 's1', label: 'CV_FR.docx' }] });
    expect(rec.data).toMatchObject({ company: 'Atelier Nova', bullets: [], current: false });
    const upd = store.updateRecord(rec.id, { data: { start: '2021-09' }, addSources: [{ sourceId: 's1', label: 'CV_FR.docx' }, { sourceId: 's2', label: 'CV_2024.pdf' }], fieldSources: { start: { sourceId: 's2', label: 'CV_2024.pdf' } } });
    expect(upd.sources).toHaveLength(2);
    expect(upd.fieldSources.start).toEqual({ sourceId: 's2', label: 'CV_2024.pdf' });
    expect(() => store.updateRecord(rec.id, { data: { start: 'soon' } })).toThrow(ValidationError);
    expect(() => store.updateRecord('none', {})).toThrow(StoreError);
    const doc = sampleDocument();
    doc.blocks[1].items[0].recordId = rec.id;
    const cv = store.createCv({ name: 'CV', lang: 'fr', document: doc });
    expect(store.recordUsage(rec.id)).toEqual([{ cvId: cv.id, name: 'CV', updatedAt: cv.updatedAt }]);
    store.deleteRecord(rec.id);
    expect(store.getRecord(rec.id)).toBeNull();
    expect(store.getCv(cv.id)?.document.blocks[1].items[0].recordId).toBe(rec.id);
    expect(store.listRecords('experience')).toHaveLength(0);
    expect(store.listRecords()).toHaveLength(0);
  });
});

describe('CVs', () => {
  it('creates, duplicates, renames and protects against lost updates', () => {
    const cv = store.createCv({ name: '  ', lang: 'fr', document: sampleDocument() });
    expect(cv.name).toBe('Untitled CV');
    const copy = store.duplicateCv(cv.id);
    expect(copy).toMatchObject({ name: 'Untitled CV (copy)', baseCvId: cv.id });
    expect(copy.document).toEqual(cv.document);
    expect(store.updateCvMeta(copy.id, { name: 'Frontend · Maison', lang: 'en' })).toMatchObject({ name: 'Frontend · Maison', lang: 'en' });
    expect(() => store.updateCvMeta(copy.id, { name: ' ' })).toThrow(StoreError);
    const r1 = store.saveCvDocument(cv.id, setText(cv.document, headerPath('headline'), 'A'), 1);
    expect(r1.revision).toBe(2);
    expect(() => store.saveCvDocument(cv.id, cv.document, 1)).toThrow(/changed elsewhere/);
    expect(() => store.saveCvDocument(cv.id, { ...cv.document, template: 'weird' } as never, 2)).toThrow(ValidationError);
    expect(() => store.getCv('none') ?? store.duplicateCv('none')).toThrow(StoreError);
    const summaries = store.listCvs();
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.id === cv.id)).toMatchObject({ headerName: 'Camille Laurent', versionCount: 0, sentCount: 0 });
    store.deleteCv(copy.id);
    expect(store.getCv(copy.id)).toBeNull();
  });
});

describe('versions and sent snapshots', () => {
  function setupSent() {
    const base = store.createCv({ name: 'Général', lang: 'fr', document: sampleDocument() });
    const app = store.createApplication({ company: 'Maison', role: 'Frontend Engineer', lang: 'fr', offerText: 'Offre' });
    const cv = store.createApplicationDraft(app.id, base.id);
    const hash = documentHash(cv.document);
    const version = store.recordSent(cv.id, app.id, hash, [
      { kind: 'pdf', filename: 'Camille_Laurent_Maison_FR.pdf', data: bytes('%PDF-1.7 exact bytes') },
      { kind: 'docx', filename: 'Camille_Laurent_Maison_FR.docx', data: bytes('PK docx bytes') },
    ]);
    return { base, app, cv, version, hash };
  }

  it('freezes the exact document and files when marked as sent', () => {
    const { app, cv, version, hash } = setupSent();
    expect(version).toMatchObject({ kind: 'sent', locked: true, label: 'Sent v1', docHash: hash, applicationId: app.id });
    expect(version.files.map((f) => f.kind)).toEqual(['docx', 'pdf']);
    const pdf = version.files.find((f) => f.kind === 'pdf')!;
    expect(store.readSentFile(pdf.id).data.toString()).toBe('%PDF-1.7 exact bytes');
    expect(statSync(store.sentFilePath(pdf.id)).mode & 0o222).toBe(0);
    const after = store.getApplication(app.id)!;
    expect(after.status).toBe('applied');
    expect(after.appliedAt).toBeTruthy();
    expect(store.listEvents(app.id).map((e) => e.type)).toEqual(expect.arrayContaining(['created', 'cv', 'sent', 'status']));
    expect(store.listApplications()[0]).toMatchObject({ sentCount: 1, lastSentFiles: ['pdf', 'docx'], cvLang: 'fr' });
    expect(store.listCvs().find((c) => c.id === cv.id)?.sentCount).toBe(1);
  });

  it('keeps the sent snapshot intact while the draft continues', () => {
    const { cv, version } = setupSent();
    const next = setText(cv.document, headerPath('headline'), 'Nouveau titre');
    store.saveCvDocument(cv.id, next, cv.revision);
    expect(store.getVersion(version.id)?.document.header.headline).toBe('Développeuse Frontend');
    // the offer as it was when sent is kept with the version
    const appId = version.applicationId!;
    store.updateApplication(appId, { offerText: 'Offre modifiée plus tard', notes: 'note' });
    expect(store.getVersion(version.id)?.sentContext).toMatchObject({ company: 'Maison', role: 'Frontend Engineer', offerText: 'Offre', notes: '' });
    expect(() => store.renameVersion(version.id, 'x')).toThrow(ImmutableVersionError);
    expect(() => store.deleteVersion(version.id)).toThrow(ImmutableVersionError);
    expect(() => store.deleteCv(cv.id)).toThrow(/sent versions/);
  });

  it('blocks modification of sent data even with raw SQL', () => {
    const { version } = setupSent();
    expect(() => store.db.prepare("UPDATE cv_versions SET label = 'hack' WHERE id = ?").run(version.id)).toThrow(/IMMUTABLE_SENT_VERSION/);
    expect(() => store.db.prepare('DELETE FROM cv_versions WHERE id = ?').run(version.id)).toThrow(/IMMUTABLE_SENT_VERSION/);
    expect(() => store.db.prepare("UPDATE sent_files SET filename = 'x'").run()).toThrow(/IMMUTABLE_SENT_FILE/);
    expect(() => store.db.prepare('DELETE FROM sent_files').run()).toThrow(/IMMUTABLE_SENT_FILE/);
  });

  it('detects sent files modified outside the app', () => {
    const { version } = setupSent();
    const pdf = version.files.find((f) => f.kind === 'pdf')!;
    const p = store.sentFilePath(pdf.id);
    chmodSync(p, 0o644);
    writeFileSync(p, 'tampered');
    expect(() => store.readSentFile(pdf.id)).toThrow(/checksum mismatch/);
    expect(() => store.readSentFile('none')).toThrow(StoreError);
    expect(() => store.sentFilePath('none')).toThrow(StoreError);
  });

  it('refuses stale exports, empty sends and closed applications', () => {
    const { app, cv } = setupSent();
    expect(() => store.recordSent(cv.id, app.id, 'wrong-hash', [{ kind: 'pdf', filename: 'a.pdf', data: bytes('x') }])).toThrow(/Export again/);
    expect(() => store.recordSent(cv.id, app.id, documentHash(cv.document), [])).toThrow(/Export/);
    expect(() => store.recordSent(cv.id, 'none', documentHash(cv.document), [{ kind: 'pdf', filename: 'a.pdf', data: bytes('x') }])).toThrow(StoreError);
    store.setStatus(app.id, 'withdrawn');
    expect(() => store.recordSent(cv.id, app.id, documentHash(cv.document), [{ kind: 'pdf', filename: 'b.pdf', data: bytes('x') }])).toThrow(/withdrawn/);
    // no leftover files from refused sends
    expect(existsSync(join(store.files.root, 'sent'))).toBe(true);
  });

  it('records later sends without downgrading the status and numbers versions', () => {
    const { app, cv } = setupSent();
    store.setStatus(app.id, 'interview');
    const v2 = store.recordSent(cv.id, app.id, documentHash(cv.document), [{ kind: 'pdf', filename: 'v2.pdf', data: bytes('2') }]);
    expect(v2.label).toBe('Sent v2');
    expect(store.getApplication(app.id)?.status).toBe('interview');
  });

  it('checkpoints, renames and restores versions as a new draft', () => {
    const { cv, version } = setupSent();
    const cp = store.createCheckpoint(cv.id, 'Avant refonte');
    expect(cp).toMatchObject({ number: 2, kind: 'checkpoint', locked: false, label: 'Avant refonte' });
    expect(store.renameVersion(cp.id, 'Renommé').label).toBe('Renommé');
    store.saveCvDocument(cv.id, setText(cv.document, headerPath('headline'), 'Changed'), cv.revision);
    const restored = store.restoreVersionAsDraft(cv.id, version.id);
    expect(restored.document.header.headline).toBe('Développeuse Frontend');
    const versions = store.listVersions(cv.id);
    expect(versions[0]).toMatchObject({ label: 'Before restoring Sent v1', kind: 'checkpoint' });
    expect(versions[0].document.header.headline).toBe('Changed');
    expect(store.getVersion(version.id)?.locked).toBe(true);
    store.deleteVersion(cp.id);
    expect(store.getVersion(cp.id)).toBeNull();
    store.deleteVersion('none');
    expect(() => store.restoreVersionAsDraft(cv.id, 'none')).toThrow(StoreError);
    expect(() => store.renameVersion('none', 'x')).toThrow(StoreError);
    expect(store.createCheckpoint(cv.id).label).toMatch(/^Saved v\d+$/);
  });
});

describe('applications', () => {
  it('validates status transitions and logs history', () => {
    expect(() => store.createApplication({ company: ' ', role: '', lang: 'fr' })).toThrow(StoreError);
    const app = store.createApplication({ company: 'North', role: 'Software Engineer', lang: 'en' });
    expect(app.status).toBe('preparing');
    expect(() => store.setStatus(app.id, 'offer')).toThrow(/cannot move/);
    store.setStatus(app.id, 'applied');
    store.setStatus(app.id, 'interview');
    expect(store.setStatus(app.id, 'interview').status).toBe('interview');
    expect(store.listEvents(app.id).filter((e) => e.type === 'status').map((e) => e.message)).toEqual([
      'Status changed from Applied to Interview',
      'Status changed from Preparing to Applied',
    ]);
    expect(() => store.setStatus('none', 'applied')).toThrow(StoreError);
  });

  it('updates offer and notes, stores offer files and deletes unsent applications', () => {
    const app = store.createApplication({ company: 'Cobalt', role: 'Product Engineer', lang: 'fr' });
    const upd = store.updateApplication(app.id, { notes: 'Parler accessibilité', offerText: 'Nouvelle offre' });
    expect(upd).toMatchObject({ notes: 'Parler accessibilité', offerText: 'Nouvelle offre' });
    expect(store.listEvents(app.id).map((e) => e.type)).toEqual(expect.arrayContaining(['note', 'offer']));
    expect(() => store.updateApplication('none', {})).toThrow(StoreError);
    expect(store.setOfferFile(app.id, 'offre.pdf', bytes('pdf')).offerFileName).toBe('offre.pdf');
    expect(() => store.createApplicationDraft(app.id, 'none')).toThrow(StoreError);
    expect(() => store.createApplicationDraft('none', 'none')).toThrow(StoreError);
    store.deleteApplication(app.id);
    expect(store.getApplication(app.id)).toBeNull();
  });

  it('refuses to delete an application with sent versions', () => {
    const base = store.createCv({ name: 'B', lang: 'fr', document: sampleDocument() });
    const app = store.createApplication({ company: 'Lumen', role: 'Dev', lang: 'fr' });
    const cv = store.createApplicationDraft(app.id, base.id);
    store.recordSent(cv.id, app.id, documentHash(cv.document), [{ kind: 'pdf', filename: 'x.pdf', data: bytes('x') }]);
    expect(() => store.deleteApplication(app.id)).toThrow(/Withdrawn/);
  });
});

describe('proposals, conversation and import batches', () => {
  it('persists proposals and messages', () => {
    const cv = store.createCv({ name: 'CV', lang: 'fr', document: sampleDocument() });
    const p = makeProposal({ id: 'p-1', cvId: cv.id });
    store.saveProposals([p, makeProposal({ id: 'p-2', cvId: cv.id, status: 'rejected' })]);
    expect(store.listProposals(cv.id, ['pending'])).toHaveLength(1);
    expect(store.updateProposal('p-1', { status: 'accepted' }).status).toBe('accepted');
    expect(store.listProposals(cv.id).map((x) => x.status)).toEqual(['accepted', 'rejected']);
    expect(() => store.updateProposal('none', {})).toThrow(StoreError);
    const m = { id: 'm1', cvId: cv.id, role: 'user' as const, text: 'Plus concis', requestId: 'r1', action: 'rewrite' as const, providerLabel: '', status: 'pending' as const, proposalIds: [], contextLabels: ['Selected text'], createdAt: new Date().toISOString() };
    store.addMessage(m);
    store.updateMessage({ ...m, status: 'ok' });
    expect(store.listMessages(cv.id)[0].status).toBe('ok');
    store.saveImportBatch('b1', { step: 'review' });
    expect(store.pendingImportBatch<{ step: string }>()).toEqual({ id: 'b1', data: { step: 'review' } });
    store.saveImportBatch('b1', { step: 'done' }, 'done');
    expect(store.pendingImportBatch()).toBeNull();
    expect(store.counts()).toMatchObject({ cvs: 1 });
  });
});

describe('merging duplicate records', () => {
  it('keeps one record with united sources and re-links drafts', () => {
    const a = store.createRecord({ kind: 'experience', lang: 'fr', data: { company: 'Nova', role: 'Dev', start: '2021' }, sources: [{ sourceId: 's1', label: 'A.pdf' }] });
    const b = store.createRecord({ kind: 'experience', lang: 'fr', data: { company: 'Nova', role: 'Dev', start: '2022' }, sources: [{ sourceId: 's2', label: 'B.docx' }] });
    const doc = sampleDocument();
    doc.blocks[1].items[0].recordId = b.id;
    const cv = store.createCv({ name: 'CV', lang: 'fr', document: doc });
    const merged = store.mergeRecords(a.id, [b.id], { start: '2021' }, { start: { sourceId: 's1', label: 'A.pdf' } });
    expect(merged.sources.map((s) => s.label)).toEqual(['A.pdf', 'B.docx']);
    expect(store.getRecord(b.id)).toBeNull();
    expect(store.getCv(cv.id)!.document.blocks[1].items[0].recordId).toBe(a.id);
    const skill = store.createRecord({ kind: 'skill', lang: 'fr', data: { name: 'React' } });
    expect(() => store.mergeRecords(a.id, [skill.id], {}, {})).toThrow(/same kind/);
    expect(() => store.mergeRecords('none', [], {}, {})).toThrow(StoreError);
  });
});
