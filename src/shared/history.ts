// Undo/redo history for documents. Pure data structure: every operation
// returns a new History value. Consecutive edits with the same coalesce key
// (e.g. typing in one field) within COALESCE_MS are merged into one step.

export const COALESCE_MS = 1200;
export const HISTORY_LIMIT = 200;

export interface HistoryMeta {
  /** Proposal accepted by this step (undo puts it back to pending). */
  proposalId?: string;
}

export interface HistoryStep<T> {
  state: T;
  label: string;
  meta: HistoryMeta;
}

export interface History<T> {
  past: HistoryStep<T>[]; // each entry = state BEFORE the change + change label
  present: T;
  future: HistoryStep<T>[]; // each entry = state AFTER redo + change label
  lastKey: string | null;
  lastAt: number;
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [], lastKey: null, lastAt: 0 };
}

export interface PushOptions {
  label: string;
  coalesceKey?: string | null;
  now?: number;
  meta?: HistoryMeta;
}

export function pushState<T>(h: History<T>, next: T, opts: PushOptions): History<T> {
  if (next === h.present) return h;
  const now = opts.now ?? Date.now();
  const key = opts.coalesceKey ?? null;
  const canCoalesce = key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS && h.past.length > 0 && !opts.meta?.proposalId;
  if (canCoalesce) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  const past = [...h.past, { state: h.present, label: opts.label, meta: opts.meta ?? {} }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
export const undoLabel = <T>(h: History<T>) => (h.past.length ? h.past[h.past.length - 1].label : null);
export const redoLabel = <T>(h: History<T>) => (h.future.length ? h.future[h.future.length - 1].label : null);

export interface UndoResult<T> {
  history: History<T>;
  step: HistoryStep<T> | null;
}

export function undo<T>(h: History<T>): UndoResult<T> {
  if (!h.past.length) return { history: h, step: null };
  const step = h.past[h.past.length - 1];
  return {
    history: {
      past: h.past.slice(0, -1),
      present: step.state,
      future: [...h.future, { state: h.present, label: step.label, meta: step.meta }],
      lastKey: null,
      lastAt: 0,
    },
    step,
  };
}

export function redo<T>(h: History<T>): UndoResult<T> {
  if (!h.future.length) return { history: h, step: null };
  const step = h.future[h.future.length - 1];
  return {
    history: {
      past: [...h.past, { state: h.present, label: step.label, meta: step.meta }],
      present: step.state,
      future: h.future.slice(0, -1),
      lastKey: null,
      lastAt: 0,
    },
    step,
  };
}

/** Replaces the present without creating an undo step (e.g. after a reload from disk). */
export function resetHistory<T>(present: T): History<T> {
  return createHistory(present);
}
