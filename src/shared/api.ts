// The API the preload script exposes to the renderer as `window.atelier`.
// Every call crosses the process boundary through a named IPC channel and
// is validated in the main process.

import type { AiErrorInfo } from './ai/errors';
import type { ConsolidationFinding } from './ai/response';
import type { GroupDecisionInput } from './importTypes';
import type { ImportBatchView } from './importTypes';
import type {
  AiRequestInput,
  AppEvent,
  AppStatus,
  Application,
  ApplicationSummary,
  ConversationMessage,
  Cv,
  CvDocument,
  CvSummary,
  CvVersion,
  Lang,
  LibraryRecord,
  Proposal,
  ProviderId,
  ProviderStatus,
  RecordKind,
  Settings,
  SourceFile,
  SourceRef,
  TemplateId,
} from './types';

/** Result wrapper: errors are returned as values so the UI can show them. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; detail?: string } };

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  osVersion: string;
  dataDir: string;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  e2e: boolean;
  pagesAppAvailable: boolean;
  electron: string;
}

export type MenuCommand =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'new-cv'
  | 'new-application'
  | 'import'
  | 'export'
  | 'settings'
  | 'go-library'
  | 'go-applications'
  | 'mode-content'
  | 'mode-layout'
  | 'mode-style'
  | 'mode-versions'
  | 'backup'
  | 'restore'
  | 'find';

export interface ExportRequest {
  cvId: string;
  formats: Array<'pdf' | 'docx'>;
  directory: string;
  baseName: string;
  overwrite: boolean;
}

export interface ExportedFile {
  kind: 'pdf' | 'docx';
  path: string;
  size: number;
  pageCount?: number;
}

export interface ExportResult {
  exportId: string;
  docHash: string;
  files: ExportedFile[];
}

export interface AiRunResultView {
  requestId: string;
  summary: string;
  proposals: Proposal[];
  findings: ConsolidationFinding[];
  dropped: string[];
  contextLabels: string[];
  providerLabel: string;
  model: string;
}

export interface BackupInspectionView {
  path: string;
  ok: boolean;
  errors: string[];
  createdAt: string | null;
  appVersion: string | null;
  counts: Record<string, number>;
  newRows: Record<string, number>;
  identical: number;
  collisions: Array<{ table: string; key: string; label: string; locked: boolean }>;
}

export interface OfferFetchView {
  ok: boolean;
  message: string;
  text: string;
  title: string;
  company: string;
  location: string;
  url: string;
}

export interface PrintPayload {
  document: CvDocument;
}

export interface PrintReadyInfo {
  pageCount: number;
  tooTall: number;
}

export interface AtelierApi {
  app: {
    info(): Promise<AppInfo>;
    onMenu(cb: (cmd: MenuCommand) => void): () => void;
    onAccessibilityChange(cb: (a: { reduceTransparency: boolean; reduceMotion: boolean }) => void): () => void;
    openExternal(url: string): Promise<Result<void>>;
    revealDataFolder(): Promise<void>;
    setWindowTitle(title: string): void;
  };
  /** Crash-recovery journal for unsaved editor changes (kept outside the data folder). */
  recovery: {
    write(cvId: string, document: CvDocument, at: string): Promise<void>;
    read(cvId: string): Promise<{ document: CvDocument; at: string } | null>;
    clear(cvId: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Result<Settings>>;
  };
  library: {
    records(kind?: RecordKind): Promise<LibraryRecord[]>;
    createRecord(input: { kind: RecordKind; lang: Lang; data: Record<string, unknown> }): Promise<Result<LibraryRecord>>;
    updateRecord(id: string, data: Record<string, unknown>, lang?: Lang): Promise<Result<LibraryRecord>>;
    deleteRecord(id: string): Promise<Result<void>>;
    usage(id: string): Promise<Array<{ cvId: string; name: string; updatedAt: string }>>;
    mergeRecords(keepId: string, removeIds: string[], data: Record<string, unknown>, fieldSources: Record<string, SourceRef | { user: true }>): Promise<Result<LibraryRecord>>;
    sources(): Promise<SourceFile[]>;
    deleteSource(id: string): Promise<Result<void>>;
    openSource(id: string): Promise<Result<void>>;
  };
  importer: {
    pickFiles(): Promise<string[]>;
    /** Local path of a file dropped on the window. */
    pathForFile(file: File): string;
    importPaths(paths: string[], batchId?: string): Promise<Result<ImportBatchView>>;
    pending(): Promise<ImportBatchView | null>;
    setText(batchId: string, sourceId: string, text: string, method: string): Promise<Result<ImportBatchView>>;
    sourceBytes(sourceId: string): Promise<Result<Uint8Array>>;
    convertPages(batchId: string, sourceId: string): Promise<Result<ImportBatchView>>;
    attachConversion(batchId: string, sourceId: string): Promise<Result<ImportBatchView>>;
    removeFile(batchId: string, sourceId: string): Promise<Result<ImportBatchView>>;
    commit(batchId: string, decisions: Record<string, GroupDecisionInput>, opts?: { createCvs?: boolean }): Promise<Result<{ created: number; updated: number; skipped: number; cvs: Array<{ id: string; name: string }> }>>;
    discard(batchId: string): Promise<Result<void>>;
  };
  cvs: {
    list(): Promise<CvSummary[]>;
    get(id: string): Promise<Cv | null>;
    create(input: { name: string; lang: Lang; template: TemplateId; fromLibrary: boolean; description?: string }): Promise<Result<Cv>>;
    duplicate(id: string, name: string): Promise<Result<Cv>>;
    updateMeta(id: string, patch: { name?: string; description?: string; lang?: Lang }): Promise<Result<Cv>>;
    save(id: string, document: CvDocument, revision: number): Promise<Result<{ revision: number; updatedAt: string }>>;
    remove(id: string): Promise<Result<void>>;
  };
  versions: {
    list(cvId: string): Promise<CvVersion[]>;
    checkpoint(cvId: string, label?: string): Promise<Result<CvVersion>>;
    rename(id: string, label: string): Promise<Result<CvVersion>>;
    remove(id: string): Promise<Result<void>>;
    restoreAsDraft(cvId: string, versionId: string): Promise<Result<Cv>>;
    openSentFile(fileId: string): Promise<Result<void>>;
    revealSentFile(fileId: string): Promise<Result<void>>;
  };
  applications: {
    list(): Promise<ApplicationSummary[]>;
    get(id: string): Promise<Application | null>;
    create(input: { company: string; role: string; location: string; lang: Lang; offerText: string; offerUrl: string; offerFileName: string; notes: string }): Promise<Result<Application>>;
    createDraft(applicationId: string, baseCvId: string): Promise<Result<Cv>>;
    update(id: string, patch: Partial<Pick<Application, 'company' | 'role' | 'location' | 'lang' | 'offerText' | 'offerUrl' | 'notes'>>): Promise<Result<Application>>;
    setStatus(id: string, status: AppStatus): Promise<Result<Application>>;
    events(id: string): Promise<AppEvent[]>;
    remove(id: string): Promise<Result<void>>;
    fetchOffer(url: string): Promise<OfferFetchView>;
    pickOfferFile(): Promise<Result<{ name: string; text: string; path: string } | null>>;
    attachOfferFile(id: string, path: string): Promise<Result<Application>>;
  };
  proposals: {
    list(cvId: string): Promise<Proposal[]>;
    update(id: string, patch: Partial<Pick<Proposal, 'status' | 'confirmed' | 'proposedText'>>): Promise<Result<Proposal>>;
  };
  ai: {
    run(input: { requestId: string; cvId: string; document: CvDocument; request: AiRequestInput }): Promise<Result<AiRunResultView> & { aiError?: AiErrorInfo }>;
    cancel(requestId: string): Promise<boolean>;
    onProgress(cb: (requestId: string, receivedChars: number) => void): () => void;
    consolidate(requestId: string, recordIds: string[]): Promise<Result<{ summary: string; findings: ConsolidationFinding[]; dropped: string[] }>>;
    messages(cvId: string): Promise<ConversationMessage[]>;
  };
  providers: {
    list(): Promise<ProviderStatus[]>;
    setKey(id: ProviderId, key: string): Promise<Result<ProviderStatus>>;
    removeKey(id: ProviderId): Promise<ProviderStatus>;
    verify(id: ProviderId): Promise<ProviderStatus>;
    signInChatGpt(): Promise<Result<ProviderStatus>>;
    cancelSignIn(): Promise<void>;
    disconnectChatGpt(): Promise<Result<{ revoked: boolean }>>;
    secureStorageAvailable(): Promise<boolean>;
  };
  exporter: {
    chooseDirectory(): Promise<string | null>;
    defaultDirectory(): Promise<string>;
    run(req: ExportRequest): Promise<Result<ExportResult>>;
    markSent(input: { exportId: string; applicationId: string }): Promise<Result<CvVersion>>;
    reveal(path: string): Promise<void>;
  };
  backup: {
    exportTo(): Promise<Result<{ path: string; counts: Record<string, number> } | null>>;
    pick(): Promise<Result<BackupInspectionView | null>>;
    restore(input: { path: string; mode: 'replace' | 'merge'; choices: Record<string, 'keep-mine' | 'use-backup'> }): Promise<Result<{ mode: string; added?: number; replaced?: number; kept?: number; safetyCopy?: string }>>;
  };
  print: {
    payload(token: string): Promise<PrintPayload | null>;
    ready(token: string, info: PrintReadyInfo): void;
  };
}

export const IPC = {
  invokePrefix: 'atelier:',
  menu: 'atelier:menu',
  accessibility: 'atelier:accessibility',
  aiProgress: 'atelier:ai-progress',
  printReady: 'atelier:print-ready',
  setTitle: 'atelier:set-title',
} as const;
