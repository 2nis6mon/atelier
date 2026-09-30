import { create } from 'zustand';
import type { AiErrorInfo } from '../../shared/ai/errors';
import { documentHash, newId, setText } from '../../shared/document';
import { canRedo, canUndo, createHistory, pushState, redo, redoLabel, undo, undoLabel, type History } from '../../shared/history';
import { applyProposal, refreshStaleness } from '../../shared/proposals';
import type { AiRequestInput, Application, ConversationMessage, Cv, CvDocument, LibraryRecord, Proposal } from '../../shared/types';
import { api, errorMessage } from '../api';
import type { LayoutInfo } from '../cv/CvPages';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface AiRunState {
  requestId: string;
  action: AiRequestInput['action'];
  received: number;
  startedAt: number;
  contextLabels: string[];
}

interface WorkspaceState {
  cvId: string | null;
  cv: Cv | null;
  history: History<CvDocument> | null;
  revision: number;
  saveState: SaveState;
  saveError: string | null;
  savedAt: string | null;
  recovery: { document: CvDocument; at: string } | null;
  proposals: Proposal[];
  messages: ConversationMessage[];
  application: Application | null;
  records: LibraryRecord[];
  layout: LayoutInfo | null;
  aiRun: AiRunState | null;
  aiError: (AiErrorInfo & { request: AiRequestInput }) | null;
  lastSummary: string | null;
  highlightBlock: string | null;
  reviewIndex: number | null;
  open(cvId: string): Promise<void>;
  close(): Promise<void>;
  edit(next: (d: CvDocument) => CvDocument, label: string, coalesceKey?: string | null): void;
  setField(path: string, value: string): void;
  undo(): void;
  redo(): void;
  flush(): Promise<boolean>;
  reloadFromDisk(): Promise<void>;
  acceptRecovery(): void;
  discardRecovery(): void;
  setLayout(l: LayoutInfo): void;
  setHighlight(id: string | null): void;
  runAi(request: AiRequestInput): Promise<boolean>;
  cancelAi(): void;
  dismissAiError(): void;
  accept(id: string, editedText?: string): { ok: boolean; message?: string; reason?: string };
  reject(id: string): Promise<void>;
  confirmFacts(id: string, confirmed: boolean): Promise<void>;
  setReviewIndex(i: number | null): void;
  refreshApplication(): Promise<void>;
  refreshRecords(): Promise<void>;
}

const SAVE_DELAY = 600;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let savingPromise: Promise<boolean> | null = null;

const recoveryKey = (id: string) => `atelier.recovery.${id}`;

