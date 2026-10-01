import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecoveryJournal } from '../../src/main/storage/recovery';
import { sampleDocument } from '../helpers/sample';
import { tempDir } from '../helpers/tempdir';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

describe('recovery journal', () => {
  it('writes atomically, reads back validated drafts and clears them', () => {
    const j = new RecoveryJournal(join(dir.path, 'recovery'));
    const doc = sampleDocument();
    expect(j.read('cv-12345678')).toBeNull();
    j.write('cv-12345678', { document: doc, at: '2026-10-01T10:00:00.000Z' });
    expect(j.read('cv-12345678')).toEqual({ document: expect.objectContaining({ lang: doc.lang, blocks: expect.any(Array) }), at: '2026-10-01T10:00:00.000Z' });
    const files = readdirSync(join(dir.path, 'recovery'));
    expect(files).toEqual(['cv-12345678.json']); // no temporary file left behind
    if (process.platform !== 'win32') expect(statSync(join(dir.path, 'recovery', files[0])).mode & 0o077).toBe(0);
    j.clear('cv-12345678');
    expect(existsSync(join(dir.path, 'recovery', 'cv-12345678.json'))).toBe(false);
    j.clear('cv-12345678'); // idempotent
  });

  it('ignores corrupt or invalid journals and refuses unsafe ids', () => {
    const j = new RecoveryJournal(join(dir.path, 'recovery'));
    j.write('cv-abcdefgh', { document: sampleDocument(), at: '2026-10-01T10:00:00.000Z' });
    writeFileSync(join(dir.path, 'recovery', 'cv-abcdefgh.json'), '{not json');
    expect(j.read('cv-abcdefgh')).toBeNull();
    writeFileSync(join(dir.path, 'recovery', 'cv-abcdefgh.json'), JSON.stringify({ document: { lang: 'xx' }, at: '2026-10-01T10:00:00.000Z' }));
    expect(j.read('cv-abcdefgh')).toBeNull();
    writeFileSync(join(dir.path, 'recovery', 'cv-abcdefgh.json'), JSON.stringify({ document: sampleDocument(), at: 'yesterday' }));
    expect(j.read('cv-abcdefgh')).toBeNull();
    expect(() => j.write('../escape', { document: sampleDocument(), at: '2026-10-01T10:00:00.000Z' })).toThrow(/Invalid id/);
    expect(j.read('../escape')).toBeNull();
  });
});
