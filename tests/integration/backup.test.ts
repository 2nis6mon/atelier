import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Store } from '../../src/main/db/store';
import {
  BACKUP_TABLES,
  buildDataDirFromBackup,
  createBackup,
  inspectBackup,
  mergeBackup,
  swapDataDir,
  writeBackupFile,
} from '../../src/main/storage/backup';
import { documentHash, headerPath, setText } from '../../src/shared/document';
import { sampleDocument } from '../helpers/sample';
import { openStore } from '../helpers/store';
import { tempDir } from '../helpers/tempdir';

let dir: ReturnType<typeof tempDir>;
let store: Store;
const bytes = (s: string) => new TextEncoder().encode(s);

function populate(s: Store) {
  const src = s.files.write('sources', 'src-1', 'CV_FR.docx', bytes('original docx bytes'));
  s.addSource({ id: 'src-1', filename: 'CV_FR.docx', format: 'docx', sha256: src.sha256, size: src.size, storedPath: src.relPath, status: 'extracted', method: 'docx', extractedText: 'Camille', warnings: [], convertedFromId: null });
  const rec = s.createRecord({ kind: 'experience', lang: 'fr', data: { company: 'Atelier Nova', role: 'Dev', start: '2021' }, sources: [{ sourceId: 'src-1', label: 'CV_FR.docx' }] });
  const base = s.createCv({ name: 'Général', lang: 'fr', document: sampleDocument() });
  const app = s.createApplication({ company: 'Maison', role: 'Frontend Engineer', lang: 'fr', offerText: 'Offre Maison' });
  const cv = s.createApplicationDraft(app.id, base.id);
  const sent = s.recordSent(cv.id, app.id, documentHash(cv.document), [{ kind: 'pdf', filename: 'Maison.pdf', data: bytes('%PDF sent') }]);
  s.createCheckpoint(base.id, 'Checkpoint');
  s.updateSettings({ onboardingDone: true });
  return { rec, base, app, cv, sent };
}

beforeEach(() => {
  dir = tempDir();
  store = openStore(join(dir.path, 'data'));
});
afterEach(() => {
  try {
    store.db.close();
  } catch {
    // already closed
  }
  dir.cleanup();
});

describe('backup creation and validation', () => {
  it('exports everything with checksums and verifies the written file', () => {
    populate(store);
    const dest = join(dir.path, 'out', 'atelier.atelierbackup');
    const check = writeBackupFile(store.db, store.files, dest, '1.0.0');
    expect(check.ok).toBe(true);
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(`${dest}.partial`)).toBe(false);
    expect(check.counts).toMatchObject({ cvs: 2, records: 1, sources: 1, applications: 1, sent_files: 1, cv_versions: 2 });
    expect(check.manifest?.files.map((f) => f.path).sort()).toEqual(expect.arrayContaining(['sources/src-1/CV_FR.docx']));
    const entries = unzipSync(readFileSync(dest));
    const data = strFromU8(entries['data.json']);
    expect(data).not.toMatch(/api[_-]?key|refresh_token|sk-/i);
  });

  it('reports damaged, foreign and incomplete backups', () => {
    populate(store);
    const good = createBackup(store.db, store.files, '1.0.0');
    const entries = unzipSync(good);
    expect(inspectBackup(bytes('not a zip')).errors[0]).toMatch(/not an Atelier backup/);
    expect(inspectBackup(zipSync({ 'x.txt': bytes('x') })).errors[0]).toMatch(/incomplete/);
    const tampered = { ...entries, 'data.json': strToU8(strFromU8(entries['data.json']).replace('Maison', 'Hacked')) };
    expect(inspectBackup(zipSync(tampered)).errors).toContain('The backup data is damaged (checksum mismatch).');
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    const future = { ...entries, 'manifest.json': strToU8(JSON.stringify({ ...manifest, schemaVersion: 99 })) };
    expect(inspectBackup(zipSync(future)).errors.join()).toMatch(/newer version/);
    const foreign = { ...entries, 'manifest.json': strToU8(JSON.stringify({ ...manifest, format: 'other' })) };
    expect(inspectBackup(zipSync(foreign)).ok).toBe(false);
    const missingFile = { ...entries };
    delete missingFile['files/sources/src-1/CV_FR.docx'];
    expect(inspectBackup(zipSync(missingFile)).errors.join()).toMatch(/Missing file in backup/);
    const badFile = { ...entries, 'files/sources/src-1/CV_FR.docx': bytes('changed') };
    expect(inspectBackup(zipSync(badFile)).errors.join()).toMatch(/Damaged file/);
    const garbage = { ...entries, 'manifest.json': bytes('{nope') };
    expect(inspectBackup(zipSync(garbage)).errors[0]).toMatch(/not readable/);
    const evilPath = { ...entries, 'manifest.json': strToU8(JSON.stringify({ ...manifest, files: [...manifest.files, { path: '../evil', sha256: 'x', size: 1 }] })) };
    expect(inspectBackup(zipSync(evilPath)).errors.join()).toMatch(/Unexpected file path/);
  });

  it('detects broken relations and invalid documents', () => {
    populate(store);
    const entries = unzipSync(createBackup(store.db, store.files, '1.0.0'));
    const data = JSON.parse(strFromU8(entries['data.json']));
    data.tables.cvs = [{ ...data.tables.cvs[0], document: '{"schema":2}' }];
    data.tables.sources = [{ ...data.tables.sources[0], stored_path: 'sources/zzz/none' }];
    data.tables.sent_files.push({ id: 'x', version_id: 'missing', filename: 'f', stored_path: 'sent/x/f' });
    delete data.tables.messages;
    data.tables.records.push({ nope: true });
    const raw = strToU8(JSON.stringify(data));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const rebuilt = zipSync({ ...entries, 'data.json': raw, 'manifest.json': strToU8(JSON.stringify({ ...manifest, dataSha256: sha256(raw) })) });
    const errors = inspectBackup(rebuilt).errors.join('\n');
    expect(errors).toMatch(/is invalid/);
    expect(errors).toMatch(/refers to a missing CV/);
    expect(errors).toMatch(/refers to a missing version/);
    expect(errors).toMatch(/Original document CV_FR.docx is missing/);
    expect(errors).toMatch(/no messages table/);
    expect(errors).toMatch(/Some records rows are malformed/);
    expect(() => buildDataDirFromBackup(rebuilt, join(dir.path, 'never'))).toThrow(/Restore refused/);
  });
});

