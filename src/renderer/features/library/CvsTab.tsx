import { useCallback, useEffect, useState } from 'react';
import type { Cv, CvSummary, SourceFile } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { CvThumb } from '../../cv/CvThumb';
import { navigate } from '../../router';
import { toast, toastError, useApp } from '../../state/app';
import { Confirm, Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { MenuButton } from '../../ui/Menu';
import { SourceIcon, relativeDate } from './SourcesTab';

export function CvsTab({ onNewCv }: { onNewCv: () => void }) {
  const [cvs, setCvs] = useState<CvSummary[] | null>(null);
  const [docs, setDocs] = useState<Record<string, Cv>>({});
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [rename, setRename] = useState<CvSummary | null>(null);
  const [remove, setRemove] = useState<CvSummary | null>(null);
  const setImportOpen = useApp((s) => s.setImportOpen);
  const importOpen = useApp((s) => s.importOpen);
  const dataVersion = useApp((s) => s.dataVersion);

  const load = useCallback(async () => {
    const list = await api().cvs.list();
    setCvs(list);
    setSources(await api().library.sources());
    const full = await Promise.all(list.map((c) => api().cvs.get(c.id)));
    setDocs(Object.fromEntries(full.filter(Boolean).map((c) => [c!.id, c!])));
  }, []);

  useEffect(() => {
    void load();
  }, [load, importOpen, dataVersion]);

  const duplicate = async (c: CvSummary) => {
    try {
      const copy = await unwrap(api().cvs.duplicate(c.id, `${c.name} (copy)`));
      toast({ kind: 'ok', text: `Duplicated as “${copy.name}”.` });
      void load();
    } catch (e) {
      toastError(e);
    }
  };

  if (cvs === null) return <div className="empty" aria-busy="true"><div className="spinner" /></div>;

  if (cvs.length === 0) {
    const hasLibrary = sources.length > 0;
    return (
      <div className="empty surface" style={{ padding: 56 }} data-testid="library-empty">
        <Icon name="doc" size={34} />
        <h2 className="display" style={{ fontSize: 24 }}>{hasLibrary ? 'No CVs yet' : 'Your library is empty'}</h2>
        <p style={{ maxWidth: 480 }}>
          {hasLibrary
            ? `Your library holds what was imported from ${sources.length} document${sources.length === 1 ? '' : 's'}. Create a CV from it — you choose the language and what to include.`
            : 'Import the CVs you already have (Word, PDF or Pages). Atelier keeps the originals and shows you everything it extracts before saving.'}
        </p>
        <div className="row">
          {hasLibrary ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={onNewCv} data-testid="create-first-cv">
              <Icon name="plus" /> Create a CV
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setImportOpen(true)} data-testid="import-first">
              <Icon name="import" /> Import first CV
            </button>
          )}
          {hasLibrary ? (
            <button type="button" className="btn btn-lg" onClick={() => setImportOpen(true)}>
              Import more
            </button>
          ) : (
            <button type="button" className="btn btn-lg" onClick={onNewCv}>
              Start from scratch
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cv-grid" data-testid="cv-grid">
        {cvs.map((c) => (
          <div
            key={c.id}
            className="cv-card"
            role="button"
            tabIndex={0}
            data-testid="cv-card"
            aria-label={`Open ${c.name}`}
            onClick={() => navigate({ name: 'workspace', id: c.id, mode: 'content' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate({ name: 'workspace', id: c.id, mode: 'content' });
              }
            }}
          >
            <div className="cv-card-menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <MenuButton
                label={`Actions for ${c.name}`}
                entries={[
                  { label: 'Open', icon: 'forward', onSelect: () => navigate({ name: 'workspace', id: c.id, mode: 'content' }) },
                  { label: 'Duplicate', icon: 'duplicate', onSelect: () => void duplicate(c) },
                  { label: 'Rename…', icon: 'rewrite', onSelect: () => setRename(c) },
                  { label: 'New application from this CV', icon: 'briefcase', onSelect: () => navigate({ name: 'new-application', baseCvId: c.id }) },
                  { kind: 'separator' },
                  { label: 'Delete…', icon: 'trash', danger: true, disabled: c.sentCount > 0, onSelect: () => setRemove(c) },
                ]}
              />
            </div>
            {docs[c.id] ? <CvThumb doc={docs[c.id].document} width={150} /> : <div className="cv-thumb" />}
            <h3 className="ellipsis">{c.name}</h3>
            <p className="small muted ellipsis" style={{ minHeight: 16 }}>{c.description || c.headline || '\u00a0'}</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="chip">{c.lang === 'fr' ? 'French' : 'English'}</span>
              {c.applicationId ? <span className="chip peach">Application draft</span> : null}
              {c.sentCount > 0 ? (
                <span className="chip ok">
                  <Icon name="lock" size={11} /> Sent ×{c.sentCount}
                </span>
              ) : null}
              {c.pendingProposals > 0 ? <span className="chip warn">{c.pendingProposals} to review</span> : null}
            </div>
          </div>
        ))}
        <button type="button" className="add-card" onClick={() => setImportOpen(true)}>
          <Icon name="plus" size={26} />
          <strong>Import CVs</strong>
          <span className="small muted">Add a new CV from your files</span>
        </button>
      </div>

      <section className="strip surface" aria-label="Recent sources">
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 className="section-title grow">Recent sources</h3>
          <button type="button" className="btn btn-sm" onClick={() => navigate({ name: 'library', tab: 'sources' })}>
            View all sources <Icon name="forward" size={13} />
          </button>
        </div>
        {sources.length === 0 ? (
          <p className="muted small">No original documents yet.</p>
        ) : (
          <div className="sources-grid">
            {sources.slice(0, 3).map((s) => (
              <div key={s.id} className="source-row">
                <SourceIcon format={s.format} />
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 600 }}>{s.filename}</div>
                  <div className="small muted">
                    Added {relativeDate(s.importedAt)} · {s.recordCount > 0 ? `${s.recordCount} records` : s.status === 'conversion-needed' ? 'Not imported' : 'No records yet'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {rename ? <RenameDialog cv={rename} onClose={() => setRename(null)} onDone={() => void load()} /> : null}
      {remove ? (
        <Confirm
          title={`Delete “${remove.name}”?`}
          message="The CV and its saved versions are deleted. Your library records and original documents are kept."
          confirmLabel="Delete CV"
          danger
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            try {
              await unwrap(api().cvs.remove(remove.id));
              toast({ kind: 'ok', text: 'CV deleted.' });
            } catch (e) {
              toastError(e);
            }
            setRemove(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function RenameDialog({ cv, onClose, onDone }: { cv: CvSummary; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(cv.name);
  const [description, setDescription] = useState(cv.description);
  const save = async () => {
    try {
      await unwrap(api().cvs.updateMeta(cv.id, { name, description }));
      onDone();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Dialog
      title="Rename CV"
      onClose={onClose}
      narrow
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="cv-name">Name</label>
          <input id="cv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="cv-desc">Description</label>
          <input id="cv-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Tailored for tech roles" />
        </div>
      </div>
    </Dialog>
  );
}
