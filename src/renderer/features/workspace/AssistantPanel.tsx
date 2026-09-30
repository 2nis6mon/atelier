import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAiContext, recordLabel, suggestLibraryRecords } from '../../../shared/ai/context';
import { describePath } from '../../../shared/document';
import { isActionable } from '../../../shared/proposals';
import type { AiAction, AiRequestInput, Tone } from '../../../shared/types';
import { useApp } from '../../state/app';
import { useAssistant } from '../../state/assistant';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';

const ACTIONS: Array<{ id: AiAction; label: string; needsApp?: boolean }> = [
  { id: 'rewrite', label: 'Improve wording' },
  { id: 'tone', label: 'Change tone' },
  { id: 'translate', label: 'Translate' },
  { id: 'adapt', label: 'Adapt to the job offer', needsApp: true },
  { id: 'recover', label: 'Find content in my library' },
  { id: 'comment', label: 'Comment only (no edits)' },
  { id: 'chat', label: 'Free instructions' },
];

const TONES: Array<{ id: Tone; label: string }> = [
  { id: 'concise', label: 'Concise' },
  { id: 'professional', label: 'Professional' },
  { id: 'confident', label: 'Confident' },
  { id: 'warm', label: 'Warm' },
  { id: 'neutral', label: 'Neutral' },
];

