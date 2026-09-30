import { BrowserWindow, nativeTheme, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { APP_ORIGIN } from './protocol';

export function reduceTransparencySystem(): boolean {
  try {
    return nativeTheme.prefersReducedTransparency;
  } catch {
    return false;
  }
}

export function reduceMotionSystem(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion;
  } catch {
    return false;
  }
}

/** Native material behind the window (macOS). Turned off when transparency is reduced. */
export function applyMaterial(win: BrowserWindow, reduceTransparency: boolean): void {
  if (process.platform !== 'darwin') return;
  if (reduceTransparency) {
    win.setVibrancy(null);
    win.setBackgroundColor('#F6F1E9');
  } else {
    win.setBackgroundColor('#00000000');
    win.setVibrancy('under-window');
  }
}

export function secureWebContents(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

export function createMainWindow(opts: { preload: string; reduceTransparency: boolean; bounds?: { width: number; height: number } }): BrowserWindow {
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: opts.bounds?.width ?? 1320,
    height: opts.bounds?.height ?? 880,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Atelier',
    ...(mac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 20, y: 22 },
          vibrancy: opts.reduceTransparency ? undefined : ('under-window' as const),
          visualEffectState: 'followWindow' as const,
          backgroundColor: opts.reduceTransparency ? '#F6F1E9' : '#00000000',
        }
      : { backgroundColor: '#F6F1E9' }),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  secureWebContents(win);
  win.once('ready-to-show', () => win.show());
  return win;
}

export function rendererUrl(hash = ''): string {
  return `${APP_ORIGIN}/index.html${hash ? `#${hash}` : ''}`;
}

export const preloadPath = (distDir: string) => join(distDir, 'preload', 'index.cjs');
