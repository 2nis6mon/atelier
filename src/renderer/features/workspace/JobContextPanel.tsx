import { useEffect, useMemo, useState } from 'react';
import { recordLabel, suggestLibraryRecords } from '../../../shared/ai/context';
import { extractRequirements } from '../../../shared/offer';
import type { AiRequestInput } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { toastError } from '../../state/app';
import { useAssistant } from '../../state/assistant';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';

export function JobContextPanel({ onRun }: { onRun: (r: AiRequestInput) => Promise<void> }) {
  const app = useWorkspace((s) => s.application)!;
  const doc = useWorkspace(selectDoc)!;
  const records = useWorkspace((s) => s.records);
  const aiRun = useWorkspace((s) => s.aiRun);
  const refresh = useWorkspace((s) => s.refreshApplication);
  const a = useAssistant();
  const [editOffer, setEditOffer] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [offer, setOffer] = useState(app.offerText);
  const [notes, setNotes] = useState(app.notes);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [useOffer, setUseOffer] = useState(true);
  const suggested = useMemo(() => suggestLibraryRecords(records, doc, app.offerText, 4), [records, doc, app.offerText]);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => setPicked(suggested.map((r) => r.id)), [suggested]);
  useEffect(() => {
    setOffer(app.offerText);
    setNotes(app.notes);
  }, [app.offerText, app.notes]);

  const save = async (patch: { offerText?: string; notes?: string }) => {
    try {
      await unwrap(api().applications.update(app.id, patch));
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const reloadLink = async () => {
    setLinkError(null);
    const r = await api().applications.fetchOffer(app.offerUrl);
    if (!r.ok) return setLinkError(r.message);
    setOffer(r.text);
    await save({ offerText: r.text });
  };

  const requirements = extractRequirements(app.offerText);

  return (
    <div className="assistant" data-testid="job-context">
      <div className="row">
        <div className="grow">
          <h2 className="section-title">Job context</h2>
          <p className="small muted">Saved job offer and notes for this application.</p>
        </div>
        <button type="button" className="btn btn-quiet btn-sm icon-btn" aria-label="Close job context" onClick={() => a.set({ panel: 'assistant' })}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="surface" style={{ padding: 12 }}>
        <div className="row">
          <span className="avatar" style={{ width: 30, height: 30 }}>{(app.company || '?').slice(0, 1)}</span>
          <span className="grow">
            <strong style={{ display: 'block' }}>{app.company}</strong>
            <span className="small muted">{app.role}</span>
          </span>
          <span className="small muted row" style={{ gap: 4 }}>
            <Icon name="calendar" size={12} /> {new Date(app.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        {app.offerUrl ? (
          <button type="button" className="link-btn small" style={{ marginTop: 6 }} onClick={() => void unwrap(api().app.openExternal(app.offerUrl)).catch(toastError)}>
            <Icon name="link" size={11} /> {app.offerUrl}
          </button>
        ) : null}

        <div className="row" style={{ marginTop: 10 }}>
          <strong className="grow small">Job description</strong>
          {app.offerUrl ? (
            <button type="button" className="btn btn-sm" onClick={() => void reloadLink()}>
              Reload
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => (editOffer ? (void save({ offerText: offer }), setEditOffer(false)) : setEditOffer(true))}>
            {editOffer ? 'Save' : 'Edit'}
          </button>
        </div>
        {editOffer ? (
          <textarea className="textarea" style={{ minHeight: 150, marginTop: 6 }} value={offer} onChange={(e) => setOffer(e.target.value)} aria-label="Job description" />
        ) : (
          <p className="small offer-preview">{app.offerText || 'No offer text yet. Click Edit to paste it.'}</p>
        )}
        {linkError ? (
          <div className="notice err" role="alert" style={{ marginTop: 6 }}>
            <Icon name="warning" size={14} />
            <span className="grow">{linkError}</span>
            <button type="button" className="btn btn-sm" onClick={() => { setLinkError(null); setEditOffer(true); }}>
              Paste text instead
            </button>
          </div>
        ) : null}

        {requirements.length ? (
          <>
            <strong className="small" style={{ display: 'block', marginTop: 10 }}>Key requirements</strong>
            <ul className="req-list">
              {requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="row" style={{ marginTop: 10 }}>
          <strong className="grow small">My notes</strong>
          <button type="button" className="btn btn-sm" onClick={() => (editNotes ? (void save({ notes }), setEditNotes(false)) : setEditNotes(true))}>
            {editNotes ? 'Save' : 'Edit'}
          </button>
        </div>
        {editNotes ? (
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="My notes" />
        ) : (
          <p className="small offer-preview">{app.notes || 'No notes yet.'}</p>
        )}
      </div>

      <div className="surface" style={{ padding: 12 }}>
        <strong className="small row" style={{ gap: 6 }}>
          <Icon name="info" size={13} /> Use this context to get suggestions
        </strong>
        <div className="context-chips">
          <span className="ctx-chip on">
            <Icon name="doc" size={14} /> Current CV
          </span>
          <button type="button" className={`ctx-chip ${useOffer ? 'on' : ''}`} aria-pressed={useOffer} onClick={() => setUseOffer(!useOffer)}>
            <Icon name="briefcase" size={14} /> Job offer
          </button>
          <span className={`ctx-chip ${picked.length ? 'on' : ''}`} title={picked.map((id) => recordLabel(records.find((r) => r.id === id)!)).join(', ')}>
            <Icon name="library" size={14} /> {picked.length ? `${picked.length} library record${picked.length > 1 ? 's' : ''}` : 'No library records'}
          </span>
        </div>
        {suggested.length ? (
          <div className="col" style={{ gap: 3, marginTop: 6 }}>
            {suggested.map((r) => (
              <label key={r.id} className="checkbox small">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                {recordLabel(r)}
                {r.lang !== doc.lang ? ` (${r.lang.toUpperCase()})` : ''}
              </label>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ width: '100%', marginTop: 10 }}
          disabled={Boolean(aiRun) || !app.offerText.trim()}
          onClick={() =>
            void onRun({
              action: useOffer ? 'adapt' : 'recover',
              scope: { type: 'cv', target: null, selectionText: '' },
              tone: null,
              targetLang: null,
              instructions: app.notes ? '' : '',
              includeOffer: useOffer,
              libraryRecordIds: picked,
            })
          }
          data-testid="suggest-adaptations"
        >
          <Icon name="sparkles" size={15} /> Suggest adaptations <Icon name="forward" size={14} />
        </button>
        <p className="small muted" style={{ marginTop: 6 }}>Nothing changes until you approve.</p>
      </div>
    </div>
  );
}
