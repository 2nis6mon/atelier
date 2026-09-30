import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'library'; tab: 'cvs' | 'experience' | 'sources' }
  | { name: 'applications' }
  | { name: 'application'; id: string }
  | { name: 'new-application'; baseCvId: string | null }
  | { name: 'workspace'; id: string; mode: WorkspaceMode }
  | { name: 'print'; token: string }
  | { name: 'welcome' };

export type WorkspaceMode = 'content' | 'layout' | 'style' | 'versions';
const MODES: WorkspaceMode[] = ['content', 'layout', 'style', 'versions'];

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const [path, query = ''] = h.split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'library': {
      const tab = parts[1] === 'experience' || parts[1] === 'sources' ? parts[1] : 'cvs';
      return { name: 'library', tab };
    }
    case 'applications':
      if (parts[1] === 'new') return { name: 'new-application', baseCvId: params.get('base') };
      if (parts[1]) return { name: 'application', id: parts[1] };
      return { name: 'applications' };
    case 'cv': {
      const mode = MODES.includes(params.get('mode') as WorkspaceMode) ? (params.get('mode') as WorkspaceMode) : 'content';
      return parts[1] ? { name: 'workspace', id: parts[1], mode } : { name: 'library', tab: 'cvs' };
    }
    case 'print':
      return { name: 'print', token: parts[1] ?? '' };
    case 'welcome':
      return { name: 'welcome' };
    default:
      return { name: 'library', tab: 'cvs' };
  }
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'library':
      return `/library/${r.tab}`;
    case 'applications':
      return '/applications';
    case 'application':
      return `/applications/${r.id}`;
    case 'new-application':
      return `/applications/new${r.baseCvId ? `?base=${r.baseCvId}` : ''}`;
    case 'workspace':
      return `/cv/${r.id}${r.mode !== 'content' ? `?mode=${r.mode}` : ''}`;
    case 'print':
      return `/print/${r.token}`;
    case 'welcome':
      return '/welcome';
  }
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = `#${routeToHash(r)}`;
  if (window.location.hash === hash) return;
  if (opts.replace) window.location.replace(hash);
  else window.location.hash = hash;
}
