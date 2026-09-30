// Serves the renderer from app://atelier/… with a strict Content Security
// Policy. Only files inside the renderer build folder can be served.

import { net, protocol } from 'electron';
import { existsSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';
export const APP_ORIGIN = 'app://atelier';

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
  ]);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.traineddata': 'application/octet-stream',
};

export function handleAppProtocol(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'atelier') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = normalize(join(rendererDir, rel));
    const inside = relative(rendererDir, file);
    if (inside.startsWith('..') || inside.includes(`..${sep}`) || !existsSync(file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    const headers = new Headers(res.headers);
    headers.set('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    if (ext === '.html') headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: 200, headers });
  });
}
