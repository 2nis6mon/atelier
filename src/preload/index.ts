// Preload: exposes a narrow, typed API to the renderer. No Node access leaks.

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type AtelierApi, type MenuCommand } from '../shared/api';

const call =
  (name: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`atelier:${name}`, ...args);

function ns<T extends object>(prefix: string, methods: string[]): T {
  const out: Record<string, unknown> = {};
  for (const m of methods) out[m] = call(`${prefix}.${m}`);
  return out as T;
}

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: unknown, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: AtelierApi = {
  app: {
    ...ns<Pick<AtelierApi['app'], 'info' | 'openExternal' | 'revealDataFolder'>>('app', ['info', 'openExternal', 'revealDataFolder']),
    onMenu: (cb) => listen<[MenuCommand]>(IPC.menu, cb),
    onAccessibilityChange: (cb) => listen<[{ reduceTransparency: boolean; reduceMotion: boolean }]>(IPC.accessibility, cb),
    setWindowTitle: (title) => ipcRenderer.send(IPC.setTitle, title),
  },
  settings: ns('settings', ['get', 'update']),
  library: ns('library', ['records', 'createRecord', 'updateRecord', 'deleteRecord', 'usage', 'mergeRecords', 'sources', 'deleteSource', 'openSource']),
  importer: {
    ...ns<Omit<AtelierApi['importer'], 'pathForFile'>>('importer', ['pickFiles', 'importPaths', 'pending', 'setText', 'sourceBytes', 'convertPages', 'attachConversion', 'removeFile', 'commit', 'discard']),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  cvs: ns('cvs', ['list', 'get', 'create', 'duplicate', 'updateMeta', 'save', 'remove']),
  versions: ns('versions', ['list', 'checkpoint', 'rename', 'remove', 'restoreAsDraft', 'openSentFile', 'revealSentFile']),
  applications: ns('applications', ['list', 'get', 'create', 'createDraft', 'update', 'setStatus', 'events', 'remove', 'fetchOffer', 'pickOfferFile', 'attachOfferFile']),
  proposals: ns('proposals', ['list', 'update']),
  ai: {
    ...ns<Pick<AtelierApi['ai'], 'run' | 'cancel' | 'consolidate' | 'messages'>>('ai', ['run', 'cancel', 'consolidate', 'messages']),
    onProgress: (cb) => listen<[string, number]>(IPC.aiProgress, cb),
  },
  providers: ns('providers', ['list', 'setKey', 'removeKey', 'verify', 'signInChatGpt', 'cancelSignIn', 'disconnectChatGpt', 'secureStorageAvailable']),
  exporter: ns('exporter', ['chooseDirectory', 'defaultDirectory', 'run', 'markSent', 'reveal']),
  backup: ns('backup', ['exportTo', 'pick', 'restore']),
  print: {
    payload: call('print.payload') as AtelierApi['print']['payload'],
    ready: (token, info) => ipcRenderer.send(IPC.printReady, token, info),
  },
};

contextBridge.exposeInMainWorld('atelier', api);
