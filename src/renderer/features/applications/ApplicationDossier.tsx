import { useCallback, useEffect, useState } from 'react';
import { extractRequirements } from '../../../shared/offer';
import { STATUS_LABEL, allowedTransitions } from '../../../shared/status';
import type { AppEvent, Application, ConversationMessage, CvSummary, CvVersion } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { navigate } from '../../router';
import { toast, toastError } from '../../state/app';
import { Confirm } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { MenuButton } from '../../ui/Menu';
import { formatShortDate } from './ApplicationsBoard';

export function ApplicationDossier({ id }: { id: string }) {
  const [app, setApp] = useState<Application | null | undefined>(undefined);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [versions, setVersions] = useState<CvVersion[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [cvs, setCvs] = useState<CvSummary[]>([]);
  const [notes, setNotes] = useState('');
  const [offer, setOffer] = useState('');
  const [editingOffer, setEditingOffer] = useState(false);
  const [base, setBase] = useState('');
  const [remove, setRemove] = useState(false);

  const load = useCallback(async () => {
    const a = await api().applications.get(id);
    setApp(a);
    if (!a) return;
    setNotes(a.notes);
    setOffer(a.offerText);
    setEvents(await api().applications.events(id));
    const all = await api().cvs.list();
    setCvs(all);
    setBase(all.find((c) => !c.applicationId)?.id ?? '');
    if (a.cvId) {
      setVersions((await api().versions.list(a.cvId)).filter((v) => v.applicationId === id && v.kind === 'sent'));
      setMessages(await api().ai.messages(a.cvId));
    } else {
      setVersions([]);
      setMessages([]);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (app === undefined) return <div className="page"><div className="spinner" /></div>;
  if (app === null) return <div className="page empty">This application no longer exists.</div>;

  const save = async (patch: Partial<Application>) => {
    try {
      setApp(await unwrap(api().applications.update(app.id, patch)));
      setEvents(await api().applications.events(id));
    } catch (e) {
      toastError(e);
    }
  };

  const createDraft = async () => {
    try {
      const cv = await unwrap(api().applications.createDraft(app.id, base));
      navigate({ name: 'workspace', id: cv.id, mode: 'content' });
    } catch (e) {
      toastError(e);
    }
  };

  const requirements = extractRequirements(app.offerText);

  return (
    <div className="page" data-testid="dossier">
      <button type="button" className="btn btn-quiet" onClick={() => navigate({ name: 'applications' })} style={{ marginBottom: 10 }}>
        <Icon name="back" /> Applications
      </button>
      <div className="page-head">
        <span className="avatar" style={{ width: 52, height: 52, fontSize: 20 }}>{(app.company || '?').slice(0, 1)}</span>
        <div className="grow">
          <h1 className="display page-title" style={{ fontSize: 30 }}>{app.company || 'Company'}</h1>
          <p className="page-sub">{[app.role, app.location].filter(Boolean).join(' · ')}</p>
        </div>
        <label className="field" style={{ width: 170 }}>
          <span className="label">Status</span>
          <select
            className="select"
            value={app.status}
            aria-label="Status"
            data-testid="status-select"
            onChange={async (e) => {
              try {
                setApp(await unwrap(api().applications.setStatus(app.id, e.target.value as Application['status'])));
                setEvents(await api().applications.events(id));
              } catch (err) {
                toastError(err);
              }
            }}
          >
            <option value={app.status}>{STATUS_LABEL[app.status]}</option>
            {allowedTransitions(app.status).map((s) => (
              <option key={s} value={s}>
                → {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <MenuButton
          label="Application actions"
          entries={[{ label: 'Delete application…', icon: 'trash', danger: true, disabled: versions.length > 0, onSelect: () => setRemove(true) }]}
        />
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <section className="card surface" aria-label="Job offer">
            <div className="row">
              <h3 className="grow">Job offer</h3>
              {app.offerUrl ? (
                <button type="button" className="btn btn-sm" onClick={() => void unwrap(api().app.openExternal(app.offerUrl)).catch(toastError)}>
                  <Icon name="external" size={13} /> Open link
                </button>
              ) : null}
              <button type="button" className="btn btn-sm" onClick={() => setEditingOffer((v) => !v)}>
                {editingOffer ? 'Done' : 'Edit'}
              </button>
            </div>
            <p className="small muted" style={{ marginBottom: 8 }}>
              Saved {formatShortDate(app.createdAt)}
              {app.offerFileName ? ` · file: ${app.offerFileName}` : ''}
              {app.offerUrl ? ` · ${app.offerUrl}` : ''}
            </p>
            {editingOffer ? (
              <textarea className="textarea" style={{ minHeight: 220 }} value={offer} onChange={(e) => setOffer(e.target.value)} onBlur={() => offer !== app.offerText && void save({ offerText: offer })} aria-label="Job offer text" />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 280, overflow: 'auto', fontSize: 13 }}>{app.offerText || <span className="muted">No offer text saved.</span>}</div>
            )}
            {requirements.length ? (
              <>
                <div className="label" style={{ marginTop: 12 }}>Key requirements (as written in the offer)</div>
                <ul className="req-list">
                  {requirements.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="card surface" aria-label="My notes">
            <h3>My notes</h3>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== app.notes && void save({ notes })} placeholder="What to highlight, contacts, interview dates…" aria-label="My notes" />
          </section>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card glass" aria-label="CV for this application">
            <h3>CV for this application</h3>
            {app.cvId ? (
              <div className="row" style={{ marginTop: 8 }}>
                <Icon name="doc" size={20} />
                <span className="grow">{cvs.find((c) => c.id === app.cvId)?.name ?? 'Draft'}</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate({ name: 'workspace', id: app.cvId!, mode: 'content' })} data-testid="open-workspace">
                  Open workspace
                </button>
              </div>
            ) : (
              <div className="col" style={{ marginTop: 8 }}>
                <select className="select" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base CV">
                  {cvs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary btn-sm" disabled={!base} onClick={() => void createDraft()} style={{ alignSelf: 'flex-start' }}>
                  Create draft from this CV
                </button>
              </div>
            )}
          </section>

          <section className="card glass" aria-label="Sent versions">
            <h3>Sent versions</h3>
            {versions.length === 0 ? <p className="small muted">Nothing marked as sent yet. Export, send the files yourself, then “Mark as sent”.</p> : null}
            {versions.map((v) => (
              <div key={v.id} className="surface" style={{ padding: 10, marginTop: 8 }} data-testid="sent-version">
                <div className="row">
                  <Icon name="lock" size={14} />
                  <strong className="grow">{v.label}</strong>
                  <span className="small muted">{new Date(v.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
                <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  {v.files.map((f) => (
                    <button key={f.id} type="button" className="btn btn-sm" onClick={() => void unwrap(api().versions.openSentFile(f.id)).catch(toastError)}>
                      <Icon name={f.kind === 'pdf' ? 'pdf' : 'word'} size={13} /> Open {f.kind === 'pdf' ? 'PDF' : 'Word'}
                    </button>
                  ))}
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => app.cvId && navigate({ name: 'workspace', id: app.cvId, mode: 'versions' })}>
                    View in Versions
                  </button>
                </div>
              </div>
            ))}
            <p className="small muted" style={{ marginTop: 8 }}>
              <Icon name="lock" size={11} /> Sent versions never change.
            </p>
          </section>

          <section className="card glass" aria-label="History">
            <h3>History</h3>
            <div className="timeline" style={{ marginTop: 6 }}>
              {events.map((e) => (
                <div key={e.id} className="timeline-item">
                  <span className="grow">{e.message}</span>
                  <span className="muted nowrap">{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card glass" aria-label="Assistant conversations">
            <h3>Assistant conversations</h3>
            {messages.length === 0 ? <p className="small muted">No AI requests for this application yet.</p> : null}
            {messages.slice(-6).map((m) => (
              <p key={m.id} className="small" style={{ marginTop: 6 }}>
                <strong>{m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Assistant' : 'Notice'}:</strong> {m.text}
              </p>
            ))}
          </section>
        </div>
      </div>
      {remove ? (
        <Confirm
          title="Delete this application?"
          message="The application, its offer and notes are deleted. Its CV draft stays in your library."
          confirmLabel="Delete"
          danger
          onCancel={() => setRemove(false)}
          onConfirm={async () => {
            try {
              await unwrap(api().applications.remove(app.id));
              toast({ kind: 'ok', text: 'Application deleted.' });
              navigate({ name: 'applications' });
            } catch (e) {
              toastError(e);
              setRemove(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
