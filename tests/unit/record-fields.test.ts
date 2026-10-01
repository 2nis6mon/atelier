import { describe, expect, it } from 'vitest';
import { FIELDS, KIND_LABELS, emptyData, recordDates, recordSubtitle, recordTitle } from '../../src/renderer/features/library/recordFields';
import { RECORD_KINDS, type LibraryRecord, type RecordKind } from '../../src/shared/types';

const rec = (kind: RecordKind, data: Record<string, unknown>, lang: 'fr' | 'en' = 'en'): LibraryRecord =>
  ({ id: 'r', kind, lang, data, sources: [], fieldSources: {}, createdAt: '', updatedAt: '' }) as unknown as LibraryRecord;

describe('library record labels', () => {
  it('has labels and editable fields for every kind', () => {
    for (const k of RECORD_KINDS) {
      expect(KIND_LABELS[k].one).toBeTruthy();
      expect(FIELDS[k].length).toBeGreaterThan(0);
      const d = emptyData(k);
      for (const f of FIELDS[k]) expect(d).toHaveProperty(f.key);
    }
    expect(emptyData('skill').name).toBe('New skill');
    expect(emptyData('language').name).toBe('New language');
    expect(emptyData('experience')).toMatchObject({ bullets: [], current: false, company: '' });
  });

  it('titles and subtitles fall back sensibly when fields are empty', () => {
    expect(recordTitle(rec('experience', { company: 'Nova', role: 'Dev' }))).toBe('Nova');
    expect(recordTitle(rec('experience', {}))).toBe('Untitled experience');
    expect(recordTitle(rec('education', { degree: 'Master' }))).toBe('Master');
    expect(recordTitle(rec('education', {}))).toBe('Untitled education');
    expect(recordTitle(rec('personal', {}))).toBe('Personal details');
    expect(recordTitle(rec('personal', { fullName: 'Camille' }))).toBe('Camille');
    expect(recordTitle(rec('profile', { text: 'A'.repeat(60) }))).toBe('A'.repeat(40));
    expect(recordTitle(rec('profile', {}))).toBe('Profile');
    expect(recordTitle(rec('custom', { section: 'Bénévolat' }))).toBe('Bénévolat');
    expect(recordTitle(rec('custom', {}))).toBe('Custom item');
    expect(recordTitle(rec('skill', { name: 'React' }))).toBe('React');
    expect(recordTitle(rec('language', {}))).toBe('Untitled');

    expect(recordSubtitle(rec('experience', { role: 'Dev' }))).toBe('Dev');
    expect(recordSubtitle(rec('education', { degree: 'Master' }))).toBe('Master');
    expect(recordSubtitle(rec('project', { role: 'Lead' }))).toBe('Lead');
    expect(recordSubtitle(rec('skill', { category: 'Frontend' }))).toBe('Frontend');
    expect(recordSubtitle(rec('language', { level: 'C1' }))).toBe('C1');
    expect(recordSubtitle(rec('certification', { issuer: 'W3C' }))).toBe('W3C');
    expect(recordSubtitle(rec('personal', { headline: 'Dev' }))).toBe('Dev');
    expect(recordSubtitle(rec('profile', {}))).toBe('');
    expect(recordSubtitle(rec('experience', {}))).toBe('');
  });

  it('formats dates only for dated kinds, in the record language', () => {
    expect(recordDates(rec('experience', { start: '2021', end: '', current: true }, 'fr'))).toBe("2021 – aujourd'hui");
    expect(recordDates(rec('experience', { start: '2021-03', end: '2023-01', current: false }))).toBe('Mar 2021 – Jan 2023');
    expect(recordDates(rec('education', { start: '2017', end: '2019' }))).toBe('2017 – 2019');
    expect(recordDates(rec('project', {}))).toBe('');
    expect(recordDates(rec('skill', { start: '2020' }))).toBe('');
  });
});
