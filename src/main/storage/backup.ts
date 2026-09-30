// Backups: a single .atelierbackup file (zip) with a manifest, all database
// rows (as JSON) and every stored file, each protected by a SHA-256 checksum.
// Secrets are never part of the database, so they are never in backups.
//
// Restore is always inspected first (validation + collisions). Two modes:
//  - replace: builds a brand-new data directory from the backup; the caller
//    swaps it in and keeps the previous directory as a safety copy.
//  - merge: adds what is missing; rows that exist with different content are
//    only overwritten when the user explicitly chose "use backup" for them.
//    Sent versions and their files are never overwritten.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { validateDocument } from '../../shared/validation';
import { LATEST_SCHEMA, openDatabase, schemaVersion, tx, type Db } from '../db/connection';
import { FileStore, sha256 } from './files';

export const BACKUP_FORMAT = 'atelier-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = 'atelierbackup';

/** Tables in dependency order. */
export const BACKUP_TABLES = [
  'settings',
  'sources',
  'records',
  'applications',
  'cvs',
  'cv_versions',
  'sent_files',
  'app_events',
  'proposals',
  'messages',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

const KEY: Record<BackupTable, string> = {
  settings: 'key',
  sources: 'id',
  records: 'id',
  applications: 'id',
  cvs: 'id',
  cv_versions: 'id',
  sent_files: 'id',
  app_events: 'id',
  proposals: 'id',
  messages: 'id',
};

const LABELS: Record<BackupTable, string> = {
  settings: 'Setting',
  sources: 'Original document',
  records: 'Library record',
  applications: 'Application',
  cvs: 'CV',
  cv_versions: 'Version',
  sent_files: 'Sent file',
  app_events: 'History entry',
  proposals: 'Suggestion',
  messages: 'Assistant message',
};

type Row = Record<string, unknown>;

export interface BackupManifest {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  counts: Record<string, number>;
  dataSha256: string;
  files: Array<{ path: string; sha256: string; size: number }>;
}

export interface Collision {
  table: BackupTable;
  key: string;
  label: string;
  /** Sent versions/files can never be replaced. */
  locked: boolean;
}

export interface BackupInspection {
  ok: boolean;
  errors: string[];
  manifest: BackupManifest | null;
  counts: Record<string, number>;
  newRows: Record<string, number>;
  identical: number;
  collisions: Collision[];
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && !name.includes('.tmp-')) out.push(p);
    }
  };
  for (const area of ['sources', 'sent', 'offers']) walk(join(root, area));
  return out;
}

function rowLabel(table: BackupTable, row: Row): string {
  const name = row.name ?? row.filename ?? row.company ?? row.label ?? row.key ?? row.id;
  return `${LABELS[table]}: ${String(name).slice(0, 60)}`;
}

/** Serialises the whole data set into backup bytes. */
export function createBackup(db: Db, files: FileStore, appVersion: string, createdAt = new Date().toISOString()): Uint8Array {
  const tables: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all() as Row[];
    counts[t] = tables[t].length;
  }
  const data = strToU8(JSON.stringify({ tables }));
  const zip: Zippable = {};
  const manifestFiles: BackupManifest['files'] = [];
  for (const abs of walkFiles(files.root)) {
    const rel = relative(files.root, abs).split('\\').join('/');
    const bytes = readFileSync(abs);
    manifestFiles.push({ path: rel, sha256: sha256(bytes), size: bytes.byteLength });
    zip[`files/${rel}`] = [new Uint8Array(bytes), { level: 0 }];
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: schemaVersion(db),
    appVersion,
    createdAt,
    counts,
    dataSha256: sha256(data),
    files: manifestFiles,
  };
  zip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  zip['data.json'] = [data, { level: 6 }];
  return zipSync(zip);
}

/** Writes a backup atomically and re-reads it to prove it is restorable. */
export function writeBackupFile(db: Db, files: FileStore, destPath: string, appVersion: string): BackupInspection {
  const bytes = createBackup(db, files, appVersion);
  const tmp = `${destPath}.partial`;
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(tmp, bytes);
  const check = inspectBackup(readFileSync(tmp));
  if (!check.ok) throw new Error(`Backup verification failed: ${check.errors.join('; ')}`);
  renameSync(tmp, destPath);
  return check;
}

interface Parsed {
  manifest: BackupManifest;
  tables: Record<BackupTable, Row[]>;
  files: Map<string, Uint8Array>;
}

