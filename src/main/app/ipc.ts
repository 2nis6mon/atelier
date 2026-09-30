// IPC handlers: thin, validating wrappers around the services. Every channel
// is "atelier:<namespace>.<method>". Errors are returned as values.

import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { toErrorInfo } from '../../shared/ai/errors';
import type { AppInfo, BackupInspectionView, OfferFetchView, Result } from '../../shared/api';
import { IPC } from '../../shared/api';
import { buildDocumentFromLibrary, emptyDocument, newId } from '../../shared/document';
import { htmlFragmentToText } from '../../shared/offer';
import { STATUSES } from '../../shared/status';
import type { AppStatus, Lang, ProviderId, RecordKind, Settings, TemplateId } from '../../shared/types';
import { DEFAULT_SETTINGS, LANGS, RECORD_KINDS } from '../../shared/types';
import { StoreError } from '../db/store';
import { extractDocx } from '../import/docx';
import { fetchOffer } from '../import/offerFetch';
import { PagesConversionError, convertPagesToDocx, pagesAppPath } from '../import/pagesConvert';
import { extractPdf } from '../import/pdf';
import { BACKUP_EXTENSION, buildDataDirFromBackup, inspectBackup, mergeBackup, swapDataDir, writeBackupFile } from '../storage/backup';
import type { Services } from './services';
import { applyMaterial } from './window';

type Handler = (...args: never[]) => unknown;

const ID_RE = /^[\w-]{1,80}$/;
function id(v: unknown): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new StoreError('invalid', 'Invalid identifier');
  return v;
}
function str(v: unknown, max = 200_000): string {
  if (typeof v !== 'string') throw new StoreError('invalid', 'Invalid text');
  return v.slice(0, max);
}
function lang(v: unknown): Lang {
  if (!LANGS.includes(v as Lang)) throw new StoreError('invalid', 'Invalid language');
  return v as Lang;
}

export function errorOf(e: unknown): { code: string; message: string; detail?: string } {
  if (e instanceof StoreError) return { code: e.code, message: e.message };
  const err = e as { code?: string; message?: string; detail?: string[] | string; name?: string };
  if (err?.name === 'AiError') {
    const info = toErrorInfo(e);
    return { code: info.code, message: info.message, detail: info.detail };
  }
  if (err?.name === 'ExportError' || err?.name === 'PagesConversionError' || err?.name === 'ValidationError' || err?.name === 'ImmutableVersionError') {
    return { code: String(err.code ?? err.name), message: String(err.message), detail: Array.isArray(err.detail) ? err.detail.join('\n') : err.detail };
  }
  return { code: 'error', message: String(err?.message ?? e) };
}

async function wrap<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}

export interface IpcContext {
  services: () => Services;
  reopen: () => void;
  dataRoot: string;
  info: () => AppInfo;
  applyAccessibility: () => void;
}