function writeRecovery(id: string, doc: CvDocument) {
  try {
    localStorage.setItem(recoveryKey(id), JSON.stringify({ document: doc, at: new Date().toISOString() }));
  } catch {
    // storage unavailable: the in-memory draft is still kept
  }
}
function clearRecovery(id: string) {
  try {
    localStorage.removeItem(recoveryKey(id));
  } catch {
    // ignore
  }
}
function readRecovery(id: string): { document: CvDocument; at: string } | null {
  try {
    const raw = localStorage.getItem(recoveryKey(id));
    return raw ? (JSON.parse(raw) as { document: CvDocument; at: string }) : null;
  } catch {
    return null;
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), SAVE_DELAY);
  };

  const updateProposalStatus = async (id: string, patch: Partial<Pick<Proposal, 'status' | 'confirmed' | 'proposedText'>>) => {
    set({ proposals: get().proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
    await api().proposals.update(id, patch);
  };

  const afterDocChange = () => {
    const h = get().history;
    if (!h) return;
    set({ proposals: refreshStaleness(h.present, get().proposals, get().records), saveState: 'dirty' });
    const id = get().cvId;
    if (id) writeRecovery(id, h.present);
    scheduleSave();
  };

  return {
    cvId: null,
    cv: null,
    history: null,
    revision: 0,
    saveState: 'saved',
    saveError: null,
    savedAt: null,
    recovery: null,
    proposals: [],
    messages: [],
    application: null,
    records: [],
    layout: null,
    aiRun: null,
    aiError: null,
    lastSummary: null,
    highlightBlock: null,
    reviewIndex: null,

    async open(cvId) {
      if (get().cvId && get().cvId !== cvId) await get().close();
      const cv = await api().cvs.get(cvId);
      if (!cv) {
        set({ cvId, cv: null, history: null });
        return;
      }
      const [proposals, messages, records, application] = await Promise.all([
        api().proposals.list(cvId),
        api().ai.messages(cvId),
        api().library.records(),
        cv.applicationId ? api().applications.get(cv.applicationId) : Promise.resolve(null),
      ]);
      const rec = readRecovery(cvId);
      const recovery = rec && rec.at > cv.updatedAt && documentHash(rec.document) !== documentHash(cv.document) ? rec : null;
      if (!recovery) clearRecovery(cvId);
      set({
        cvId,
        cv,
        history: createHistory(cv.document),
        revision: cv.revision,
        saveState: 'saved',
        saveError: null,
        savedAt: cv.updatedAt,
        recovery,
        proposals: refreshStaleness(cv.document, proposals, records),
        messages,
        records,
        application,
        aiRun: null,
        aiError: null,
        lastSummary: null,
        highlightBlock: null,
        reviewIndex: null,
        layout: null,
      });
    },

    async close() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (get().saveState === 'dirty' || get().saveState === 'error') await get().flush();
      const run = get().aiRun;
      if (run) void api().ai.cancel(run.requestId);
      set({ cvId: null, cv: null, history: null, proposals: [], messages: [], aiRun: null, aiError: null });
    },

    edit(next, label, coalesceKey = null) {
      const h = get().history;
      if (!h) return;
      let doc: CvDocument;
      try {
        doc = next(h.present);
      } catch {
        return;
      }
      if (doc === h.present) return;
      set({ history: pushState(h, doc, { label, coalesceKey }) });
      afterDocChange();
    },

    setField(path, value) {
      get().edit((d) => setText(d, path, value), 'Typing', `field:${path}`);
    },

    undo() {
      const h = get().history;
      if (!h || !canUndo(h)) return;
      const r = undo(h);
      set({ history: r.history });
      if (r.step?.meta.proposalId) void updateProposalStatus(r.step.meta.proposalId, { status: 'pending' });
      afterDocChange();
    },

    redo() {
      const h = get().history;
      if (!h || !canRedo(h)) return;
      const r = redo(h);
      set({ history: r.history });
      if (r.step?.meta.proposalId) void updateProposalStatus(r.step.meta.proposalId, { status: 'accepted' });
      afterDocChange();
    },

    async flush() {
      if (savingPromise) await savingPromise;
      const { cvId, history, revision } = get();
      if (!cvId || !history) return true;
      if (get().saveState === 'saved' || get().saveState === 'conflict') return get().saveState === 'saved';
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const doc = history.present;
      set({ saveState: 'saving' });
      savingPromise = (async () => {
        try {
          const r = await api().cvs.save(cvId, doc, revision);
          if (!r.ok) {
            if (r.error.code === 'revision-conflict') {
              set({ saveState: 'conflict', saveError: r.error.message });
              return false;
            }
            throw new Error(r.error.message);
          }
          const stillSame = get().history?.present === doc;
          set({ revision: r.value.revision, savedAt: r.value.updatedAt, saveState: stillSame ? 'saved' : 'dirty', saveError: null });
          if (stillSame) clearRecovery(cvId);
          else scheduleSave();
          return true;
        } catch (e) {
          set({ saveState: 'error', saveError: errorMessage(e) });
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => void get().flush(), 5000);
          return false;
        } finally {
          savingPromise = null;
        }
      })();
      return savingPromise;
    },

    async reloadFromDisk() {
      const id = get().cvId;
      if (!id) return;
      clearRecovery(id);
      set({ saveState: 'saved' });
      await get().open(id);
    },

    acceptRecovery() {
      const rec = get().recovery;
      const h = get().history;
      if (!rec || !h) return;
      set({ history: pushState(h, rec.document, { label: 'Recover unsaved changes' }), recovery: null });
      afterDocChange();
    },

    discardRecovery() {
      const id = get().cvId;
      if (id) clearRecovery(id);
      set({ recovery: null });
    },

    setLayout(l) {
      const prev = get().layout;
      if (prev && prev.pageCount === l.pageCount && JSON.stringify(prev.continuations) === JSON.stringify(l.continuations) && prev.tooTall.length === l.tooTall.length && prev.ready === l.ready) return;
      set({ layout: l });
    },

    setHighlight(id) {
      set({ highlightBlock: id });
    },

    async runAi(request) {
      const { cvId, history } = get();
      if (!cvId || !history || get().aiRun) return false;
      const requestId = newId();
      set({ aiRun: { requestId, action: request.action, received: 0, startedAt: Date.now(), contextLabels: [] }, aiError: null, lastSummary: null });
      const off = api().ai.onProgress((rid, n) => {
        const run = get().aiRun;
        if (run && run.requestId === rid) set({ aiRun: { ...run, received: n } });
      });
      try {
        const r = await api().ai.run({ requestId, cvId, document: history.present, request });
        const messages = await api().ai.messages(cvId);
        if (!r.ok) {
          set({ aiError: { ...(r.aiError ?? { code: 'server', message: r.error.message, detail: '', retryable: true }), request }, messages });
          return false;
        }
        const incoming = refreshStaleness(get().history!.present, r.value.proposals, get().records);
        set({ proposals: [...get().proposals, ...incoming], messages, lastSummary: r.value.summary || null });
        const firstActionable = get().proposals.findIndex((p) => (p.status === 'pending' || p.status === 'stale') && incoming.some((x) => x.id === p.id));
        if (incoming.length && firstActionable >= 0) set({ reviewIndex: 0 });
        return true;
      } finally {
        off();
        set({ aiRun: null });
      }
    },

    cancelAi() {
      const run = get().aiRun;
      if (run) void api().ai.cancel(run.requestId);
    },

    dismissAiError() {
      set({ aiError: null });
    },

    accept(id, editedText) {
      const { history, proposals, records } = get();
      const p = proposals.find((x) => x.id === id);
      if (!history || !p) return { ok: false, message: 'Suggestion not found.' };
      const res = applyProposal(history.present, p, { records, editedText });
      if (!res.ok) {
        if (res.reason === 'stale' || res.reason === 'missing') void updateProposalStatus(id, { status: 'stale' });
        return { ok: false, message: res.message, reason: res.reason };
      }
      set({ history: pushState(history, res.doc, { label: res.label, meta: { proposalId: id } }) });
      void updateProposalStatus(id, { status: 'accepted', ...(editedText !== undefined ? { proposedText: editedText } : {}) });
      afterDocChange();
      return { ok: true };
    },

    async reject(id) {
      await updateProposalStatus(id, { status: 'rejected' });
    },

    async confirmFacts(id, confirmed) {
      await updateProposalStatus(id, { confirmed });
    },

    setReviewIndex(i) {
      set({ reviewIndex: i });
    },

    async refreshApplication() {
      const cv = get().cv;
      if (cv?.applicationId) set({ application: await api().applications.get(cv.applicationId) });
    },

    async refreshRecords() {
      set({ records: await api().library.records() });
    },
  };
});

export const selectDoc = (s: WorkspaceState) => s.history?.present ?? null;
export const selectUndo = (s: WorkspaceState) => (s.history ? { can: canUndo(s.history), label: undoLabel(s.history) } : { can: false, label: null });
export const selectRedo = (s: WorkspaceState) => (s.history ? { can: canRedo(s.history), label: redoLabel(s.history) } : { can: false, label: null });
