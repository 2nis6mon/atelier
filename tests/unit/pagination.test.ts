import { describe, expect, it } from 'vitest';
import { type Atom, pageOfAtom, paginate } from '../../src/shared/pagination';

const atom = (id: string, blockId: string, height: number, extra: Partial<Atom> = {}): Atom => ({ id, blockId, zone: 'main', height, keepWithNext: false, ...extra });
const cap = (c: number) => () => c;

describe('pagination', () => {
  it('fits everything on one page when possible', () => {
    const r = paginate([atom('a', 'b1', 100), atom('b', 'b1', 100)], cap(300));
    expect(r.pageCount).toBe(1);
    expect(r.continuations).toEqual([]);
  });

  it('flows to the next page and reports continuing sections', () => {
    const atoms = [atom('t1', 'exp', 30, { keepWithNext: true }), atom('i1', 'exp', 200), atom('i2', 'exp', 200), atom('i3', 'exp', 200)];
    const r = paginate(atoms, cap(500));
    expect(r.pageCount).toBe(2);
    expect(r.pages[0].main).toEqual(['t1', 'i1', 'i2']);
    expect(r.pages[1].main).toEqual(['i3']);
    expect(r.continuations).toEqual([{ blockId: 'exp', pages: [1, 2] }]);
    expect(pageOfAtom(r, 'i3')).toBe(2);
    expect(pageOfAtom(r, 'zz')).toBe(0);
  });

  it('keeps a section title with its first entry', () => {
    const atoms = [atom('x', 'p', 450), atom('title', 's', 30, { keepWithNext: true }), atom('first', 's', 60)];
    const r = paginate(atoms, cap(500));
    expect(r.pages[1].main).toEqual(['title', 'first']);
  });

  it('honours explicit page breaks and flags atoms taller than a page', () => {
    const atoms = [atom('a', 'b1', 50), atom('b', 'b2', 50, { breakBefore: true }), atom('huge', 'b3', 900)];
    const r = paginate(atoms, cap(500));
    expect(r.pages.map((p) => p.main)).toEqual([['a'], ['b'], ['huge']]);
    expect(r.tooTall).toEqual(['huge']);
  });

  it('paginates the side column independently with its own capacity', () => {
    const atoms = [atom('m1', 'm', 100), { ...atom('s1', 'side', 300), zone: 'side' as const }, { ...atom('s2', 'side', 300), zone: 'side' as const }];
    const r = paginate(atoms, (zone, page) => (zone === 'side' ? 400 : 1000) - (page === 0 ? 50 : 0));
    expect(r.pageCount).toBe(2);
    expect(r.pages[0]).toEqual({ main: ['m1'], side: ['s1'] });
    expect(r.pages[1]).toEqual({ main: [], side: ['s2'] });
  });

  it('never splits a keep-with-next chain unless the chain itself exceeds a page', () => {
    const atoms = [atom('a', 'b', 100), atom('t', 'c', 200, { keepWithNext: true }), atom('u', 'c', 200, { keepWithNext: true }), atom('v', 'c', 200)];
    const r = paginate(atoms, cap(500));
    expect(r.pages[0].main).toEqual(['a', 't']);
  });
});
