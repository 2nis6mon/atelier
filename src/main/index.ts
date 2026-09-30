// Atelier — Electron main process bootstrap.

import { BrowserWindow, app, nativeTheme, systemPreferences } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppInfo } from '../shared/api';
import { IPC } from '../shared/api';
import { pagesAppPath } from './import/pagesConvert';
import { registerIpc } from './app/ipc';
import { buildMenu } from './app/menu';
import { createPdfRenderer, registerPrintIpc } from './app/printer';
import { handleAppProtocol, registerSchemePrivileges } from './app/protocol';
import { type Services, openServices } from './app/services';
import { applyMaterial, createMainWindow, preloadPath, reduceMotionSystem, reduceTransparencySystem, rendererUrl } from './app/window';

const E2E = process.env.ATELIER_E2E === '1';
app.setName('Atelier');
if (process.env.ATELIER_DATA_DIR) app.setPath('userData', process.env.ATELIER_DATA_DIR);

registerSchemePrivileges();

const distDir = join(__dirname, '..');
const rendererDir = join(distDir, 'renderer');
const dataRoot = app.getPath('userData');

let services: Services | null = null;
let mainWindow: BrowserWindow | null = null;

function reduceTransparency(): boolean {
  const pref = services?.store.getSettings().transparency ?? 'system';
  return pref === 'reduce' || (pref === 'system' && reduceTransparencySystem());
}

function info(): AppInfo {
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: process.getSystemVersion(),
    dataDir: dataRoot,
    reduceTransparency: reduceTransparency(),
    reduceMotion: reduceMotionSystem(),
    e2e: E2E,
    pagesAppAvailable: Boolean(pagesAppPath()),
    electron: process.versions.electron,
  };
}

function broadcastAccessibility(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    applyMaterial(w, reduceTransparency());
    w.webContents.send(IPC.accessibility, { reduceTransparency: reduceTransparency(), reduceMotion: reduceMotionSystem() });
  }
}

function openWindow(): void {
  mainWindow = createMainWindow({ preload: preloadPath(distDir), reduceTransparency: reduceTransparency() });
  void mainWindow.loadURL(rendererUrl());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!E2E && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    mkdirSync(dataRoot, { recursive: true });
    handleAppProtocol(rendererDir);
    const renderPdf = createPdfRenderer(preloadPath(distDir));
    services = openServices(dataRoot, renderPdf);
    registerPrintIpc();
    registerIpc({
      services: () => services!,
      reopen: () => {
        services = openServices(dataRoot, renderPdf);
        for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
      },
      dataRoot,
      info,
      applyAccessibility: broadcastAccessibility,
    });
    buildMenu();
    openWindow();
    nativeTheme.on('updated', broadcastAccessibility);
    if (process.platform === 'darwin') {
      systemPreferences.subscribeNotification('AppleInterfaceThemeChangedNotification', broadcastAccessibility);
      systemPreferences.subscribeNotification('NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification' as never, broadcastAccessibility);
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || E2E) app.quit();
  });

  app.on('will-quit', () => {
    try {
      services?.store.db.close();
    } catch {
      // already closed
    }
  });
}
