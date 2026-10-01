import { useEffect, useState } from 'react';
import { api } from '../../api';
import { navigate, type Route } from '../../router';
import { useApp } from '../../state/app';
import { commandBus } from '../../state/commands';
import { Icon } from '../../ui/Icon';
import { LensTabs } from '../../ui/LensTabs';
import { ApplicationDossier } from '../applications/ApplicationDossier';
import { ApplicationsBoard } from '../applications/ApplicationsBoard';
import { NewApplication } from '../applications/NewApplication';
import { LibraryView } from '../library/LibraryView';
import { NewCvDialog } from '../library/NewCvDialog';

export function Shell({ route }: { route: Exclude<Route, { name: 'workspace' | 'print' | 'welcome' }> }) {
  const openSettings = useApp((s) => s.openSettings);
  const setImportOpen = useApp((s) => s.setImportOpen);
  const [newCv, setNewCv] = useState(false);
  const [counts, setCounts] = useState<{ cvs: number; sources: number; apps: number }>({ cvs: 0, sources: 0, apps: 0 });
  const area = route.name === 'library' ? 'library' : 'applications';
  const refreshKey = useApp((s) => `${s.importOpen}-${s.dataVersion}`);

  useEffect(() => {
    let alive = true;
    void Promise.all([api().cvs.list(), api().library.sources(), api().applications.list()]).then(([c, s, a]) => {
      if (alive) setCounts({ cvs: c.length, sources: s.length, apps: a.length });
    });
    return () => {
      alive = false;
    };
  }, [route, refreshKey]);

  useEffect(
    () =>
      commandBus.on((cmd) => {
        if (cmd === 'new-cv') {
          setNewCv(true);
          return true;
        }
        return false;
      }),
    [],
  );

  useEffect(() => {
    api().app.setWindowTitle(area === 'library' ? 'Atelier — Library' : 'Atelier — Applications');
  }, [area]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="traffic-space" />
        <div className="wordmark" aria-label="Atelier">
          Atelier
        </div>
        <nav className="topbar-center" aria-label="Main">
          <LensTabs
            label="Main sections"
            value={area}
            onChange={(v) => navigate(v === 'library' ? { name: 'library', tab: 'cvs' } : { name: 'applications' })}
            options={[
              { id: 'library', label: 'Library', icon: 'library', title: 'Library (⌘1)' },
              { id: 'applications', label: 'Applications', icon: 'briefcase', title: 'Applications (⌘2)' },
            ]}
          />
        </nav>
        <div className="topbar-actions">
          <button type="button" className="btn btn-glass" onClick={() => setImportOpen(true)} data-testid="open-import">
            <Icon name="import" size={15} />
            Import CVs
          </button>
          {area === 'library' ? (
            <button type="button" className="btn btn-primary" onClick={() => setNewCv(true)} data-testid="new-cv">
              <Icon name="plus" size={15} />
              New CV
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'new-application', baseCvId: null })} data-testid="new-application">
              <Icon name="plus" size={15} />
              New application
            </button>
          )}
          <button type="button" className="btn btn-glass icon-btn" onClick={() => openSettings('ai')} aria-label="Settings" title="Settings (⌘,)" data-testid="open-settings">
            <Icon name="gear" size={16} />
          </button>
        </div>
      </header>
      <main className="shell-main" id="main">
        {route.name === 'library' ? <LibraryView tab={route.tab} onNewCv={() => setNewCv(true)} /> : null}
        {route.name === 'applications' ? <ApplicationsBoard /> : null}
        {route.name === 'application' ? <ApplicationDossier id={route.id} /> : null}
        {route.name === 'new-application' ? <NewApplication baseCvId={route.baseCvId} /> : null}
      </main>
      <footer className="statusbar">
        <span className="row">
          <Icon name="backup" size={14} />
          Stored on this Mac
        </span>
        <span className="spacer" />
        <span>
          {area === 'library' ? `${counts.cvs} CV${counts.cvs === 1 ? '' : 's'} · ${counts.sources} source file${counts.sources === 1 ? '' : 's'}` : `${counts.apps} application${counts.apps === 1 ? '' : 's'}`}
        </span>
      </footer>
      {newCv ? <NewCvDialog onClose={() => setNewCv(false)} /> : null}
    </div>
  );
}