function parseBackup(bytes: Uint8Array, errors: string[]): Parsed | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    errors.push('This file is not an Atelier backup (it could not be opened).');
    return null;
  }
  const mRaw = entries['manifest.json'];
  const dRaw = entries['data.json'];
  if (!mRaw || !dRaw) {
    errors.push('The backup is incomplete (manifest or data missing).');
    return null;
  }
  let manifest: BackupManifest;
  let data: { tables: Record<string, Row[]> };
  try {
    manifest = JSON.parse(strFromU8(mRaw)) as BackupManifest;
    data = JSON.parse(strFromU8(dRaw)) as { tables: Record<string, Row[]> };
  } catch {
    errors.push('The backup data is not readable.');
    return null;
  }
  if (manifest.format !== BACKUP_FORMAT) errors.push('This file is not an Atelier backup.');
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION || manifest.schemaVersion > LATEST_SCHEMA) {
    errors.push('This backup was made by a newer version of Atelier. Update the app to restore it.');
  }
  if (sha256(dRaw) !== manifest.dataSha256) errors.push('The backup data is damaged (checksum mismatch).');
  const files = new Map<string, Uint8Array>();
  for (const f of manifest.files ?? []) {
    if (!/^(sources|sent|offers)\/[\w-]+\/[^/]+$/.test(f.path)) {
      errors.push(`Unexpected file path in backup: ${f.path}`);
      continue;
    }
    const content = entries[`files/${f.path}`];
    if (!content) errors.push(`Missing file in backup: ${f.path}`);
    else if (sha256(content) !== f.sha256) errors.push(`Damaged file in backup: ${f.path}`);
    else files.set(f.path, content);
  }
  const tables = {} as Record<BackupTable, Row[]>;
  for (const t of BACKUP_TABLES) {
    const rows = data.tables?.[t];
    if (!Array.isArray(rows)) {
      errors.push(`The backup has no ${t} table.`);
      tables[t] = [];
    } else tables[t] = rows.filter((r) => r && typeof r === 'object' && typeof r[KEY[t]] === 'string');
    if (Array.isArray(rows) && tables[t].length !== rows.length) errors.push(`Some ${t} rows are malformed.`);
  }
  return { manifest, tables, files };
}

function validateRelations(p: Parsed, errors: string[]): void {
  const ids = (t: BackupTable) => new Set(p.tables[t].map((r) => String(r.id)));
  const cvIds = ids('cvs');
  const versionIds = ids('cv_versions');
  for (const cv of p.tables.cvs) {
    try {
      validateDocument(JSON.parse(String(cv.document)));
    } catch (e) {
      errors.push(`CV “${String(cv.name)}” is invalid: ${(e as Error).message}`);
    }
  }
  for (const v of p.tables.cv_versions) {
    if (!cvIds.has(String(v.cv_id))) errors.push(`Version ${String(v.label)} refers to a missing CV.`);
  }
  for (const f of p.tables.sent_files) {
    if (!versionIds.has(String(f.version_id))) errors.push(`Sent file ${String(f.filename)} refers to a missing version.`);
    if (!p.files.has(String(f.stored_path))) errors.push(`Sent file ${String(f.filename)} is missing from the backup.`);
  }
  for (const s of p.tables.sources) {
    if (!p.files.has(String(s.stored_path))) errors.push(`Original document ${String(s.filename)} is missing from the backup.`);
  }
}

function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

/** Validates a backup and, when `db` is given, compares it with the current data. */
export function inspectBackup(bytes: Uint8Array, db?: Db): BackupInspection {
  const errors: string[] = [];
  const parsed = parseBackup(bytes, errors);
  const result: BackupInspection = { ok: false, errors, manifest: parsed?.manifest ?? null, counts: {}, newRows: {}, identical: 0, collisions: [] };
  if (!parsed) return result;
  validateRelations(parsed, errors);
  for (const t of BACKUP_TABLES) result.counts[t] = parsed.tables[t].length;
  if (db) {
    for (const t of BACKUP_TABLES) {
      const key = KEY[t];
      const stmt = db.prepare(`SELECT * FROM ${t} WHERE ${key} = ?`);
      let fresh = 0;
      for (const row of parsed.tables[t]) {
        const cur = stmt.get(String(row[key])) as Row | undefined;
        if (!cur) fresh++;
        else if (sameRow(cur, row)) result.identical++;
        else {
          const locked = t === 'sent_files' || (t === 'cv_versions' && Number(cur.locked) === 1);
          result.collisions.push({ table: t, key: String(row[key]), label: rowLabel(t, row), locked });
        }
      }
      result.newRows[t] = fresh;
    }
  }
  result.ok = errors.length === 0;
  return result;
}

