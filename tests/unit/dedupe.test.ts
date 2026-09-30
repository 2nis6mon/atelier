import { describe, expect, it } from 'vitest';
import { parseCvText } from '../../src/shared/cvparse';
import { UnresolvedConflictError, buildGroup, groupCandidates, resolveGroup, sameRecord, similarity } from '../../src/shared/dedupe';
import { SAMPLE_FR_CV_TEXT, sampleRecords } from '../helpers/sample';

const fr = parseCvText(SAMPLE_FR_CV_TEXT);
// Same experience, different start date in another document.
const fr2 = parseCvText(SAMPLE_FR_CV_TEXT.replace("2021 – aujourd'hui", "2022 – aujourd'hui"));

const S1 = { sourceId: 's1', label: 'CV_2024.pdf' };
const S2 = { sourceId: 's2', label: 'CV_FR.docx' };

describe('grouping duplicates across documents', () => {
  const groups = groupCandidates([
    ...fr.candidates.map((c) => ({ candidate: c, source: S1 })),
    ...fr2.candidates.map((c) => ({ candidate: c, source: S2 })),
  ]);

  it('puts the same experience from two files into one group', () => {
    const nova = groups.find((g) => g.kind === 'experience' && g.title.includes('Atelier Nova'))!;
    expect(nova.members).toHaveLength(2);
    expect(nova.conflicts).toHaveLength(1);
    expect(nova.conflicts[0]).toMatchObject({ field: 'start', label: 'Start date' });
    expect(nova.conflicts[0].options.map((o) => [o.display, o.sources[0].label])).toEqual([
      ['2021', 'CV_2024.pdf'],
      ['2022', 'CV_FR.docx'],
    ]);
    // identical values are not conflicts; bullets are merged without duplicates
    expect(nova.base.company).toBe('Atelier Nova');
    expect(nova.base.bullets).toHaveLength(3);
  });

  it('requires a choice before merging and records provenance of the chosen value', () => {
    const nova = groups.find((g) => g.kind === 'experience' && g.title.includes('Atelier Nova'))!;
    expect(() => resolveGroup(nova, { mode: 'merge', choices: {} })).toThrow(UnresolvedConflictError);
    const [merged] = resolveGroup(nova, { mode: 'merge', choices: { start: 0 } });
    expect(merged.data.start).toBe('2021');
    expect(merged.data.current).toBe(true);
    expect(merged.fieldSources.start).toEqual(S1);
    expect(merged.sources).toEqual([S1, S2]);
    const [edited] = resolveGroup(nova, { mode: 'merge', choices: {}, edits: { start: '2021-09' } });
    expect(edited.data.start).toBe('2021-09');
    expect(edited.fieldSources.start).toEqual({ user: true });
    expect(() => resolveGroup(nova, { mode: 'merge', choices: { start: 7 } })).toThrow(UnresolvedConflictError);
  });

  it('keeps records separate on request', () => {
    const nova = groups.find((g) => g.kind === 'experience' && g.title.includes('Atelier Nova'))!;
    const separate = resolveGroup(nova, { mode: 'separate', choices: {} });
    expect(separate).toHaveLength(2);
    expect(separate.map((r) => r.data.start)).toEqual(['2021', '2022']);
  });

  it('groups identical skills and languages without conflicts', () => {
    const react = groups.find((g) => g.kind === 'skill' && g.title === 'React')!;
    expect(react.members).toHaveLength(2);
    expect(react.conflicts).toHaveLength(0);
    const [rec] = resolveGroup(react, { mode: 'merge', choices: {} });
    expect(rec.sources).toHaveLength(2);
  });
});

describe('matching existing library records', () => {
  it('attaches new evidence to an existing record and surfaces contradictions', () => {
    const records = sampleRecords();
    const groups = groupCandidates(fr2.candidates.map((c) => ({ candidate: c, source: S2 })), records);
    const nova = groups.find((g) => g.kind === 'experience' && g.existingRecordId === 'rec-exp-nova')!;
    expect(nova.members[0].origin).toBe('existing');
    expect(nova.conflicts.find((c) => c.field === 'start')?.options.map((o) => o.existing)).toEqual([true, false]);
    const [res] = resolveGroup(nova, { mode: 'merge', choices: { start: 0 } });
    expect(res.existingRecordId).toBe('rec-exp-nova');
    const separate = resolveGroup(nova, { mode: 'separate', choices: {} });
    expect(separate.every((r) => r.existingRecordId === null)).toBe(true);
  });
});

describe('record matching rules', () => {
  it('matches experiences on company and role/period, not on company alone', () => {
    const a = { company: 'Atelier Nova SAS', role: 'Développeuse Frontend', start: '2021', end: '', current: true };
    expect(sameRecord('experience', a, { company: 'Atelier Nova', role: 'Frontend Developer', start: '2021', end: '', current: true })).toBe(true);
    expect(sameRecord('experience', a, { company: 'Atelier Nova', role: 'Stagiaire marketing', start: '2012', end: '2013', current: false })).toBe(false);
    expect(sameRecord('experience', a, { company: 'Other', role: 'Développeuse Frontend', start: '2021' })).toBe(false);
    expect(sameRecord('experience', { company: '' }, { company: '' })).toBe(false);
    expect(sameRecord('education', { institution: 'Université de Lyon', degree: 'Master', end: '2019' }, { institution: 'Université Lyon', degree: 'Master Informatique', end: '2019' })).toBe(true);
    expect(sameRecord('personal', {}, {})).toBe(true);
    expect(sameRecord('profile', { text: 'A b' }, { text: 'a B' })).toBe(true);
    expect(sameRecord('custom', { section: 'x', title: 'y', text: 'z' }, { section: 'x', title: 'y', text: 'z' })).toBe(true);
    expect(similarity('', 'x')).toBe(0);
  });

  it('shows "Present" when one document says the job is ongoing', () => {
    const g = buildGroup('g', 'experience', 'en', [
      { key: 'a', origin: 'candidate', data: { company: 'X', role: 'Dev', start: '2020', end: '', current: true }, sources: [S1], label: '' },
      { key: 'b', origin: 'candidate', data: { company: 'X', role: 'Dev', start: '2020', end: '2022-06', current: false }, sources: [S2], label: '' },
    ]);
    expect(g.conflicts[0].options.map((o) => o.display)).toEqual(['Present', 'Jun 2022']);
    const [present] = resolveGroup(g, { mode: 'merge', choices: { end: 0 } });
    expect(present.data).toMatchObject({ end: '', current: true });
    const [ended] = resolveGroup(g, { mode: 'merge', choices: { end: 1 } });
    expect(ended.data).toMatchObject({ end: '2022-06', current: false });
  });
});
