import { useCallback, useEffect, useMemo, useState } from 'react';
import { lineDiff } from '../../../shared/diff';
import { documentToPlainText } from '../../../shared/document';
import { compareDocuments } from '../../../shared/versions';
import type { Application, CvDocument, CvVersion } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { CvPages, PAGE_W } from '../../cv/CvPages';
import { toast, toastError } from '../../state/app';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Confirm, Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';

type Selected = { kind: 'draft' } | { kind: 'version'; version: CvVersion };

export function VersionsMode({ cvId }: { cvId: string }) {
  const draft = useWorkspace(selectDoc)!;
  const cv = useWorkspace((s) => s.cv)!;
  const [versions, setVersions] = useState<CvVersion[]>([]);
  const [sel, setSel] = useState<Selected>({ kind: 'draft' });
  const [apps, setApps] = useState<Record<string, Application>>({});
  const [compare, setCompare] = useState<CvVersion | null>(null);
  const [restore, setRestore] = useState<CvVersion | null>(null);
  const [scale, setScale] = useState(0.8);

  const load = useCallback(async () => {
    const list = await api().versions.list(cvId);
    setVersions(list);
    const ids = [...new Set(list.map((v) => v.applicationId).filter(Boolean) as string[])];
    const loaded = await Promise.all(ids.map((id) => api().applications.get(id)));
    setApps(Object.fromEntries(loaded.filter(Boolean).map((a) => [a!.id, a!])));
    return list;
  }, [cvId]);

  useEffect(() => {
    void load().then((list) => {
      const firstSent = list.find((v) => v.kind === 'sent');
      if (firstSent) setSel({ kind: 'version', version: firstSent });
    });
  }, [load]);

  useEffect(() => {
    const el = document.querySelector('.versions-center');
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.4, Math.min(0.95, (el.clientWidth - 56) / PAGE_W))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown: CvDocument = sel.kind === 'draft' ? draft : sel.version.document;
  const v = sel.kind === 'version' ? sel.version : null;
  const app = v?.applicationId ? apps[v.applicationId] : null;

  const saveNow = async () => {
    try {
      await useWorkspace.getState().flush();
      await unwrap(api().versions.checkpoint(cvId));
      await load();
      toast({ kind: 'ok', text: 'Version saved.' });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <aside className="ws-left glass" aria-label="Versions" data-testid="versions-timeline">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 className="section-title grow">Versions</h2>
          <button type="button" className="btn btn-sm" onClick={() => void saveNow()} data-testid="save-version">
            <Icon name="plus" size={12} /> Save now
          </button>
        </div>
        <div className="col" style={{ gap: 4 }} role="listbox" aria-label="Versions">
          <button type="button" role="option" aria-selected={sel.kind === 'draft'} className="version-item" onClick={() => setSel({ kind: 'draft' })}>
            <Icon name="rewrite" size={15} />
            <span className="grow">
              <strong style={{ display: 'block' }}>Current draft</strong>
              <span className="small muted">Editable</span>
            </span>
          </button>
          {versions.map((ver) => (
            <button key={ver.id} type="button" role="option" aria-selected={v?.id === ver.id} className="version-item" onClick={() => setSel({ kind: 'version', version: ver })} data-testid="version-item">
              <Icon name={ver.locked ? 'lock' : 'versions'} size={15} />
              <span className="grow">
                <strong style={{ display: 'block' }}>{ver.label}</strong>
                <span className="small muted">
                  {ver.locked ? 'Sent · locked' : 'Saved'} · {new Date(ver.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </span>
            </button>
          ))}
          {versions.length === 0 ? <p className="small muted" style={{ padding: 8 }}>No saved versions yet. Mark an export as sent, or save a version now.</p> : null}
        </div>
      </aside>

      <div className="ws-canvas versions-center">
        <div className="ws-pages" style={{ width: PAGE_W * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_W }}>
            <CvPages doc={shown} />
          </div>
        </div>
      </div>

      <aside className="ws-right glass" aria-label="Version details" data-testid="version-details">
        {sel.kind === 'draft' ? (
          <div className="assistant">
            <h2 className="section-title">Current draft</h2>
            <p className="small muted">This is the version you edit. Sent versions are kept separately and never change.</p>
            <p className="small">
              Last saved {useWorkspace.getState().savedAt ? new Date(useWorkspace.getState().savedAt!).toLocaleString('en-GB') : '—'} · {cv.name}
            </p>
          </div>
        ) : v ? (
          <div className="assistant">
            <div className="row">
              <h2 className="section-title grow">{v.label}</h2>
              {v.locked ? (
                <span className="chip ok">
                  <Icon name="lock" size={11} /> Sent
                </span>
              ) : (
                <span className="chip">Saved</span>
              )}
            </div>
            <p className="small muted">{new Date(v.createdAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</p>
            {app ? (
              <div className="surface" style={{ padding: 10 }}>
                <strong>{app.company}</strong>
                <div className="small muted">{app.role}</div>
                {app.offerText ? <p className="small offer-preview" style={{ marginTop: 6 }}>{app.offerText}</p> : null}
                {app.notes ? <p className="small" style={{ marginTop: 6 }}><strong>Notes:</strong> {app.notes}</p> : null}
              </div>
            ) : null}
            {v.files.length ? (
              <div className="col" style={{ gap: 6 }}>
                <span className="label">Files sent (exact copies)</span>
                {v.files.map((f) => (
                  <div key={f.id} className="row">
                    <Icon name={f.kind === 'pdf' ? 'pdf' : 'word'} size={16} />
                    <span className="grow ellipsis small">{f.filename}</span>
                    <button type="button" className="btn btn-sm" onClick={() => void unwrap(api().versions.openSentFile(f.id)).catch(toastError)} data-testid={`open-sent-${f.kind}`}>
                      Open {f.kind === 'pdf' ? 'PDF' : 'Word'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" className="btn" onClick={() => setCompare(v)} data-testid="compare">
              <Icon name="compare" size={14} /> Compare with current draft
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setRestore(v)} data-testid="restore-version">
              Create new draft from this version
            </button>
            {v.locked ? (
              <p className="small muted row" style={{ gap: 6 }}>
                <Icon name="lock" size={12} /> Sent versions never change.
              </p>
            ) : (
              <button
                type="button"
                className="btn btn-quiet btn-danger btn-sm"
                onClick={async () => {
                  try {
                    await unwrap(api().versions.remove(v.id));
                    setSel({ kind: 'draft' });
                    void load();
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Delete this saved version
              </button>
            )}
          </div>
        ) : null}
      </aside>

      {compare ? <CompareDialog version={compare} draft={draft} onClose={() => setCompare(null)} /> : null}
      {restore ? (
        <Confirm
          title={`Create a new draft from ${restore.label}?`}
          message="Your current draft is saved as a version first, so nothing is lost. The selected version itself is not modified."
          confirmLabel="Create new draft"
          onCancel={() => setRestore(null)}
          onConfirm={async () => {
            try {
              await useWorkspace.getState().flush();
              await unwrap(api().versions.restoreAsDraft(cvId, restore.id));
              await useWorkspace.getState().open(cvId);
              await load();
              setSel({ kind: 'draft' });
              toast({ kind: 'ok', text: 'New draft created. Your previous draft was saved as a version.' });
            } catch (e) {
              toastError(e);
            }
            setRestore(null);
          }}
        />
      ) : null}
    </>
  );
}

function CompareDialog({ version, draft, onClose }: { version: CvVersion; draft: CvDocument; onClose: () => void }) {
  const changes = useMemo(() => compareDocuments(version.document, draft), [version, draft]);
  const lines = useMemo(() => lineDiff(documentToPlainText(version.document).split('\n'), documentToPlainText(draft).split('\n')), [version, draft]);
  const [view, setView] = useState<'summary' | 'text'>('summary');
  return (
    <Dialog title={`${version.label} → current draft`} subtitle={`${changes.length} difference${changes.length === 1 ? '' : 's'}`} onClose={onClose} testId="compare-dialog">
      <div className="row" style={{ marginBottom: 10 }}>
        <button type="button" className="filter-chip" aria-pressed={view === 'summary'} onClick={() => setView('summary')}>
          Summary
        </button>
        <button type="button" className="filter-chip" aria-pressed={view === 'text'} onClick={() => setView('text')}>
          Full text
        </button>
      </div>
      {view === 'summary' ? (
        <div className="col" style={{ gap: 6 }}>
          {changes.length === 0 ? <p className="muted">No differences.</p> : null}
          {changes.map((c, i) => (
            <div key={i} className="source-row" style={{ alignItems: 'flex-start' }}>
              <span className={`chip ${c.kind === 'removed' ? 'err' : c.kind === 'added' ? 'ok' : ''}`}>{c.kind}</span>
              <span className="grow small">
                <strong>{c.label}</strong>
                {c.before !== undefined ? (
                  <span style={{ display: 'block' }}>
                    <del className="diff-del">{c.before}</del> → <ins className="diff-ins">{c.after}</ins>
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="surface" style={{ padding: 12, fontSize: 12.5, lineHeight: 1.6 }}>
          {lines.map((l, i) => (
            <div key={i} className={l.type === 'added' ? 'diff-line-add' : l.type === 'removed' ? 'diff-line-del' : ''}>
              {l.type === 'added' ? '+ ' : l.type === 'removed' ? '− ' : '  '}
              {l.text || '\u00a0'}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
