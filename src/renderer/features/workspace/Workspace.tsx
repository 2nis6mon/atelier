import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AiRequestInput } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { navigate, type WorkspaceMode } from '../../router';
import { useAssistant } from '../../state/assistant';
import { commandBus } from '../../state/commands';
import { toast, toastError, useApp } from '../../state/app';
import { selectDoc, selectRedo, selectUndo, useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { LensTabs } from '../../ui/LensTabs';
import { MenuButton } from '../../ui/Menu';
import { AssistantPanel } from './AssistantPanel';
import { Canvas, applyInlineStyle } from './Canvas';
import { ExportSheet } from './ExportSheet';
import { JobContextPanel } from './JobContextPanel';
import { LayoutPanel } from './LayoutPanel';
import { ReviewOverlay } from './ReviewPanel';
import { SectionsPalette } from './SectionsPalette';
import { StylePanel } from './StylePanel';
import { VersionsMode } from './VersionsMode';
import { createTranslatedVersion } from './translateVersion';

const MODES: Array<{ id: WorkspaceMode; label: string; icon: string; title: string }> = [
  { id: 'content', label: 'Content', icon: 'content', title: 'Content (⌥⌘1)' },
  { id: 'layout', label: 'Layout', icon: 'layout', title: 'Layout (⌥⌘2)' },
  { id: 'style', label: 'Style', icon: 'style', title: 'Style (⌥⌘3)' },
  { id: 'versions', label: 'Versions', icon: 'versions', title: 'Versions (⌥⌘4)' },
];

function SaveStatus() {
  const state = useWorkspace((s) => s.saveState);
  const error = useWorkspace((s) => s.saveError);
  const flush = useWorkspace((s) => s.flush);
  const reload = useWorkspace((s) => s.reloadFromDisk);
  if (state === 'error')
    return (
      <span className="save-status err" role="alert">
        Not saved — {error}{' '}
        <button type="button" className="link-btn" onClick={() => void flush()}>
          Retry
        </button>
      </span>
    );
  if (state === 'conflict')
    return (
      <span className="save-status err" role="alert">
        Changed elsewhere.{' '}
        <button type="button" className="link-btn" onClick={() => void reload()}>
          Reload
        </button>
      </span>
    );
  return (
    <span className="save-status" aria-live="polite" data-testid="save-status">
      {state === 'saving' || state === 'dirty' ? 'Saving…' : 'Saved on this Mac'}
    </span>
  );
}

export function Workspace({ id, mode }: { id: string; mode: WorkspaceMode }) {
  const open = useWorkspace((s) => s.open);
  const close = useWorkspace((s) => s.close);
  const cv = useWorkspace((s) => s.cv);
  const cvId = useWorkspace((s) => s.cvId);
  const doc = useWorkspace(selectDoc);
  const application = useWorkspace((s) => s.application);
  const recovery = useWorkspace((s) => s.recovery);
  const reviewIndex = useWorkspace((s) => s.reviewIndex);
  const undoInfo = useWorkspace(useShallow(selectUndo));
  const redoInfo = useWorkspace(useShallow(selectRedo));
  const panel = useAssistant((s) => s.panel);
  const [exporting, setExporting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth > 960);
  const settingsOpen = useApp((s) => s.settingsOpen);

  useEffect(() => {
    void open(id);
    return () => {
      void close();
    };
  }, [id, open, close]);

  useEffect(() => {
    if (cv) api().app.setWindowTitle(`${cv.name} — Atelier`);
  }, [cv]);

  const setMode = useCallback((m: WorkspaceMode) => navigate({ name: 'workspace', id, mode: m }, { replace: true }), [id]);

  const runAi = useCallback(
    async (req: AiRequestInput) => {
      const ok = await useWorkspace.getState().runAi(req);
      if (!ok && useWorkspace.getState().aiError?.code === 'not-configured') {
        toast({ kind: 'err', text: 'Connect an AI provider first. Your draft is unchanged.', action: { label: 'AI settings', run: () => useApp.getState().openSettings('ai') } });
      }
    },
    [],
  );

  const quickAction = useCallback(
    (action: 'rewrite' | 'translate', path: string, text: string) => {
      const a = useAssistant.getState();
      const lang = useWorkspace.getState().history?.present.lang ?? 'fr';
      a.set({ scope: 'selection', action, panel: 'assistant' });
      void runAi({
        action,
        scope: { type: 'selection', target: path, selectionText: text },
        tone: action === 'rewrite' ? a.tone : null,
        targetLang: action === 'translate' ? (lang === 'fr' ? 'en' : 'fr') : null,
        instructions: '',
        includeOffer: false,
        libraryRecordIds: [],
      });
    },
    [runAi],
  );

  // Menu & keyboard commands
  useEffect(
    () =>
      commandBus.on((cmd) => {
        const ws = useWorkspace.getState();
        const t = document.activeElement as HTMLElement | null;
        const inPlainField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.classList.contains('cv-editable');
        switch (cmd) {
          case 'undo':
            if (inPlainField) document.execCommand('undo');
            else ws.undo();
            return true;
          case 'redo':
            if (inPlainField) document.execCommand('redo');
            else ws.redo();
            return true;
          case 'bold':
          case 'italic':
            applyInlineStyle(cmd);
            return true;
          case 'export':
            setExporting(true);
            return true;
          case 'mode-content':
          case 'mode-layout':
          case 'mode-style':
          case 'mode-versions':
            setMode(cmd.slice(5) as WorkspaceMode);
            return true;
          case 'go-library':
          case 'go-applications':
            void ws.flush();
            return false;
          default:
            return false;
        }
      }),
    [setMode],
  );

  const back = async () => {
    await useWorkspace.getState().flush();
    if (application) navigate({ name: 'application', id: application.id });
    else navigate({ name: 'library', tab: 'cvs' });
  };

  if (cvId === id && !cv) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <p>This CV no longer exists.</p>
        <button type="button" className="btn" onClick={() => navigate({ name: 'library', tab: 'cvs' })}>
          Back to Library
        </button>
      </div>
    );
  }
  if (!cv || !doc) return <div className="empty" style={{ height: '100%' }}><div className="spinner" /></div>;

  const editable = mode === 'content' && reviewIndex === null;
  const right =
    mode === 'content' ? (panel === 'job' && application ? <JobContextPanel onRun={runAi} /> : <AssistantPanel onRun={runAi} />) : mode === 'layout' ? <LayoutPanel /> : mode === 'style' ? <StylePanel /> : null;

  return (
    <div className={`ws mode-${mode}`} data-testid="workspace">
      <header className="ws-top">
        <div className="traffic-space" />
        <button type="button" className="btn btn-quiet" onClick={() => void back()} data-testid="back">
          <Icon name="back" size={16} /> {application ? 'Application' : 'Library'}
        </button>
        <div className="ws-title">
          <strong className="ellipsis" data-testid="cv-title">{cv.name}</strong>
          <SaveStatus />
        </div>
        <div className="row" style={{ justifySelf: 'end' }}>
          <button type="button" className="btn btn-glass btn-sm icon-btn" aria-label={undoInfo.label ? `Undo ${undoInfo.label}` : 'Undo'} title={undoInfo.label ? `Undo ${undoInfo.label} (⌘Z)` : 'Undo (⌘Z)'} disabled={!undoInfo.can} onClick={() => useWorkspace.getState().undo()} data-testid="undo">
            <Icon name="undo" size={15} />
          </button>
          <button type="button" className="btn btn-glass btn-sm icon-btn" aria-label={redoInfo.label ? `Redo ${redoInfo.label}` : 'Redo'} title="Redo (⇧⌘Z)" disabled={!redoInfo.can} onClick={() => useWorkspace.getState().redo()} data-testid="redo">
            <Icon name="redo" size={15} />
          </button>
          <MenuButton
            label="CV actions"
            className="btn btn-glass btn-sm icon-btn"
            entries={[
              { label: `Create ${doc.lang === 'fr' ? 'English' : 'French'} version…`, icon: 'translate', onSelect: () => void createTranslatedVersion(cv, doc, runAi) },
              { label: 'Save a version now', icon: 'versions', onSelect: async () => { try { await useWorkspace.getState().flush(); await unwrap(api().versions.checkpoint(cv.id)); toast({ kind: 'ok', text: 'Version saved.' }); } catch (e) { toastError(e); } } },
              { label: 'Settings', icon: 'gear', onSelect: () => useApp.getState().openSettings('ai') },
            ]}
          />
          <button type="button" className="btn btn-primary" onClick={() => setExporting(true)} data-testid="export">
            <Icon name="export" size={15} /> Export
          </button>
        </div>
      </header>

      {application ? (
        <div className="job-chip-row">
          <button type="button" className="job-chip glass" onClick={() => useAssistant.getState().set({ panel: panel === 'job' ? 'assistant' : 'job' })} aria-pressed={panel === 'job'} data-testid="job-chip">
            <span className="avatar" style={{ width: 22, height: 22, fontSize: 11 }}>{(application.company || '?').slice(0, 1)}</span>
            <strong>{application.company}</strong>
            <span className="muted">· {application.role}</span>
            <span className="link-like">{panel === 'job' ? 'Hide job' : 'View job'}</span>
          </button>
        </div>
      ) : null}

      {recovery ? (
        <div className="notice warn ws-recovery" role="alert">
          <Icon name="warning" size={15} />
          <span className="grow">Unsaved changes from {new Date(recovery.at).toLocaleString('en-GB')} were found (the app closed before saving).</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => useWorkspace.getState().acceptRecovery()}>
            Recover them
          </button>
          <button type="button" className="btn btn-sm" onClick={() => useWorkspace.getState().discardRecovery()}>
            Discard
          </button>
        </div>
      ) : null}

      <div className={`ws-body ${paletteOpen ? '' : 'palette-closed'} ${right ? '' : 'no-right'}`}>
        {mode === 'versions' ? (
          <VersionsMode cvId={cv.id} />
        ) : (
          <>
            <aside className="ws-left glass" aria-label="Sections">
              <SectionsPalette mode={mode} onClose={() => setPaletteOpen(false)} />
            </aside>
            {!paletteOpen ? (
              <button type="button" className="btn btn-glass palette-toggle" onClick={() => setPaletteOpen(true)}>
                <Icon name="layout" size={15} /> Sections
              </button>
            ) : null}
            <Canvas
              doc={doc}
              editable={editable}
              onRewrite={(p, t) => quickAction('rewrite', p, t)}
              onTranslate={(p, t) => quickAction('translate', p, t)}
              overlay={mode === 'content' && reviewIndex !== null ? <ReviewOverlay onRun={runAi} /> : null}
            />
            {right ? (
              <aside className="ws-right glass" aria-label={mode === 'content' ? 'Assistant' : mode === 'layout' ? 'Layout' : 'Style'}>
                {right}
              </aside>
            ) : null}
          </>
        )}
        <div className="ws-dock-wrap">
          <LensTabs variant="dock" label="Workspace mode" value={mode} onChange={setMode} options={MODES} idPrefix="dock" />
        </div>
        <p className="ws-foot left small muted">Nothing changes until you approve.</p>
      </div>
      {exporting && !settingsOpen ? <ExportSheet onClose={() => setExporting(false)} /> : null}
    </div>
  );
}
