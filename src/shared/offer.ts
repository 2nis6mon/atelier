// Job offer helpers: metadata guesses from pasted text, requirement lines,
// and HTML → text for offers fetched from a link. Offers are untrusted data.

import { detectLang } from './lang';
import type { Lang } from './types';

export interface OfferMeta {
  company: string;
  role: string;
  location: string;
  lang: Lang;
}

const FIELD_PATTERNS: Array<[keyof Omit<OfferMeta, 'lang'>, RegExp]> = [
  ['company', /^(?:company|entreprise|société|societe|employer|employeur|organisation)\s*[:：]\s*(.+)$/im],
  ['role', /^(?:role|rôle|poste|position|job title|title|intitulé du poste|intitule du poste|job)\s*[:：]\s*(.+)$/im],
  ['location', /^(?:location|lieu|localisation|ville|city|based in)\s*[:：]\s*(.+)$/im],
];

export function guessOfferMeta(text: string): OfferMeta {
  const meta: OfferMeta = { company: '', role: '', location: '', lang: detectLang(text, 'en') };
  for (const [key, re] of FIELD_PATTERNS) {
    const m = re.exec(text);
    if (m) meta[key] = m[1].trim().slice(0, 120);
  }
  const langLine = /^(?:language|langue)\s*[:：]\s*(.+)$/im.exec(text);
  if (langLine) {
    const v = langLine[1].toLowerCase();
    if (/fran|french/.test(v)) meta.lang = 'fr';
    else if (/angl|english/.test(v)) meta.lang = 'en';
  }
  return meta;
}

const REQ_HEADINGS = /^(?:requirements?|qualifications?|what you(?:'|’)ll bring|what we(?:'|’)re looking for|you have|profil recherché|profil|compétences requises|competences requises|votre profil|ce que nous recherchons|must have|nice to have|bonus|atouts)\b/i;
const BULLET = /^\s*(?:[•·▪◦●○■\-–—*]|\d+[.)])\s+/;

/** Requirement-like lines from an offer (listed as-is, never scored). */
export function extractRequirements(text: string, limit = 12): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  let inReq = false;
  for (const line of lines) {
    if (!line) continue;
    if (REQ_HEADINGS.test(line.replace(/[:：]$/, ''))) {
      inReq = true;
      continue;
    }
    if (BULLET.test(line) && (inReq || out.length < limit)) {
      const t = line.replace(BULLET, '').trim();
      if (t.length > 3 && !out.includes(t)) out.push(t);
    } else if (inReq && line.length < 160 && !/[:：]$/.test(line)) {
      if (!out.includes(line)) out.push(line);
    } else if (inReq && /[:：]$/.test(line)) {
      inReq = REQ_HEADINGS.test(line);
    }
    if (out.length >= limit) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  iuml: 'ï',
  euml: 'ë',
  oelig: 'œ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  bull: '•',
  euro: '€',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Converts an HTML fragment to readable text with line breaks and bullets. */
export function htmlFragmentToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|ul|ol|tr|table|header|footer|main|blockquote)>/gi, '\n')
      .replace(/<(p|div|section|article|h[1-6]|ul|ol|tr|table|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ExtractedPage {
  title: string;
  company: string;
  location: string;
  text: string;
  structured: boolean;
}

function findJobPosting(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findJobPosting(n);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return obj;
  if (obj['@graph']) return findJobPosting(obj['@graph']);
  return null;
}

/** Extracts the job text from a web page: schema.org JobPosting first, then the main content. */
export function extractJobFromHtml(html: string): ExtractedPage {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    try {
      const posting = findJobPosting(JSON.parse(s[1].trim()));
      if (posting) {
        const org = posting.hiringOrganization as Record<string, unknown> | undefined;
        const loc = (Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation) as Record<string, unknown> | undefined;
        const addr = loc?.address as Record<string, unknown> | undefined;
        const text = htmlFragmentToText(String(posting.description ?? ''));
        if (text.length > 40) {
          return {
            title: decodeEntities(String(posting.title ?? '')).trim(),
            company: decodeEntities(String(org?.name ?? '')).trim(),
            location: [addr?.addressLocality, addr?.addressCountry].filter((x) => typeof x === 'string' && x).join(', '),
            text,
            structured: true,
          };
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html) ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  const body = main ? main[1] : (/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html);
  const cleaned = body.replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  return {
    title: decodeEntities(titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    company: '',
    location: '',
    text: htmlFragmentToText(cleaned),
    structured: false,
  };
}

/** Whether fetched text is too thin to be a real offer (login wall, JS-only page…). */
export function looksLikeBlockedPage(text: string): boolean {
  const t = text.toLowerCase();
  if (text.trim().length < 200) return true;
  return /(sign in|log in|connectez-vous|se connecter|enable javascript|activez javascript|access denied|captcha|are you a robot)/.test(t) && text.length < 1500;
}