export function AssistantPanel({ onRun }: { onRun: (r: AiRequestInput) => Promise<void> }) {
  const doc = useWorkspace(selectDoc)!;
  const messages = useWorkspace((s) => s.messages);
  const proposals = useWorkspace((s) => s.proposals);
  const aiRun = useWorkspace((s) => s.aiRun);
  const aiError = useWorkspace((s) => s.aiError);
  const application = useWorkspace((s) => s.application);
  const records = useWorkspace((s) => s.records);
  const highlight = useWorkspace((s) => s.highlightBlock);
  const lastSummary = useWorkspace((s) => s.lastSummary);
  const a = useAssistant();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [pickRecords, setPickRecords] = useState(false);
  const openSettings = useApp((s) => s.openSettings);

  useEffect(() => {
    if (a.focusNonce) textarea.current?.focus();
  }, [a.focusNonce]);

  // Keep the section scope pointing at an existing section.
  const sectionId = a.sectionId && doc.blocks.some((b) => b.id === a.sectionId) ? a.sectionId : (highlight ?? doc.blocks[0]?.id ?? null);
  const selection = a.selection && doc ? a.selection : null;
  const scope = a.scope === 'selection' && !selection ? 'section' : a.scope;
  const needsOffer = a.action === 'adapt';
  const usesLibrary = a.action === 'recover' || a.action === 'adapt' || a.action === 'chat';

  const suggested = useMemo(() => {
    if (!usesLibrary) return [];
    const query = [application?.offerText ?? '', a.instructions, selection?.fieldText ?? ''].join(' ');
    return suggestLibraryRecords(records, doc, query || doc.header.headline, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesLibrary, records, application?.offerText, a.action]);

  useEffect(() => {
    if (usesLibrary && a.libraryRecordIds.length === 0 && suggested.length) a.set({ libraryRecordIds: suggested.map((r) => r.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  const request: AiRequestInput = {
    action: a.action,
    scope: { type: scope, target: scope === 'selection' ? selection!.path : scope === 'section' ? sectionId : null, selectionText: scope === 'selection' ? selection!.text : '' },
    tone: a.action === 'rewrite' || a.action === 'tone' ? a.tone : null,
    targetLang: a.action === 'translate' ? (doc.lang === 'fr' ? 'en' : 'fr') : null,
    instructions: a.instructions.slice(0, 500),
    includeOffer: needsOffer || (a.includeOffer && Boolean(application)),
    libraryRecordIds: usesLibrary ? a.libraryRecordIds : [],
  };

  const preview = useMemo(() => {
    try {
      const offer = application ? { company: application.company, role: application.role, text: application.offerText, notes: application.notes } : null;
      return { labels: buildAiContext({ doc, request, records, offer }).labels, error: null as string | null };
    } catch (e) {
      return { labels: [], error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(request), doc, records, application]);

  const actionable = proposals.filter(isActionable);
  const accepted = proposals.filter((p) => p.status === 'accepted').length;
  const canRun = !aiRun && !preview.error && (a.action !== 'chat' || a.instructions.trim()) && (!needsOffer || Boolean(application?.offerText.trim()));

  return (
    <div className="assistant" data-testid="assistant">
      <div className="row">
        <h2 className="section-title grow">AI assistant</h2>
        {application ? (
          <button type="button" className="btn btn-sm" onClick={() => a.set({ panel: 'job' })}>
            Job context
          </button>
        ) : null}
      </div>

      <div className="convo" aria-label="Conversation" aria-live="polite">
        {messages.length === 0 ? <p className="small muted">Ask for suggestions on a selection, a section or the whole CV. Every change comes back as a proposal you review.</p> : null}
        {messages.slice(-6).map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`}>
            {m.text}
            {m.role === 'user' && m.contextLabels.length ? <span className="bubble-meta">{m.contextLabels.join(' · ')}</span> : null}
            {m.role === 'assistant' ? <span className="bubble-meta">{m.providerLabel}</span> : null}
          </div>
        ))}
      </div>

      {actionable.length > 0 ? (
        <button type="button" className="btn btn-primary" onClick={() => useWorkspace.getState().setReviewIndex(0)} data-testid="review-suggestions">
          <Icon name="sparkles" size={14} /> Review {actionable.length} suggestion{actionable.length > 1 ? 's' : ''}
        </button>
      ) : null}

      {aiRun ? (
        <div className="notice peach" role="status" data-testid="ai-running">
          <span className="spinner" />
          <span className="grow">
            <strong>Generating suggestions…</strong>
            <br />
            <span className="small">Your draft is unchanged. {aiRun.received ? `${aiRun.received} characters received.` : 'Waiting for the provider.'}</span>
          </span>
          <button type="button" className="btn btn-sm" onClick={() => useWorkspace.getState().cancelAi()} data-testid="cancel-ai">
            Cancel
          </button>
        </div>
      ) : null}

      {aiError && !aiRun ? (
        <div className="notice err" role="alert" data-testid="ai-error">
          <Icon name="warning" size={15} />
          <span className="grow">
            <strong>{aiError.code === 'cancelled' ? 'Request cancelled.' : 'AI unavailable.'}</strong> {aiError.code === 'cancelled' ? '' : aiError.message} Your draft is unchanged. No other provider is used automatically.
            <span className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {aiError.code !== 'cancelled' && aiError.retryable ? (
                <button type="button" className="btn btn-sm" onClick={() => void onRun(aiError.request)}>
                  <Icon name="refresh" size={12} /> Retry
                </button>
              ) : null}
              {['not-configured', 'auth-expired', 'auth-failed', 'not-eligible', 'quota', 'plan-limit'].includes(aiError.code) ? (
                <button type="button" className="btn btn-sm" onClick={() => openSettings('ai')}>
                  AI settings
                </button>
              ) : null}
              <button type="button" className="btn btn-sm" onClick={() => useWorkspace.getState().dismissAiError()}>
                Keep editing
              </button>
            </span>
          </span>
        </div>
      ) : null}

      {lastSummary && !aiRun && actionable.length === 0 ? <div className="notice">{lastSummary}</div> : null}

      <div className="field">
        <label htmlFor="ai-action">Action</label>
        <select id="ai-action" className="select" value={a.action} onChange={(e) => a.set({ action: e.target.value as AiAction, libraryRecordIds: [] })} data-testid="ai-action">
          {ACTIONS.filter((x) => !x.needsApp || application).map((x) => (
            <option key={x.id} value={x.id}>
              {x.id === 'translate' ? `Translate to ${doc.lang === 'fr' ? 'English' : 'French'}` : x.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="ai-scope">Scope</label>
        <select id="ai-scope" className="select" value={scope} onChange={(e) => a.set({ scope: e.target.value as typeof scope })} data-testid="ai-scope">
          <option value="selection" disabled={!selection}>
            {selection ? `Selected text — ${describePath(doc, selection.path)}` : 'Selected text (select text in the CV)'}
          </option>
          <option value="section">Section</option>
          <option value="cv">Whole CV</option>
        </select>
        {scope === 'section' ? (
          <select className="select" value={sectionId ?? ''} onChange={(e) => a.set({ sectionId: e.target.value })} aria-label="Section">
            {doc.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {a.action === 'rewrite' || a.action === 'tone' ? (
        <div className="field">
          <label htmlFor="ai-tone">Tone</label>
          <select id="ai-tone" className="select" value={a.tone} onChange={(e) => a.set({ tone: e.target.value as Tone })}>
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {usesLibrary ? (
        <div className="field">
          <span className="label">Library records to include</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
            {a.libraryRecordIds.length === 0 ? <span className="small muted">None selected</span> : null}
            {a.libraryRecordIds.map((id) => {
              const r = records.find((x) => x.id === id);
              return r ? (
                <span key={id} className="chip outline">
                  {recordLabel(r)}
                  <button type="button" className="link-btn" aria-label={`Remove ${recordLabel(r)}`} onClick={() => a.set({ libraryRecordIds: a.libraryRecordIds.filter((x) => x !== id) })}>
                    ×
                  </button>
                </span>
              ) : null;
            })}
            <button type="button" className="btn btn-sm" onClick={() => setPickRecords((v) => !v)}>
              {pickRecords ? 'Done' : 'Choose…'}
            </button>
          </div>
          {pickRecords ? (
            <div className="record-picker">
              {records
                .filter((r) => r.kind !== 'personal')
                .map((r) => (
                  <label key={r.id} className="checkbox small">
                    <input
                      type="checkbox"
                      checked={a.libraryRecordIds.includes(r.id)}
                      onChange={(e) => a.set({ libraryRecordIds: e.target.checked ? [...a.libraryRecordIds, r.id] : a.libraryRecordIds.filter((x) => x !== r.id) })}
                    />
                    {recordLabel(r)}
                  </label>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="ai-instructions">Your instructions</label>
        <textarea
          id="ai-instructions"
          ref={textarea}
          className="textarea"
          style={{ minHeight: 70 }}
          maxLength={500}
          placeholder="Add any specific instructions… e.g. keep it professional"
          value={a.instructions}
          onChange={(e) => a.set({ instructions: e.target.value })}
          data-testid="ai-instructions"
        />
        <span className="small muted" style={{ textAlign: 'right' }}>
          {a.instructions.length}/500
        </span>
      </div>

      <div className="context-preview" aria-label="Context that will be sent">
        <span className="small muted">Will send:</span>{' '}
        {preview.error ? <span className="small" style={{ color: 'var(--danger)' }}>{preview.error}</span> : preview.labels.map((l) => <span key={l} className="chip">{l}</span>)}
      </div>
      {needsOffer && !application?.offerText.trim() ? <p className="small" style={{ color: 'var(--warning)' }}>Add the job offer text in Job context first.</p> : null}

      <button type="button" className="btn btn-primary btn-lg" disabled={!canRun} onClick={() => void onRun(request)} data-testid="get-suggestions">
        <Icon name="sparkles" size={15} /> Get suggestions
      </button>
      <p className="small muted row" style={{ gap: 6 }}>
        <Icon name="info" size={13} /> {accepted ? `${accepted} suggestion${accepted > 1 ? 's' : ''} applied (undo with ⌘Z).` : 'No changes applied yet.'}
      </p>
    </div>
  );
}
