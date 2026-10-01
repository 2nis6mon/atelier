import { useEffect, useMemo, useState } from 'react';
import { recordLabel, recordText } from '../../../shared/ai/context';
import { sideBySide, type DiffSegment } from '../../../shared/diff';
import { describePath, findBlock, getText, parsePath } from '../../../shared/document';
import { stripMarkup } from '../../../shared/markup';
import { checkProposal, isActionable, parseRef, itemPlainText } from '../../../shared/proposals';
import type { AiRequestInput, Proposal } from '../../../shared/types';
import { toast } from '../../state/app';
import { useAssistant } from '../../state/assistant';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';

function Segments({ segs, side }: { segs: DiffSegment[]; side: 'left' | 'right' }) {
  return (
    <>
      {segs.map((s, i) =>
        s.type === 'same' ? (
          <span key={i}>{s.text}</span>
        ) : s.type === 'removed' && side === 'left' ? (
          <del key={i} className="diff-del">
            {s.text}
          </del>
        ) : (
          <ins key={i} className="diff-ins">
            {s.text}
          </ins>
        ),
      )}
    </>
  );
}

const KIND_TITLE: Record<Proposal['kind'], string> = {
  rewrite: 'Proposed change',
  insert: 'Proposed addition',
  remove: 'Proposed removal',
  reorder: 'Proposed new order',
  library: 'From your library',
  question: 'Question for you',
  comment: 'Comment',
};