describe('restore — replace mode', () => {
  it('rebuilds an identical data directory and swaps it safely', () => {
    const { sent, cv, app, rec } = populate(store);
    const backup = createBackup(store.db, store.files, '1.0.0');
    store.saveCvDocument(cv.id, setText(cv.document, headerPath('headline'), 'Modifié après la sauvegarde'), store.getCv(cv.id)!.revision);
    store.db.close();

    const next = join(dir.path, 'data.restoring');
    const counts = buildDataDirFromBackup(backup, next);
    expect(counts).toMatchObject({ cvs: 2, sent_files: 1 });
    expect(() => buildDataDirFromBackup(backup, next)).toThrow(/must be empty/);
    const safety = swapDataDir(join(dir.path, 'data'), next, 'test');
    expect(safety.endsWith('.before-restore-test')).toBe(true);
    expect(existsSync(join(safety, 'atelier.db'))).toBe(true);

    store = openStore(join(dir.path, 'data'));
    expect(store.getCv(cv.id)?.document.header.headline).toBe('Développeuse Frontend');
    expect(store.getApplication(app.id)?.status).toBe('applied');
    expect(store.getRecord(rec.id)?.sources).toEqual([{ sourceId: 'src-1', label: 'CV_FR.docx' }]);
    const v = store.getVersion(sent.id)!;
    expect(v.locked).toBe(true);
    expect(store.readSentFile(v.files[0].id).data.toString()).toBe('%PDF sent');
    expect(statSync(store.sentFilePath(v.files[0].id)).mode & 0o222).toBe(0);
    expect(() => store.db.prepare('DELETE FROM cv_versions WHERE id = ?').run(sent.id)).toThrow(/IMMUTABLE/);
    expect(store.files.read('sources/src-1/CV_FR.docx').toString()).toBe('original docx bytes');
    expect(store.getSettings().onboardingDone).toBe(true);
  });

  it('puts the original directory back if the swap fails', () => {
    expect(() => swapDataDir(join(dir.path, 'data'), join(dir.path, 'does-not-exist'), 'x')).toThrow();
    expect(existsSync(join(dir.path, 'data', 'atelier.db'))).toBe(true);
  });
});

describe('restore — merge mode', () => {
  it('adds missing data and never overwrites silently', () => {
    const { cv, sent } = populate(store);
    const backup = createBackup(store.db, store.files, '1.0.0');
    // Local changes after the backup:
    store.saveCvDocument(cv.id, setText(cv.document, headerPath('headline'), 'Local version'), store.getCv(cv.id)!.revision);
    const other = openStore(join(dir.path, 'other'));
    const inspection0 = inspectBackup(backup, other.db);
    expect(inspection0.collisions).toEqual([]);
    const r0 = mergeBackup(backup, other.db, other.files);
    expect(r0.added).toBeGreaterThan(5);
    expect(other.readSentFile(other.getVersion(sent.id)!.files[0].id).data.toString()).toBe('%PDF sent');
    other.db.close();

    const inspection = inspectBackup(backup, store.db);
    const cvCollision = inspection.collisions.find((c) => c.table === 'cvs' && c.key === cv.id)!;
    expect(cvCollision).toMatchObject({ locked: false });
    expect(inspection.identical).toBeGreaterThan(0);
    const kept = mergeBackup(backup, store.db, store.files);
    expect(kept.replaced).toBe(0);
    expect(store.getCv(cv.id)?.document.header.headline).toBe('Local version');

    const replaced = mergeBackup(backup, store.db, store.files, { [`cvs:${cv.id}`]: 'use-backup' });
    expect(replaced.replaced).toBe(1);
    expect(store.getCv(cv.id)?.document.header.headline).toBe('Développeuse Frontend');
  });

  it('refuses invalid backups and never replaces sent versions', () => {
    populate(store);
    expect(() => mergeBackup(bytes('junk'), store.db, store.files)).toThrow(/Restore refused/);
    const backup = createBackup(store.db, store.files, '1.0.0');
    const entries = unzipSync(backup);
    const data = JSON.parse(strFromU8(entries['data.json']));
    const sentRow = data.tables.cv_versions.find((v: { locked: number }) => v.locked === 1);
    sentRow.label = 'Rewritten history';
    const raw = strToU8(JSON.stringify(data));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    const hash = createHash('sha256').update(raw).digest('hex');
    const altered = zipSync({ ...entries, 'data.json': raw, 'manifest.json': strToU8(JSON.stringify({ ...manifest, dataSha256: hash })) });
    const insp = inspectBackup(altered, store.db);
    expect(insp.collisions.find((c) => c.table === 'cv_versions')?.locked).toBe(true);
    const res = mergeBackup(altered, store.db, store.files, { [`cv_versions:${sentRow.id}`]: 'use-backup' });
    expect(res.replaced).toBe(0);
    expect(store.getVersion(sentRow.id)?.label).toBe('Sent v1');
    expect(BACKUP_TABLES).not.toContain('import_batches');
  });
});
