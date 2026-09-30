// Fetches a job offer from a link the user entered. Only http(s), bounded
// size and time; the page is treated as untrusted data and reduced to text.
// When a site needs sign-in or blocks reading, the user is asked to paste.

import { extractJobFromHtml, looksLikeBlockedPage } from '../../shared/offer';
import { extractPdf } from './pdf';

export type FetchImpl = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; redirect: 'follow' }) => Promise<Response>;

export type OfferFetchResult =
  | { ok: true; url: string; text: string; title: string; company: string; location: string; structured: boolean }
  | { ok: false; reason: 'invalid-url' | 'network' | 'http' | 'blocked' | 'too-large' | 'unsupported' | 'timeout'; message: string };

const MAX_BYTES = 5 * 1024 * 1024;

export function validateOfferUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url;
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

const PASTE = 'Paste the offer text instead.';

export async function fetchOffer(raw: string, fetchImpl: FetchImpl, timeoutMs = 15_000): Promise<OfferFetchResult> {
  const url = validateOfferUrl(raw);
  if (!url) return { ok: false, reason: 'invalid-url', message: 'Enter a full web address starting with https://' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8', 'Accept-Language': 'fr,en;q=0.8' },
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === 'AbortError') return { ok: false, reason: 'timeout', message: `The site took too long to answer. ${PASTE}` };
    return { ok: false, reason: 'network', message: `Couldn't load the job from this link. ${PASTE}` };
  }
  try {
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'blocked', message: `This site requires sign-in or blocks automatic reading. ${PASTE}` };
    if (!res.ok) return { ok: false, reason: 'http', message: `The site answered with an error (${res.status}). ${PASTE}` };
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    const body = await readLimited(res, MAX_BYTES);
    if (!body) return { ok: false, reason: 'too-large', message: `The page is too large to read. ${PASTE}` };
    if (type.includes('application/pdf')) {
      const pdf = await extractPdf(body);
      if (pdf.needsOcr) return { ok: false, reason: 'unsupported', message: `This PDF has no readable text. ${PASTE}` };
      return { ok: true, url: url.toString(), text: pdf.text, title: '', company: '', location: '', structured: false };
    }
    const decoded = new TextDecoder('utf-8').decode(body);
    if (type.includes('text/plain')) {
      return { ok: true, url: url.toString(), text: decoded.trim(), title: '', company: '', location: '', structured: false };
    }
    if (!type.includes('html') && type !== '') return { ok: false, reason: 'unsupported', message: `This link is not a web page. ${PASTE}` };
    const page = extractJobFromHtml(decoded);
    if (looksLikeBlockedPage(page.text)) return { ok: false, reason: 'blocked', message: `This site requires sign-in or blocks automatic reading. ${PASTE}` };
    return { ok: true, url: url.toString(), text: page.text, title: page.title, company: page.company, location: page.location, structured: page.structured };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ok: false, reason: 'timeout', message: `The site took too long to answer. ${PASTE}` };
    return { ok: false, reason: 'network', message: `Couldn't load the job from this link. ${PASTE}` };
  } finally {
    clearTimeout(timer);
  }
}