export function ReviewOverlay({ onRun }: { onRun: (r: AiRequestInput) => Promise<void> }) {
  const doc = useWorkspace(selectDoc)!;
  const proposals = useWorkspace((s) => s.proposals);
  const records = useWorkspace((s) => s.records);
  const index = useWorkspace((s) => s.reviewIndex) ?? 0;
  const setIndex = useWorkspace((s) => s.setReviewIndex);
  const list = useMemo(() => proposals.filter((p) => isActionable(p) || ((p.kind === 'question' || p.kind === 'comment') && p.status === 'pending')), [proposals]);
  const p = list[Math.min(index, list.length - 1)];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showConflict, setShowConflict] = useState(false);

  useEffect(() => {
    setEditing(false);
    setError(null);
    setShowConflict(false);
    setDraft(p ? stripMarkup(p.proposedText) === p.proposedText ? p.proposedText : p.proposedText : '');
  }, [p?.id]);

  useEffect(() => {
    if (list.length === 0) setIndex(null);
  }, [list.length, setIndex]);

  useEffect(() => {
    const reduce = document.documentElement.dataset.motion === 'reduce';
    document.querySelector('[data-testid="review"]')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  if (!p) return null;
  const check = checkProposal(doc, p, records);
  const stale = check.state === 'stale' || check.state === 'missing';
  const where = p.kind === 'rewrite' || (p.kind === 'remove' && parsePath(p.target)) ? describePath(doc, p.target) : (() => {
    const ref = parseRef(p.target);
    if (ref?.type === 'block') return findBlock(doc, ref.blockId)?.title ?? '';
    if (ref?.type === 'item') {
      const b = findBlock(doc, ref.blockId);
      const it = b?.items.find((i) => i.id === ref.itemId);
      return `${b?.title ?? ''} › ${it ? itemPlainText(it).slice(0, 60) : ''}`;
    }
    return '';
  })();

  const current = p.kind === 'rewrite' ? (getText(doc, p.target) ?? p.baseText) : p.baseText;
  const diff = p.kind === 'rewrite' ? sideBySide(p.baseText, editing ? draft : p.proposedText) : null;
  const record = p.recordId ? records.find((r) => r.id === p.recordId) : null;

  const next = () => setIndex(index >= list.length - 1 ? Math.max(0, list.length - 2) : index);
  const accept = () => {
    const r = useWorkspace.getState().accept(p.id, editing ? draft : undefined);
    if (!r.ok) {
      setError(r.message ?? 'This suggestion could not be applied.');
      return;
    }
    toast({ kind: 'ok', text: 'Change applied. ⌘Z to undo.' });
    next();
  };
  const reject = async () => {
    await useWorkspace.getState().reject(p.id);
    next();
  };
  const tryAnother = async () => {
    await useWorkspace.getState().reject(p.id);
    const target = p.kind === 'rewrite' ? p.target : null;
    await onRun({
      action: target ? 'rewrite' : 'chat',
      scope: target ? { type: 'selection', target, selectionText: '' } : { type: 'cv', target: null, selectionText: '' },
      tone: null,
      targetLang: null,
      instructions: `Propose a different alternative than this one: "${stripMarkup(p.proposedText).slice(0, 400)}"`,
      includeOffer: false,
      libraryRecordIds: p.recordId ? [p.recordId] : [],
    });
  };

  return (
    <section className="review glass-strong" aria-label="Review changes" data-testid="review">
      <div className="row review-head">
        <div className="grow">
          <h2 className="display" style={{ fontSize: 28 }}>Review changes</h2>
          <p className="muted">Compare the original and proposed text, then choose what to do.</p>
        </div>
        <div className="col" style={{ alignItems: 'center', gap: 4 }}>
          <div className="dots" aria-hidden="true">
            {list.map((x, i) => (
              <span key={x.id} className={i === index ? 'on' : ''} />
            ))}
          </div>
          <span className="small muted" data-testid="review-progress">
            {Math.min(index, list.length - 1) + 1} of {list.length}
          </span>
        </div>
        <button type="button" className="btn btn-sm icon-btn" aria-label="Previous suggestion" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <Icon name="left" size={14} />
        </button>
        <button type="button" className="btn btn-sm icon-btn" aria-label="Next suggestion" disabled={index >= list.length - 1} onClick={() => setIndex(index + 1)}>
          <Icon name="right" size={14} />
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setIndex(null)} data-testid="close-review">
          Close
        </button>
      </div>

      <p className="small muted" style={{ margin: '4px 0 10px' }}>
        {KIND_TITLE[p.kind]} {where ? `· ${where}` : ''}
      </p>

      {stale ? (
        <div className="notice warn" role="alert" data-testid="stale">
          <Icon name="warning" size={15} />
          <span className="grow">
            <strong>{check.state === 'missing' ? 'The text this suggestion refers to was removed.' : 'Text changed during the request.'}</strong> It cannot be applied as is.
          </span>
          {check.state === 'stale' ? (
            <button type="button" className="btn btn-sm" onClick={() => setShowConflict((v) => !v)}>
              Review conflict
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => void tryAnother()}>
            Regenerate
          </button>
        </div>
      ) : null}
      {showConflict && check.state === 'stale' ? (
        <div className="surface" style={{ padding: 12, marginTop: 8 }}>
          <div className="small muted">When the suggestion was made:</div>
          <p>{stripMarkup(p.baseText)}</p>
          <div className="small muted" style={{ marginTop: 6 }}>Now in your CV:</div>
          <p>{stripMarkup(check.current)}</p>
        </div>
      ) : null}

      {p.kind === 'rewrite' && diff ? (
        <div className="diff-grid">
          <div className="diff-card">
            <div className="diff-label">
              <Icon name="doc" size={15} /> {stale ? 'When the suggestion was made' : 'Current (in your CV)'}
            </div>
            <div className="diff-text" data-testid="diff-current">
              <Segments segs={diff.left} side="left" />
            </div>
          </div>
          <div className="diff-card proposed">
            <div className="diff-label">
              <Icon name="sparkle" size={15} /> Proposed change
            </div>
            {editing ? (
              <textarea className="textarea diff-edit" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit proposed text" data-autofocus />
            ) : (
              <div className="diff-text" data-testid="diff-proposed">
                <Segments segs={diff.right} side="right" />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {p.kind === 'insert' ? (
        <div className="diff-card proposed" style={{ marginTop: 10 }}>
          <div className="diff-label">New bullet</div>
          {editing ? <textarea className="textarea diff-edit" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit text" /> : <div className="diff-text"><ins className="diff-ins">{stripMarkup(p.proposedText)}</ins></div>}
        </div>
      ) : null}
      {p.kind === 'remove' ? (
        <div className="diff-card" style={{ marginTop: 10 }}>
          <div className="diff-label">Will be removed from this CV (your library keeps it)</div>
          <div className="diff-text">
            <del className="diff-del">{stripMarkup(current)}</del>
          </div>
        </div>
      ) : null}
      {p.kind === 'reorder' ? (
        <div className="diff-grid">
          {[p.baseOrder, p.proposedOrder].map((order, col) => (
            <div key={col} className={`diff-card ${col ? 'proposed' : ''}`}>
              <div className="diff-label">{col ? 'Proposed order' : 'Current order'}</div>
              <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {order.map((id, i) => {
                  const ref = parseRef(p.target);
                  const b = ref?.type === 'block' ? findBlock(doc, ref.blockId) : null;
                  const it = b?.items.find((x) => x.id === id);
                  const moved = p.baseOrder.indexOf(id) !== i;
                  return (
                    <li key={id} style={{ fontWeight: moved && col ? 600 : 400 }}>
                      {it ? itemPlainText(it).split(' | ').slice(0, 2).join(' — ') : id}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
      {p.kind === 'library' ? (
        <div className="diff-card proposed" style={{ marginTop: 10 }}>
          <div className="diff-label">
            <Icon name="library" size={15} /> {record ? recordLabel(record) : 'Library record'}
          </div>
          <pre className="diff-text" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{record ? recordText(record) : p.proposedText}</pre>
        </div>
      ) : null}
      {p.kind === 'question' || p.kind === 'comment' ? (
        <div className={`notice ${p.kind === 'question' ? 'warn' : ''}`} style={{ marginTop: 10, fontSize: 14 }}>
          <Icon name={p.kind === 'question' ? 'info' : 'chat'} size={16} />
          <span>{p.proposedText}</span>
        </div>
      ) : null}

      <div className="review-meta">
        <div>
          <div className="diff-label">
            <Icon name="sparkles" size={14} /> Explanation
          </div>
          <p className="small">{p.explanation || '—'}</p>
        </div>
        <div>
          <div className="diff-label">
            <Icon name="file" size={14} /> Source
          </div>
          {p.citations.length === 0 ? <p className="small muted">No source cited.</p> : null}
          {p.citations.map((c, i) => (
            <p key={i} className="small">
              <strong>{c.type === 'cv' ? 'Current CV' : c.type === 'library' ? 'Your library' : c.type === 'offer' ? 'Job offer' : c.label}</strong>
              {c.type !== 'cv' ? ` — ${c.label}` : ''}
              {c.type === 'library' && record?.sources.length ? <span className="muted"> (from {record.sources.map((s) => s.label).join(', ')})</span> : null}
            </p>
          ))}
        </div>
      </div>

      {p.unverified.length ? (
        <div className="notice warn" data-testid="unverified">
          <Icon name="warning" size={15} />
          <span className="grow">
            <strong>Not found in your documents:</strong> {p.unverified.join(', ')}. A job requirement is not proof of your experience.
            <label className="checkbox" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={p.confirmed} onChange={(e) => void useWorkspace.getState().confirmFacts(p.id, e.target.checked)} data-testid="confirm-facts" />
              I confirm this is true about me
            </label>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="notice err" role="alert">
          <Icon name="warning" size={15} /> {error}
        </div>
      ) : null}

      <div className="row review-actions">
        {p.kind === 'question' || p.kind === 'comment' ? (
          <>
            {p.kind === 'question' ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void useWorkspace.getState().reject(p.id);
                  useAssistant.getState().set({ action: 'chat', instructions: `About your question “${p.proposedText.slice(0, 120)}”: `, panel: 'assistant' });
                  useAssistant.getState().focusInstructions();
                  setIndex(null);
                }}
              >
                Answer
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => void reject()}>
              Dismiss
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-lg" onClick={accept} disabled={stale || (p.unverified.length > 0 && !p.confirmed)} data-testid="accept">
              {p.kind === 'library' ? 'Add to CV' : editing ? 'Accept edited' : 'Accept change'}
            </button>
            <button type="button" className="btn btn-lg" onClick={() => void reject()} data-testid="reject">
              Reject
            </button>
            {p.kind === 'rewrite' || p.kind === 'insert' ? (
              <button type="button" className="btn btn-lg" onClick={() => setEditing((v) => !v)} data-testid="edit-proposal">
                {editing ? 'Cancel edit' : 'Edit'}
              </button>
            ) : null}
            <button type="button" className="btn btn-lg" onClick={() => void tryAnother()}>
              <Icon name="refresh" size={14} /> Try another
            </button>
          </>
        )}
      </div>
    </section>
  );
}
