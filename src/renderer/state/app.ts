import { create } from 'zustand';
import type { AppInfo } from '../../shared/api';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { api, errorMessage, unwrap } from '../api';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'err';
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
}

interface AppState {
  info: AppInfo | null;
  settings: Settings;
  systemReduceMotion: boolean;
  systemReduceTransparency: boolean;
  toasts: Toast[];
  settingsOpen: false | 'ai' | 'storage' | 'accessibility' | 'about';
  importOpen: boolean;
  /** Bumped when data changes outside the current view (e.g. a backup was restored). */
  dataVersion: number;
  bumpData(): void;
  load(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  openSettings(tab?: 'ai' | 'storage' | 'accessibility' | 'about'): void;
  closeSettings(): void;
  setImportOpen(v: boolean): void;
  setSystemAccessibility(a: { reduceMotion: boolean; reduceTransparency: boolean }): void;
}

let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  info: null,
  settings: DEFAULT_SETTINGS,
  systemReduceMotion: false,
  systemReduceTransparency: false,
  toasts: [],
  settingsOpen: false,
  importOpen: false,
  dataVersion: 0,
  bumpData() {
    set({ dataVersion: get().dataVersion + 1 });
  },
  async load() {
    const [info, settings] = await Promise.all([api().app.info(), api().settings.get()]);
    set({ info, settings, systemReduceMotion: info.reduceMotion, systemReduceTransparency: info.reduceTransparency });
  },
  async updateSettings(patch) {
    const prev = get().settings;
    set({ settings: { ...prev, ...patch } });
    try {
      const next = await unwrap(api().settings.update(patch));
      set({ settings: next });
    } catch (e) {
      set({ settings: prev });
      get().toast({ kind: 'err', text: `Settings not saved: ${errorMessage(e)}` });
    }
  },
  toast(t) {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    if (!t.sticky) setTimeout(() => get().dismiss(id), t.kind === 'err' ? 8000 : 4200);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  openSettings(tab = 'ai') {
    set({ settingsOpen: tab });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },
  setImportOpen(v) {
    set({ importOpen: v });
  },
  setSystemAccessibility(a) {
    set({ systemReduceMotion: a.reduceMotion, systemReduceTransparency: a.reduceTransparency });
  },
}));

export function effectiveReduceMotion(s: AppState): boolean {
  if (s.settings.motion === 'reduce') return true;
  if (s.settings.motion === 'full') return false;
  return s.systemReduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function effectiveReduceTransparency(s: AppState): boolean {
  if (s.settings.transparency === 'reduce') return true;
  if (s.settings.transparency === 'full') return false;
  return s.systemReduceTransparency;
}

export const toast = (t: Omit<Toast, 'id'>) => useApp.getState().toast(t);
export const toastError = (e: unknown, prefix = '') => useApp.getState().toast({ kind: 'err', text: `${prefix}${errorMessage(e)}` });