export function registerIpc(ctx: IpcContext): void {
  const s = () => ctx.services();
  const on = (name: string, fn: Handler) => ipcMain.handle(`atelier:${name}`, (_e: IpcMainInvokeEvent, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));
  const win = (e?: IpcMainInvokeEvent) => (e ? BrowserWindow.fromWebContents(e.sender) : BrowserWindow.getFocusedWindow()) ?? BrowserWindow.getAllWindows()[0];

  // ------------------------------------------------------------------ app
  on('app.info', () => ctx.info());
  on('app.openExternal', (url: string) =>
    wrap(async () => {
      const u = new URL(str(url, 2000));
      if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) throw new StoreError('invalid', 'Only web and mail links can be opened.');
      await shell.openExternal(u.toString());
    }),
  );
  on('app.revealDataFolder', () => shell.openPath(ctx.dataRoot));
  ipcMain.on(IPC.setTitle, (e, title: string) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && typeof title === 'string') w.setTitle(title.slice(0, 200));
  });

  // ------------------------------------------------------------- settings
  on('settings.get', () => s().store.getSettings());
  on('settings.update', (patch: Partial<Settings>) =>
    wrap(() => {
      const clean: Partial<Settings> = {};
      for (const [k, v] of Object.entries(patch ?? {})) if (k in DEFAULT_SETTINGS) (clean as Record<string, unknown>)[k] = v;
      const next = s().store.updateSettings(clean);
      if ('transparency' in clean || 'motion' in clean) ctx.applyAccessibility();
      return next;
    }),
  );

  // -------------------------------------------------------------- library
  on('library.records', (kind?: RecordKind) => s().store.listRecords(kind && RECORD_KINDS.includes(kind) ? kind : undefined));
  on('library.createRecord', (input: { kind: RecordKind; lang: Lang; data: Record<string, unknown> }) =>
    wrap(() => s().store.createRecord({ kind: input.kind, lang: lang(input.lang), data: input.data ?? {}, fieldSources: {} })),
  );
  on('library.updateRecord', (rid: string, data: Record<string, unknown>, l?: Lang) =>
    wrap(() => {
      const r = s().store.updateRecord(id(rid), { data: data ?? {}, lang: l ? lang(l) : undefined });
      // Manual edits are marked as coming from the user.
      const fs: Record<string, { user: true }> = {};
      for (const k of Object.keys(data ?? {})) fs[k] = { user: true };
      return s().store.updateRecord(r.id, { fieldSources: fs });
    }),
  );
  on('library.deleteRecord', (rid: string) => wrap(() => s().store.deleteRecord(id(rid))));
  on('library.usage', (rid: string) => s().store.recordUsage(id(rid)));
  on('library.mergeRecords', (keep: string, remove: string[], data: Record<string, unknown>, fieldSources: Record<string, never>) =>
    wrap(() => s().store.mergeRecords(id(keep), (remove ?? []).map(id), data ?? {}, fieldSources ?? {})),
  );
  on('library.sources', () => s().store.listSources());
  on('library.deleteSource', (sid: string) => wrap(() => s().store.deleteSource(id(sid))));
  on('library.openSource', (sid: string) =>
    wrap(async () => {
      const p = s().store.sourceStoredPath(id(sid));
      if (!p) throw new StoreError('not-found', 'Original not found');
      const err = await shell.openPath(s().store.files.resolvePath(p));
      if (err) throw new StoreError('open-failed', err);
    }),
  );

  // --------------------------------------------------------------- import
  on('importer.pickFiles', async () => {
    const w = win();
    const r = await dialog.showOpenDialog(w, {
      title: 'Import CVs',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CVs', extensions: ['docx', 'pdf', 'pages', 'txt', 'md'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  on('importer.importPaths', (paths: string[], batchId?: string) => wrap(() => s().importer.importPaths((paths ?? []).map((p) => str(p, 4096)), batchId)));
  on('importer.pending', () => s().importer.pending());
  on('importer.setText', (batchId: string, sourceId: string, text: string, method: string) =>
    wrap(() => s().importer.setText(id(batchId), id(sourceId), str(text), /^(pdf:ocr|manual|pages:converted)$/.test(method) ? method : 'manual')),
  );
  on('importer.sourceBytes', (sid: string) =>
    wrap(() => {
      const p = s().store.sourceStoredPath(id(sid));
      if (!p) throw new StoreError('not-found', 'Original not found');
      return new Uint8Array(s().store.files.read(p));
    }),
  );
  on('importer.convertPages', (batchId: string, sid: string) =>
    wrap(async () => {
      const p = s().store.sourceStoredPath(id(sid));
      if (!p) throw new StoreError('not-found', 'Original not found');
      const src = s().store.getSource(sid)!;
      const tmp = mkdtempSync(join(tmpdir(), 'atelier-pages-'));
      try {
        const out = join(tmp, `${basename(src.filename, extname(src.filename))}.docx`);
        await convertPagesToDocx(s().store.files.resolvePath(p), out);
        return await s().importer.attachConversion(id(batchId), sid, out);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }),
  );
  on('importer.attachConversion', (batchId: string, sid: string) =>
    wrap(async () => {
      const r = await dialog.showOpenDialog(win(), { title: 'Choose the Word file exported from Pages', buttonLabel: 'Use this file', filters: [{ name: 'Word', extensions: ['docx'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) throw new StoreError('cancelled', 'No file chosen.');
      return s().importer.attachConversion(id(batchId), id(sid), r.filePaths[0]);
    }),
  );
  on('importer.removeFile', (batchId: string, sid: string) => wrap(() => s().importer.removeFile(id(batchId), id(sid))));
  on('importer.commit', (batchId: string, decisions: Record<string, never>) => wrap(() => s().importer.commit(id(batchId), decisions ?? {})));
  on('importer.discard', (batchId: string) => wrap(() => s().importer.discard(id(batchId))));

  // ------------------------------------------------------------------ CVs
  on('cvs.list', () => s().store.listCvs());
  on('cvs.get', (cid: string) => s().store.getCv(id(cid)));
  on('cvs.create', (input: { name: string; lang: Lang; template: TemplateId; fromLibrary: boolean; description?: string }) =>
    wrap(() => {
      const l = lang(input.lang);
      const template: TemplateId = ['classic', 'sidebar', 'compact'].includes(input.template) ? input.template : 'classic';
      const document = input.fromLibrary ? buildDocumentFromLibrary(s().store.listRecords(), l, template) : emptyDocument(l, template);
      return s().store.createCv({ name: str(input.name, 200), lang: l, document, description: str(input.description ?? '', 500) });
    }),
  );
  on('cvs.duplicate', (cid: string, name: string) => wrap(() => s().store.duplicateCv(id(cid), { name: str(name, 200) })));
  on('cvs.updateMeta', (cid: string, patch: { name?: string; description?: string; lang?: Lang }) =>
    wrap(() => s().store.updateCvMeta(id(cid), { name: patch.name === undefined ? undefined : str(patch.name, 200), description: patch.description === undefined ? undefined : str(patch.description, 500), lang: patch.lang ? lang(patch.lang) : undefined })),
  );
  on('cvs.save', (cid: string, document: unknown, revision: number) => wrap(() => s().store.saveCvDocument(id(cid), document as never, Number(revision))));
  on('cvs.remove', (cid: string) => wrap(() => s().store.deleteCv(id(cid))));

  // ------------------------------------------------------------- versions
  on('versions.list', (cid: string) => s().store.listVersions(id(cid)));
  on('versions.checkpoint', (cid: string, label?: string) => wrap(() => s().store.createCheckpoint(id(cid), label ? str(label, 120) : undefined)));
  on('versions.rename', (vid: string, label: string) => wrap(() => s().store.renameVersion(id(vid), str(label, 120))));
  on('versions.remove', (vid: string) => wrap(() => s().store.deleteVersion(id(vid))));
  on('versions.restoreAsDraft', (cid: string, vid: string) => wrap(() => s().store.restoreVersionAsDraft(id(cid), id(vid))));
  on('versions.openSentFile', (fid: string) =>
    wrap(async () => {
      s().store.readSentFile(id(fid)); // verifies the checksum first
      const err = await shell.openPath(s().store.sentFilePath(fid));
      if (err) throw new StoreError('open-failed', err);
    }),
  );
  on('versions.revealSentFile', (fid: string) => wrap(() => shell.showItemInFolder(s().store.sentFilePath(id(fid)))));

  // --------------------------------------------------------- applications
  on('applications.list', () => s().store.listApplications());
  on('applications.get', (aid: string) => s().store.getApplication(id(aid)));
  on('applications.create', (input: Record<string, string>) =>
    wrap(() =>
      s().store.createApplication({
        company: str(input.company ?? '', 200),
        role: str(input.role ?? '', 200),
        location: str(input.location ?? '', 200),
        lang: lang(input.lang),
        offerText: str(input.offerText ?? '', 100_000),
        offerUrl: str(input.offerUrl ?? '', 2000),
        offerFileName: str(input.offerFileName ?? '', 300),
        notes: str(input.notes ?? '', 20_000),
      }),
    ),
  );
  on('applications.createDraft', (aid: string, baseCvId: string) => wrap(() => s().store.createApplicationDraft(id(aid), id(baseCvId))));
  on('applications.update', (aid: string, patch: Record<string, string>) => {
    const clean: Record<string, string> = {};
    for (const k of ['company', 'role', 'location', 'offerText', 'offerUrl', 'notes']) if (typeof patch?.[k] === 'string') clean[k] = str(patch[k], 100_000);
    return wrap(() => s().store.updateApplication(id(aid), { ...clean, ...(patch?.lang ? { lang: lang(patch.lang) } : {}) }));
  });
  on('applications.setStatus', (aid: string, status: AppStatus) =>
    wrap(() => {
      if (!STATUSES.includes(status)) throw new StoreError('invalid', 'Unknown status');
      return s().store.setStatus(id(aid), status);
    }),
  );
  on('applications.events', (aid: string) => s().store.listEvents(id(aid)));
  on('applications.remove', (aid: string) => wrap(() => s().store.deleteApplication(id(aid))));
  on('applications.fetchOffer', async (url: string): Promise<OfferFetchView> => {
    const r = await fetchOffer(str(url, 2000), (u, init) => fetch(u, init));
    return r.ok
      ? { ok: true, message: '', text: r.text, title: r.title, company: r.company, location: r.location, url: r.url }
      : { ok: false, message: r.message, text: '', title: '', company: '', location: '', url: String(url) };
  });
  on('applications.pickOfferFile', () =>
    wrap(async () => {
      const r = await dialog.showOpenDialog(win(), { title: 'Choose the job offer', filters: [{ name: 'Job offer', extensions: ['pdf', 'docx', 'txt', 'md', 'html', 'htm'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      const path = r.filePaths[0];
      const data = new Uint8Array(readFileSync(path));
      const ext = extname(path).toLowerCase();
      let text = '';
      if (ext === '.pdf') text = (await extractPdf(data)).text;
      else if (ext === '.docx') text = (await extractDocx(data)).text;
      else if (ext === '.html' || ext === '.htm') text = htmlFragmentToText(new TextDecoder().decode(data));
      else text = new TextDecoder().decode(data);
      return { name: basename(path), text, path };
    }),
  );
  on('applications.attachOfferFile', (aid: string, path: string) =>
    wrap(() => {
      const p = str(path, 4096);
      if (!existsSync(p)) throw new StoreError('not-found', 'File not found');
      return s().store.setOfferFile(id(aid), basename(p), new Uint8Array(readFileSync(p)));
    }),
  );

  // ------------------------------------------------------------ proposals
  on('proposals.list', (cid: string) => s().store.listProposals(id(cid)));
  on('proposals.update', (pid: string, patch: Record<string, unknown>) =>
    wrap(() =>
      s().store.updateProposal(id(pid), {
        ...(typeof patch?.status === 'string' && ['pending', 'accepted', 'rejected', 'stale'].includes(patch.status) ? { status: patch.status as never } : {}),
        ...(typeof patch?.confirmed === 'boolean' ? { confirmed: patch.confirmed } : {}),
        ...(typeof patch?.proposedText === 'string' ? { proposedText: str(patch.proposedText, 8000) } : {}),
      }),
    ),
  );

  // ------------------------------------------------------------------- AI
  ipcMain.handle('atelier:ai.run', async (e, input: { requestId: string; cvId: string; document: unknown; request: never }) => {
    try {
      const value = await s().ai.run({ requestId: id(input.requestId), cvId: id(input.cvId), document: input.document as never, request: input.request }, (rid, n) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.aiProgress, rid, n);
      });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: errorOf(err), aiError: toErrorInfo(err) };
    }
  });
  on('ai.cancel', (rid: string) => s().ai.cancel(id(rid)));
  on('ai.consolidate', (rid: string, recordIds: string[]) => wrap(() => s().ai.consolidate(id(rid), (recordIds ?? []).map(id))));
  on('ai.messages', (cid: string) => s().store.listMessages(id(cid)));

  // ------------------------------------------------------------ providers
  let signIn: AbortController | null = null;
  on('providers.list', () => s().registry.statuses());
  on('providers.setKey', (pid: ProviderId, key: string) => wrap(() => s().registry.setApiKey(pid, str(key, 400))));
  on('providers.removeKey', (pid: ProviderId) => s().registry.removeApiKey(pid));
  on('providers.verify', (pid: ProviderId) => s().registry.verify(pid, AbortSignal.timeout(20_000)));
  on('providers.signInChatGpt', () =>
    wrap(async () => {
      signIn?.abort();
      signIn = new AbortController();
      try {
        await s().chatgpt.signIn(signIn.signal);
      } finally {
        signIn = null;
      }
      return s().registry.status('chatgpt');
    }),
  );
  on('providers.cancelSignIn', () => signIn?.abort());
  on('providers.disconnectChatGpt', () => wrap(() => s().chatgpt.disconnect()));
  on('providers.secureStorageAvailable', () => s().secrets.available());

  // -------------------------------------------------------------- export
  on('exporter.chooseDirectory', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Choose where to save', buttonLabel: 'Choose', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  on('exporter.defaultDirectory', () => app.getPath('documents'));
  on('exporter.run', (req: never) => wrap(() => s().exporter.run(req)));
  on('exporter.markSent', (input: { exportId: string; applicationId: string }) => wrap(() => s().exporter.markSent(id(input.exportId), id(input.applicationId))));
  on('exporter.reveal', (p: string) => shell.showItemInFolder(str(p, 4096)));

  // -------------------------------------------------------------- backup
  on('backup.exportTo', () =>
    wrap(async () => {
      const stamp = new Date().toISOString().slice(0, 10);
      const r = await dialog.showSaveDialog(win(), { title: 'Back up Atelier', defaultPath: join(app.getPath('documents'), `Atelier-backup-${stamp}.${BACKUP_EXTENSION}`), filters: [{ name: 'Atelier backup', extensions: [BACKUP_EXTENSION] }] });
      if (r.canceled || !r.filePath) return null;
      const check = writeBackupFile(s().store.db, s().store.files, r.filePath, app.getVersion());
      return { path: r.filePath, counts: check.counts };
    }),
  );
  on('backup.pick', () =>
    wrap(async (): Promise<BackupInspectionView | null> => {
      const r = await dialog.showOpenDialog(win(), { title: 'Restore from backup', filters: [{ name: 'Atelier backup', extensions: [BACKUP_EXTENSION] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      return inspectionView(r.filePaths[0], s().store.db);
    }),
  );
  on('backup.restore', (input: { path: string; mode: 'replace' | 'merge'; choices: Record<string, 'keep-mine' | 'use-backup'> }) =>
    wrap(() => {
      const bytes = new Uint8Array(readFileSync(str(input.path, 4096)));
      if (input.mode === 'merge') {
        const r = mergeBackup(bytes, s().store.db, s().store.files, input.choices ?? {});
        return { mode: 'merge', ...r };
      }
      const current = join(ctx.dataRoot, 'data');
      const next = join(ctx.dataRoot, `data.restoring-${newId()}`);
      buildDataDirFromBackup(bytes, next);
      s().store.db.close();
      let safetyCopy: string;
      try {
        safetyCopy = swapDataDir(current, next);
      } finally {
        ctx.reopen();
      }
      return { mode: 'replace', safetyCopy };
    }),
  );
}

export function inspectionView(path: string, db: Parameters<typeof inspectBackup>[1]): BackupInspectionView {
  const i = inspectBackup(new Uint8Array(readFileSync(path)), db);
  return {
    path,
    ok: i.ok,
    errors: i.errors,
    createdAt: i.manifest?.createdAt ?? null,
    appVersion: i.manifest?.appVersion ?? null,
    counts: i.counts,
    newRows: i.newRows,
    identical: i.identical,
    collisions: i.collisions,
  };
}

export { PagesConversionError, pagesAppPath, applyMaterial };
