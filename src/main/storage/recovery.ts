// Crash-recovery journal for unsaved editor changes. The renderer sends the
// current draft as you type; it is written atomically outside the data folder
// (never backed up), and removed once the change is saved to the database.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CvDocument } from '../../shared/types';
import { validateDocument } from '../../shared/validation';

const MAX_BYTES = 5 * 1024 * 1024;
const ID = /^[A-Za-z0-9-]{8,64}$/;

export interface RecoveryEntry {
  document: CvDocument;
  at: string;
}

export class RecoveryJournal {
  constructor(private readonly dir: string) {}

  private file(cvId: string): string {
    if (!ID.test(cvId)) throw new Error('Invalid id');
    return join(this.dir, `${cvId}.json`);
  }

  write(cvId: string, entry: RecoveryEntry): void {
    const body = JSON.stringify({ document: entry.document, at: String(entry.at) });
    if (body.length > MAX_BYTES) throw new Error('Draft too large to journal');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const target = this.file(cvId);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, target);
  }

  read(cvId: string): RecoveryEntry | null {
    try {
      const raw = JSON.parse(readFileSync(this.file(cvId), 'utf8')) as { document?: unknown; at?: unknown };
      if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null;
      return { document: validateDocument(raw.document), at: raw.at };
    } catch {
      return null;
    }
  }

  clear(cvId: string): void {
    rmSync(this.file(cvId), { force: true });
  }
}
