// PDF rendering: a hidden window renders the same paginated CV component as
// the on-screen preview, then Chromium prints it to PDF (selectable text,
// embedded fonts, clickable links). Pages are pre-paginated by Atelier, so
// print margins are zero and every page is exactly one A4 sheet.

import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type PrintPayload, type PrintReadyInfo } from '../../shared/api';
import type { CvDocument } from '../../shared/types';
import { rendererUrl, secureWebContents } from './window';

const pending = new Map<string, { payload: PrintPayload; resolve: (i: PrintReadyInfo) => void }>();

export function registerPrintIpc(): void {
  ipcMain.handle('atelier:print.payload', (_e, token: string) => pending.get(String(token))?.payload ?? null);
  ipcMain.on(IPC.printReady, (_e, token: string, info: PrintReadyInfo) => {
    const p = pending.get(String(token));
    if (p) p.resolve({ pageCount: Number(info?.pageCount) || 1, tooTall: Number(info?.tooTall) || 0 });
  });
}

export function createPdfRenderer(preload: string) {
  return async (document: CvDocument): Promise<{ data: Uint8Array; pageCount: number }> => {
    const token = randomUUID();
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: false },
    });
    secureWebContents(win);
    try {
      const ready = new Promise<PrintReadyInfo>((resolve, reject) => {
        pending.set(token, { payload: { document }, resolve });
        setTimeout(() => reject(new Error('The PDF page did not finish rendering.')), 30_000);
      });
      await win.loadURL(rendererUrl(`/print/${token}`));
      const info = await ready;
      const data = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        generateTaggedPDF: true,
        generateDocumentOutline: false,
        displayHeaderFooter: false,
      });
      return { data: new Uint8Array(data), pageCount: info.pageCount };
    } finally {
      pending.delete(token);
      if (!win.isDestroyed()) win.destroy();
    }
  };
}
