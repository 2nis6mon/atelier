import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff, orderChanges, sideBySide, wordDiff } from '../../src/shared/diff';

describe('diff', () => {
  const before = 'Je développe des interfaces avec React et TypeScript. Je travaille avec les designers.';
  const after = 'Je développe des interfaces React et TypeScript en collaboration avec les designers.';

  it('computes word-level insertions and deletions', () => {
    const segs = wordDiff(before, after);
    expect(segs.filter((s) => s.type === 'removed').map((s) => s.text.trim())).toContain('avec');
    expect(segs.filter((s) => s.type === 'added').map((s) => s.text).join('')).toContain('collaboration');
    const joinedAfter = segs.filter((s) => s.type !== 'removed').map((s) => s.text).join('');
    expect(joinedAfter).toBe(after);
  });

  it('splits segments for side-by-side display', () => {
    const { left, right } = sideBySide(before, after);
    expect(left.map((s) => s.text).join('')).toBe(before);
    expect(right.map((s) => s.text).join('')).toBe(after);
    expect(left.some((s) => s.type === 'added')).toBe(false);
  });

  it('ignores formatting markers and counts words', () => {
    expect(wordDiff('**a** b', 'a b').every((s) => s.type === 'same')).toBe(true);
    expect(diffStats('a b c', 'a x c')).toEqual({ added: 1, removed: 1 });
  });

  it('reports order and line changes', () => {
    expect(orderChanges(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual([
      { id: 'b', from: 1, to: 0 },
      { id: 'a', from: 0, to: 1 },
    ]);
    expect(lineDiff(['x', 'y'], ['x', 'z']).map((s) => s.type)).toEqual(['same', 'removed', 'added']);
  });
});
