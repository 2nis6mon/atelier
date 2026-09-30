// Guard against invented facts. Every figure, technology or proper noun in a
// proposed text must already exist in the user's own documents (current CV or
// library). Terms found only in the job offer — or nowhere — are flagged and
// the proposal cannot be accepted without an explicit confirmation.

import { normalizeForMatch } from '../lang';
import { stripMarkup } from '../markup';

const COMMON_CAPITALISED = new Set(
  [
    'i', 'je', 'j', 'le', 'la', 'les', 'un', 'une', 'the', 'a', 'an', 'nous', 'we', 'mon', 'my', 'en', 'in', 'et', 'and', 'de', 'des',
    'frontend', 'front-end', 'backend', 'back-end', 'fullstack', 'full-stack', 'senior', 'junior', 'lead', 'web', 'mobile', 'product',
    'design', 'designer', 'designers', 'developer', 'developpeur', 'developpeuse', 'engineer', 'ingenieur', 'manager', 'team', 'equipe',
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'present', 'aujourd', 'hui', 'profil', 'profile', 'experience', 'skills', 'competences', 'education', 'formation', 'langues',
    'languages', 'ui', 'ux', 'api', 'apis', 'cv',
  ].map((w) => normalizeForMatch(w)),
);

export interface GuardResult {
  /** Terms found nowhere in the user's documents. */
  unverified: string[];
  /** Terms found only in the job offer (a requirement is not evidence of a skill). */
  offerOnly: string[];
}

const NUMBER_RE = /\d+(?:[.,]\d+)?\s?(?:%|k€|€|k\$|\$|k|m|x|\+)?/g;
const TECHISH_RE = /(?:[A-Za-z][A-Za-z0-9]*(?:[.#+/][A-Za-z0-9#+]+)+|[A-Z]{2,}[A-Za-z0-9]*|[A-Za-z]+[0-9][A-Za-z0-9]*)/g;
const WORD_RE = /[\p{Lu}][\p{L}\p{M}'’-]+/gu;

function sentenceStarts(text: string): Set<number> {
  const starts = new Set<number>([0]);
  const re = /[.!?:•\n]\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.add(m.index + m[0].length);
  return starts;
}

/** Candidate "fact" tokens in a text. `strict` also includes capitalised words (proper nouns). */
export function factTokens(text: string, strict: boolean): string[] {
  const plain = stripMarkup(text);
  const out = new Set<string>();
  for (const m of plain.matchAll(NUMBER_RE)) out.add(m[0].trim());
  for (const m of plain.matchAll(TECHISH_RE)) out.add(m[0]);
  if (strict) {
    const starts = sentenceStarts(plain);
    const parts = new Set([...out].flatMap((t) => t.split(/[.#+/]/)));
    for (const m of plain.matchAll(WORD_RE)) {
      if (starts.has(m.index ?? -1) || parts.has(m[0])) continue;
      const n = normalizeForMatch(m[0]);
      if (!n || COMMON_CAPITALISED.has(n)) continue;
      out.add(m[0]);
    }
  }
  return [...out].filter((t) => normalizeForMatch(t).length > 0);
}

function contains(haystack: string, token: string): boolean {
  const n = normalizeForMatch(token);
  if (!n) return true;
  if (/^\d/.test(n)) {
    const digits = n.replace(/[^0-9]/g, '');
    return haystack.replace(/[^0-9 ]/g, ' ').split(/\s+/).includes(digits) || haystack.includes(n);
  }
  return ` ${haystack} `.includes(` ${n} `) || haystack.includes(n);
}

/**
 * @param proposed text proposed by the AI
 * @param evidence the user's own content (current CV text + selected library records)
 * @param offer the job offer text (never counts as evidence)
 * @param strict check capitalised words too (off for translations)
 */
export function checkFacts(proposed: string, evidence: string, offer: string, strict = true): GuardResult {
  const ev = normalizeForMatch(stripMarkup(evidence));
  const of = normalizeForMatch(offer);
  const unverified: string[] = [];
  const offerOnly: string[] = [];
  for (const token of factTokens(proposed, strict)) {
    if (contains(ev, token)) continue;
    if (of && contains(of, token)) offerOnly.push(token);
    else unverified.push(token);
  }
  return { unverified, offerOnly };
}
