import { useEffect, useState } from 'react';
import type { MenuCommand } from '../shared/api';
import { api } from './api';
import { navigate, useRoute } from './router';
import { effectiveReduceMotion, effectiveReduceTransparency, useApp } from './state/app';
import { commandBus } from './state/commands';
import { Toasts } from './ui/Toasts';
import { Shell } from './features/shell/Shell';
import { PrintView } from './features/print/PrintView';
import { Workspace } from './features/workspace/Workspace';
import { SettingsSheet } from './features/settings/SettingsSheet';
import { ImportSheet } from './features/import/ImportSheet';
import { Welcome } from './features/welcome/Welcome';

function useAccessibilityAttributes() {
  const reduceMotion = useApp(effectiveReduceMotion);
  const reduceTransparency = useApp(effectiveReduceTransparency);
  const platform = useApp((s) => s.info?.platform ?? 'unknown');
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.motion = reduceMotion ? 'reduce' : 'full';
    el.dataset.transparency = reduceTransparency ? 'reduce' : 'full';
    el.dataset.platform = platform;
  }, [reduceMotion, reduceTransparency, platform]);
}

export function App() {
  const route = useRoute();
  const [loaded, setLoaded] = useState(false);
  const load = useApp((s) => s.load);
  const settings = useApp((s) => s.settings);
  useAccessibilityAttributes();

  useEffect(() => {
    if (route.name === 'print') {
      setLoaded(true);
      return;
    }
    void load().then(() => setLoaded(true));
    const offMenu = api().app.onMenu((cmd: MenuCommand) => commandBus.emit(cmd));
    const offA11y = api().app.onAccessibilityChange((a) => useApp.getState().setSystemAccessibility(a));
    return () => {
      offMenu();
      offA11y();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore where the user left off (first load only).
  useEffect(() => {
    if (!loaded || route.name === 'print') return;
    if (!settings.onboardingDone) {
      if (route.name !== 'welcome') navigate({ name: 'welcome' }, { replace: true });
      return;
    }
    if (!window.location.hash && settings.lastRoute) window.location.replace(`#${settings.lastRoute}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Remember the current place.
  useEffect(() => {
    if (!loaded || route.name === 'print' || route.name === 'welcome') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && hash !== settings.lastRoute) void useApp.getState().updateSettings({ lastRoute: hash });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, loaded]);

  // Global commands that do not depend on the current view.
  useEffect(
    () =>
      commandBus.on((cmd) => {
        const s = useApp.getState();
        if (cmd === 'settings') s.openSettings('ai');
        else if (cmd === 'go-library') navigate({ name: 'library', tab: 'cvs' });
        else if (cmd === 'go-applications') navigate({ name: 'applications' });
        else if (cmd === 'import') s.setImportOpen(true);
        else if (cmd === 'new-application') navigate({ name: 'new-application', baseCvId: null });
        else if (cmd === 'backup' || cmd === 'restore') s.openSettings('storage');
        return false;
      }),
    [],
  );

  // Keyboard fallback for the same commands (menu accelerators do not see synthetic input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      const key = e.key.toLowerCase();
      let cmd: MenuCommand | null = null;
      if (key === 'z' && !inField) cmd = e.shiftKey ? 'redo' : 'undo';
      else if (key === 'y' && !inField && e.ctrlKey) cmd = 'redo';
      else if (key === 'b' && !inField) cmd = 'bold';
      else if (key === 'i' && !inField) cmd = 'italic';
      else if (key === ',') cmd = 'settings';
      else if (key === 'e' && !e.shiftKey) cmd = 'export';
      else if (key === 'o') cmd = 'import';
      else if (key === '1' && e.altKey) cmd = 'mode-content';
      else if (key === '2' && e.altKey) cmd = 'mode-layout';
      else if (key === '3' && e.altKey) cmd = 'mode-style';
      else if (key === '4' && e.altKey) cmd = 'mode-versions';
      else if (key === '1') cmd = 'go-library';
      else if (key === '2') cmd = 'go-applications';
      if (cmd) {
        e.preventDefault();
        commandBus.emit(cmd);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (route.name === 'print') return <PrintView token={route.token} />;
  if (!loaded) return <div className="boot" aria-busy="true" />;

  return (
    <>
      {route.name === 'welcome' ? <Welcome /> : route.name === 'workspace' ? <Workspace id={route.id} mode={route.mode} /> : <Shell route={route} />}
      <SettingsSheet />
      <ImportSheet />
      <Toasts />
    </>
  );
}
