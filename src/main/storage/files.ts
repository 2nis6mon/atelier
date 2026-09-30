// Local file store for originals, offer files and sent files. All paths are
// relative to the store root and validated so nothing can escape it.

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type FileArea = 'sources' | 'sent' | 'offers';

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Keeps a readable file name while removing anything unsafe for a path component. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  let clean = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) clean = 'file';
  if (clean.length > 120) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
    clean = clean.slice(0, 120 - ext.length) + ext;
  }
  return clean;
}

export interface StoredFile {
  relPath: string;
  sha256: string;
  size: number;
}

export class FileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  /** Absolute path for a stored relative path; throws if it would escape the root. */
  resolvePath(relPath: string): string {
    const abs = resolve(this.root, relPath);
    const rel = relative(this.root, abs);
    if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(abs) !== abs) {
      throw new Error('Invalid file path');
    }
    return abs;
  }

  /** Atomically writes a file (temp file + rename). */
  write(area: FileArea, ownerId: string, filename: string, data: Uint8Array, opts: { readOnly?: boolean } = {}): StoredFile {
    if (!/^[\w-]+$/.test(ownerId)) throw new Error('Invalid owner id');
    const relPath = join(area, ownerId, sanitizeFilename(filename));
    const abs = this.resolvePath(relPath);
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs)) {
      if (opts.readOnly) throw new Error('A sent file with this name already exists and cannot be replaced.');
      chmodSync(abs, 0o644);
    }
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, data, { flag: 'wx' });
    renameSync(tmp, abs);
    if (opts.readOnly) chmodSync(abs, 0o444);
    return { relPath, sha256: sha256(data), size: data.byteLength };
  }

  read(relPath: string): Buffer {
    return readFileSync(this.resolvePath(relPath));
  }

  exists(relPath: string): boolean {
    try {
      return statSync(this.resolvePath(relPath)).isFile();
    } catch {
      return false;
    }
  }

  /** Reads and verifies content against an expected SHA-256. */
  readVerified(relPath: string, expected: string): Buffer {
    const data = this.read(relPath);
    if (sha256(data) !== expected) throw new Error('This stored file was modified outside Atelier (checksum mismatch).');
    return data;
  }

  remove(relPath: string): void {
    const abs = this.resolvePath(relPath);
    if (existsSync(abs)) {
      chmodSync(abs, 0o644);
      rmSync(abs);
    }
  }

  removeOwner(area: FileArea, ownerId: string): void {
    if (area === 'sent') throw new Error('Sent files are never deleted.');
    if (!/^[\w-]+$/.test(ownerId)) throw new Error('Invalid owner id');
    rmSync(join(this.root, area, ownerId), { recursive: true, force: true });
  }
}