function tableColumns(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name));
}

function insertRow(db: Db, table: BackupTable, row: Row, columns: string[], mode: 'insert' | 'replace'): void {
  const cols = columns.filter((c) => c in row);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map((c) => row[c] as string | number | null);
  if (mode === 'insert') {
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
  } else {
    const key = KEY[table];
    const sets = cols.filter((c) => c !== key).map((c) => `${c} = ?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${sets} WHERE ${key} = ?`).run(...cols.filter((c) => c !== key).map((c) => row[c] as string | number | null), String(row[key]));
  }
}

/**
 * Replace mode, step 1: builds a complete new data directory from a backup.
 * The caller swaps it with the current directory (see swapDataDir).
 */
export function buildDataDirFromBackup(bytes: Uint8Array, targetDir: string): Record<string, number> {
  const errors: string[] = [];
  const parsed = parseBackup(bytes, errors);
  if (parsed) validateRelations(parsed, errors);
  if (!parsed || errors.length) throw new Error(`Restore refused: ${errors.join('; ')}`);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) throw new Error('Restore target must be empty.');
  mkdirSync(targetDir, { recursive: true });
  const files = new FileStore(join(targetDir, 'files'));
  for (const [path, content] of parsed.files) {
    const [area, owner, name] = path.split('/');
    files.write(area as 'sources' | 'sent' | 'offers', owner, name, content, { readOnly: area === 'sent' });
  }
  const db = openDatabase(join(targetDir, 'atelier.db'));
  try {
    tx(db, () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of BACKUP_TABLES) {
        const cols = tableColumns(db, t);
        for (const row of parsed.tables[t]) insertRow(db, t, row, cols, 'insert');
      }
    });
  } finally {
    db.close();
  }
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) counts[t] = parsed.tables[t].length;
  return counts;
}

/**
 * Replace mode, step 2: moves `current` aside (kept as a safety copy) and
 * puts `next` in its place. Returns the safety copy path.
 */
export function swapDataDir(current: string, next: string, stamp = new Date().toISOString().replace(/[:.]/g, '-')): string {
  const safety = `${current}.before-restore-${stamp}`;
  renameSync(current, safety);
  try {
    renameSync(next, current);
  } catch (e) {
    renameSync(safety, current);
    throw e;
  }
  return safety;
}

export type CollisionChoice = 'keep-mine' | 'use-backup';

/** Merge mode: adds new rows/files; replaces a colliding row only when explicitly chosen. */
export function mergeBackup(
  bytes: Uint8Array,
  db: Db,
  files: FileStore,
  choices: Record<string, CollisionChoice> = {},
): { added: number; replaced: number; kept: number } {
  const inspection = inspectBackup(bytes, db);
  if (!inspection.ok) throw new Error(`Restore refused: ${inspection.errors.join('; ')}`);
  const parsed = parseBackup(bytes, [])!;
  let added = 0;
  let replaced = 0;
  let kept = 0;
  const writtenFiles: string[] = [];
  const collisionKeys = new Map(inspection.collisions.map((c) => [`${c.table}:${c.key}`, c]));
  try {
    tx(db, () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of BACKUP_TABLES) {
        const cols = tableColumns(db, t);
        const key = KEY[t];
        const exists = db.prepare(`SELECT 1 FROM ${t} WHERE ${key} = ?`);
        for (const row of parsed.tables[t]) {
          const k = `${t}:${String(row[key])}`;
          if (!exists.get(String(row[key]))) {
            insertRow(db, t, row, cols, 'insert');
            added++;
          } else if (collisionKeys.has(k)) {
            const c = collisionKeys.get(k)!;
            if (!c.locked && choices[k] === 'use-backup' && !(t === 'cv_versions' && Number(row.locked) === 1)) {
              insertRow(db, t, row, cols, 'replace');
              replaced++;
            } else kept++;
          }
        }
      }
      for (const [path, content] of parsed.files) {
        if (files.exists(path)) continue;
        const [area, owner, name] = path.split('/');
        const stored = files.write(area as 'sources' | 'sent' | 'offers', owner, name, content, { readOnly: area === 'sent' });
        writtenFiles.push(stored.relPath);
      }
    });
  } catch (e) {
    for (const p of writtenFiles) files.remove(p);
    throw e;
  }
  return { added, replaced, kept };
}
