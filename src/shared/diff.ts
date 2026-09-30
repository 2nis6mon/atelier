import { diffArrays, diffWordsWithSpace } from 'diff';
import { stripMarkup } from './markup';

export interface DiffSegment {
  text: string;
  type: 'same' | 'added' | 'removed';
}

/** Word-level diff between two texts (markup markers are ignored for display). */
export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = stripMarkup(before);
  const b = stripMarkup(after);
  return diffWordsWithSpace(a, b).map((part) => ({
    text: part.value,
    type: part.added ? 'added' : part.removed ? 'removed' : 'same',
  }));
}

/** Segments for a side-by-side view: left shows removals, right shows insertions. */
export function sideBySide(before: string, after: string): { left: DiffSegment[]; right: DiffSegment[] } {
  const segs = wordDiff(before, after);
  return {
    left: segs.filter((s) => s.type !== 'added'),
    right: segs.filter((s) => s.type !== 'removed'),
  };
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const s of wordDiff(before, after)) {
    const words = s.text.trim() ? s.text.trim().split(/\s+/).length : 0;
    if (s.type === 'added') added += words;
    if (s.type === 'removed') removed += words;
  }
  return { added, removed };
}

export interface OrderChange {
  id: string;
  from: number;
  to: number;
}

/** Items whose position changed between two orders (both must contain the same ids). */
export function orderChanges(before: string[], after: string[]): OrderChange[] {
  const changes: OrderChange[] = [];
  after.forEach((id, to) => {
    const from = before.indexOf(id);
    if (from !== -1 && from !== to) changes.push({ id, from, to });
  });
  return changes;
}

/** Line diff used for version comparison. */
export function lineDiff(before: string[], after: string[]): DiffSegment[] {
  return diffArrays(before, after).flatMap((part) =>
    part.value.map((line) => ({
      text: line,
      type: part.added ? ('added' as const) : part.removed ? ('removed' as const) : ('same' as const),
    })),
  );
}
