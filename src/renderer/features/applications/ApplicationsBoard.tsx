import { useCallback, useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { STATUSES, STATUS_HINT, STATUS_LABEL, allowedTransitions, canTransition } from '../../../shared/status';
import type { AppStatus, ApplicationSummary, CvSummary } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { navigate } from '../../router';
import { toast, toastError, useApp } from '../../state/app';
import { Icon } from '../../ui/Icon';
import { MenuButton, type MenuEntry } from '../../ui/Menu';

type Filter = AppStatus | 'all';

export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function ApplicationsBoard() {
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null);
  const [cvs, setCvs] = useState<CvSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<AppStatus | null>(null);
  const setImportOpen = useApp((s) => s.setImportOpen);

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([api().applications.list(), api().cvs.list()]);
    setApps(a);
    setCvs(c);
  }, []);
  const dataVersion = useApp((s) => s.dataVersion);
  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const move = async (app: ApplicationSummary, to: AppStatus) => {
    if (app.status === to) return;
    if (!canTransition(app.status, to)) {
      toast({ kind: 'err', text: `An application cannot move from ${STATUS_LABEL[app.status]} to ${STATUS_LABEL[to]}.` });
      return;
    }
    try {
      await unwrap(api().applications.setStatus(app.id, to));
      toast({ kind: 'ok', text: `${app.company || app.role} moved to ${STATUS_LABEL[to]}.` });
      void load();
    } catch (e) {
      toastError(e);
    }
  };

  const duplicateDraft = async (app: ApplicationSummary) => {
    if (!app.cvId) return toast({ kind: 'info', text: 'This application has no draft yet.' });
    try {
      const copy = await unwrap(api().cvs.duplicate(app.cvId, `${app.role || 'CV'} · ${app.company} (copy)`));
      toast({ kind: 'ok', text: `Draft duplicated as “${copy.name}”.` });
    } catch (e) {
      toastError(e);
    }
  };

  const columns = useMemo(() => (filter === 'all' ? STATUSES : STATUSES.filter((s) => s === filter)), [filter]);
  const bases = cvs.filter((c) => !c.applicationId).slice(0, 2);

  if (!apps) return <div className="page"><div className="spinner" /></div>;

  const cardMenu = (a: ApplicationSummary): MenuEntry[] => [
    { label: 'Open workspace', icon: 'forward', disabled: !a.cvId, onSelect: () => a.cvId && navigate({ name: 'workspace', id: a.cvId, mode: 'content' }) },
    { label: 'Duplicate draft', icon: 'duplicate', disabled: !a.cvId, onSelect: () => void duplicateDraft(a) },
    { label: 'View history', icon: 'versions', onSelect: () => navigate({ name: 'application', id: a.id }) },
    { kind: 'separator' },
    { kind: 'label', label: 'Move to' },
    ...allowedTransitions(a.status).map((s) => ({ label: STATUS_LABEL[s], icon: 'right', onSelect: () => void move(a, s), testId: `move-${s}` })),
  ];

  const onCardKey = (e: KeyboardEvent, a: ApplicationSummary) => {
    if (e.key === 'Enter') navigate({ name: 'application', id: a.id });
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const idx = STATUSES.indexOf(a.status);
      const options = allowedTransitions(a.status);
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      for (let i = idx + dir; i >= 0 && i < STATUSES.length; i += dir) {
        if (options.includes(STATUSES[i])) return void move(a, STATUSES[i]);
      }
    }
  };

  const onDrop = (e: DragEvent, status: AppStatus) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/atelier-app');
    const app = apps.find((x) => x.id === id);
    if (app) void move(app, status);
    setDragging(null);
  };

  return (
    <div className="page" data-testid="applications">
      <div className="page-head">
        <div className="grow">
          <h1 className="display page-title">A place for every opportunity.</h1>
          <p className="page-sub">Your CVs, applications and sent versions, together.</p>
        </div>
      </div>

      <h2 className="section-title" style={{ marginBottom: 10 }}>Your starting points</h2>
      <div className="starts">
        {bases.map((c) => (
          <button key={c.id} type="button" className="start-card" onClick={() => navigate({ name: 'new-application', baseCvId: c.id })}>
            <span className="source-icon"><Icon name="doc" size={18} /></span>
            <span className="grow">
              <strong style={{ display: 'block' }}>{c.name}</strong>
              <span className="small muted">{c.description || (c.lang === 'fr' ? 'French' : 'English')}</span>
            </span>
          </button>
        ))}
        <button type="button" className="start-card dashed" onClick={() => setImportOpen(true)}>
          <span className="source-icon"><Icon name="plus" size={18} /></span>
          <span className="grow">
            <strong style={{ display: 'block' }}>Import</strong>
            <span className="small muted">Add another CV</span>
          </span>
        </button>
      </div>

      <div className="filters" role="group" aria-label="Filter by status">
        <select className="select" style={{ width: 150 }} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Status filter">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {STATUSES.map((s) => (
          <button key={s} type="button" className="filter-chip" aria-pressed={filter === s} onClick={() => setFilter(filter === s ? 'all' : s)} title={STATUS_HINT[s]}>
            {STATUS_LABEL[s]} <span className="count">{apps.filter((a) => a.status === s).length}</span>
          </button>
        ))}
      </div>

      {apps.length === 0 ? (
        <div className="empty surface" style={{ padding: 48 }}>
          <Icon name="briefcase" size={30} />
          <h2 className="display" style={{ fontSize: 22 }}>No applications yet</h2>
          <p>Start from a job offer and one of your CVs. Atelier creates a separate draft; your CV stays unchanged.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'new-application', baseCvId: null })}>
            <Icon name="plus" /> New application
          </button>
        </div>
      ) : (
        <div className="board" data-testid="board">
          {columns.map((status) => {
            const list = apps.filter((a) => a.status === status);
            return (
              <section
                key={status}
                className={`column ${over === status ? 'drop-target' : ''}`}
                aria-label={`${STATUS_LABEL[status]}, ${list.length} applications`}
                data-status={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => setOver((o) => (o === status ? null : o))}
                onDrop={(e) => onDrop(e, status)}
              >
                <div className="column-head">
                  <h3 className="grow">{STATUS_LABEL[status]}</h3>
                  <span className="count">{list.length}</span>
                </div>
                {list.map((a) => (
                  <article
                    key={a.id}
                    className={`app-card ${dragging === a.id ? 'dragging' : ''}`}
                    tabIndex={0}
                    draggable
                    aria-label={`${a.company}, ${a.role}. ${STATUS_LABEL[a.status]}. Press Enter to open, Alt and arrow keys to move.`}
                    data-testid="app-card"
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/atelier-app', a.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(a.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onKeyDown={(e) => onCardKey(e, a)}
                    onDoubleClick={() => navigate({ name: 'application', id: a.id })}
                  >
                    <div className="row">
                      <span className="avatar">{(a.company || a.role || '?').slice(0, 1).toUpperCase()}</span>
                      <button type="button" className="grow link-btn" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => navigate({ name: 'application', id: a.id })}>
                        <strong style={{ display: 'block', fontSize: 14 }}>{a.company || 'Company'}</strong>
                        <span className="small muted">{a.role}</span>
                      </button>
                      <MenuButton label={`Actions for ${a.company}`} entries={cardMenu(a)} testId="app-card-menu" />
                    </div>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                      {a.lastSentAt ? <span className="chip">Sent {formatShortDate(a.lastSentAt)}</span> : <span className="chip">{a.lang === 'fr' ? 'French' : 'English'}{a.status === 'preparing' ? ' · Draft' : ''}</span>}
                      {a.lastSentFiles.length ? <span className="small muted row" style={{ gap: 4 }}><Icon name="file" size={12} /> {a.lastSentFiles.map((f) => f.toUpperCase()).join(' · ')}</span> : null}
                    </div>
                    {a.pendingProposals > 0 ? (
                      <span className="suggest row">
                        <Icon name="sparkles" size={13} /> {a.pendingProposals} suggestion{a.pendingProposals > 1 ? 's' : ''} to review
                      </span>
                    ) : null}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
