import { describe, expect, it } from 'vitest';
import { COALESCE_MS, HISTORY_LIMIT, canRedo, canUndo, createHistory, pushState, redo, redoLabel, resetHistory, undo, undoLabel } from '../../src/shared/history';

describe('undo/redo history', () => {
  it('undoes and redoes in order', () => {
    let h = createHistory('a');
    h = pushState(h, 'b', { label: 'Edit 1', now: 0 });
    h = pushState(h, 'c', { label: 'Edit 2', now: 5000 });
    expect(undoLabel(h)).toBe('Edit 2');
    const u1 = undo(h);
    expect(u1.history.present).toBe('b');
    expect(canRedo(u1.history)).toBe(true);
    expect(redoLabel(u1.history)).toBe('Edit 2');
    const u2 = undo(u1.history);
    expect(u2.history.present).toBe('a');
    expect(canUndo(u2.history)).toBe(false);
    expect(undo(u2.history).step).toBeNull();
    const r = redo(u2.history);
    expect(r.history.present).toBe('b');
    expect(redo(redo(r.history).history).step).toBeNull();
  });

  it('coalesces typing in the same field', () => {
    let h = createHistory('');
    h = pushState(h, 'J', { label: 'Typing', coalesceKey: 'f1', now: 0 });
    h = pushState(h, 'Je', { label: 'Typing', coalesceKey: 'f1', now: 100 });
    h = pushState(h, 'Je ', { label: 'Typing', coalesceKey: 'f1', now: 200 });
    expect(h.past).toHaveLength(1);
    h = pushState(h, 'Je d', { label: 'Typing', coalesceKey: 'f1', now: 200 + COALESCE_MS + 1 });
    expect(h.past).toHaveLength(2);
    h = pushState(h, 'Je dx', { label: 'Typing', coalesceKey: 'f2', now: 200 + COALESCE_MS + 2 });
    expect(h.past).toHaveLength(3);
  });

  it('never coalesces a proposal acceptance and keeps its metadata for undo', () => {
    let h = createHistory('a');
    h = pushState(h, 'b', { label: 'Typing', coalesceKey: 'k', now: 0 });
    h = pushState(h, 'c', { label: 'Accept suggestion', coalesceKey: 'k', now: 10, meta: { proposalId: 'p1' } });
    expect(h.past).toHaveLength(2);
    const u = undo(h);
    expect(u.step?.meta.proposalId).toBe('p1');
    expect(redo(u.history).step?.meta.proposalId).toBe('p1');
  });

  it('ignores no-op pushes, clears redo on new edits and caps its size', () => {
    let h = createHistory(0);
    expect(pushState(h, 0, { label: 'x' })).toBe(h);
    h = pushState(h, 1, { label: 'x', now: 0 });
    h = undo(h).history;
    h = pushState(h, 2, { label: 'y', now: 1 });
    expect(canRedo(h)).toBe(false);
    for (let i = 3; i < HISTORY_LIMIT + 20; i++) h = pushState(h, i, { label: 'n', now: i * 10_000 });
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(resetHistory(5).past).toEqual([]);
  });
});
