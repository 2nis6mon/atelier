import type { Lang, PartialDate } from './types';

// Partial dates are stored as 'YYYY' or 'YYYY-MM' (or '' when unknown).

const MONTHS: Array<[number, string[]]> = [
  [1, ['janvier', 'janv', 'jan', 'january']],
  [2, ['février', 'fevrier', 'févr', 'fevr', 'fév', 'fev', 'february', 'feb']],
  [3, ['mars', 'march', 'mar']],
  [4, ['avril', 'avr', 'april', 'apr']],
  [5, ['mai', 'may']],
  [6, ['juin', 'june', 'jun']],
  [7, ['juillet', 'juil', 'july', 'jul']],
  [8, ['août', 'aout', 'august', 'aug']],
  [9, ['septembre', 'sept', 'september', 'sep']],
  [10, ['octobre', 'october', 'oct']],
  [11, ['novembre', 'november', 'nov']],
  [12, ['décembre', 'decembre', 'déc', 'dec', 'december']],
];

const MONTH_LOOKUP = new Map<string, number>();
for (const [n, names] of MONTHS) for (const name of names) MONTH_LOOKUP.set(name, n);

const PRESENT_WORDS = [
  "aujourd'hui",
  'aujourd’hui',
  'à ce jour',
  'a ce jour',
  'ce jour',
  'présent',
  'present',
  'actuel',
  'actuellement',
  'en cours',
  'current',
  'currently',
  'now',
  'today',
  'ongoing',
];

const MONTH_NAMES_SHORT: Record<Lang, string[]> = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export const PRESENT_LABEL: Record<Lang, string> = { fr: "aujourd'hui", en: 'Present' };

export function isValidPartialDate(value: string): boolean {
  if (value === '') return true;
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  if (year < 1900 || year > 2100) return false;
  if (m[2] !== undefined) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return false;
  }
  return true;
}

export function makePartialDate(year: number, month?: number | null): PartialDate {
  if (!month) return String(year);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function yearOf(d: PartialDate): number | null {
  const m = /^(\d{4})/.exec(d);
  return m ? Number(m[1]) : null;
}

export function monthOf(d: PartialDate): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(d);
  return m ? Number(m[1]) : null;
}

/** Sortable numeric key; unknown dates sort first. Month-less dates sort at month 0. */
export function dateKey(d: PartialDate): number {
  const y = yearOf(d);
  if (y === null) return 0;
  return y * 100 + (monthOf(d) ?? 0);
}

export function formatPartialDate(d: PartialDate, lang: Lang): string {
  const y = yearOf(d);
  if (y === null) return '';
  const m = monthOf(d);
  if (m === null) return String(y);
  return `${MONTH_NAMES_SHORT[lang][m - 1]} ${y}`;
}

export function formatRange(start: PartialDate, end: PartialDate, current: boolean, lang: Lang): string {
  const s = formatPartialDate(start, lang);
  const e = current ? PRESENT_LABEL[lang] : formatPartialDate(end, lang);
  if (s && e) return s === e ? s : `${s} – ${e}`;
  return s || e;
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/\.$/, '');
}

/** Parses one date token ("2021", "sept. 2022", "03/2018", "2018-03", "Present"). */
export function parseDateToken(raw: string): PartialDate | 'present' | null {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const lower = t.toLowerCase();
  if (PRESENT_WORDS.includes(lower)) return 'present';
  let m = /^(\d{4})$/.exec(t);
  if (m) return isValidPartialDate(m[1]) ? m[1] : null;
  m = /^(\d{1,2})[/.](\d{4})$/.exec(t);
  if (m) {
    const d = makePartialDate(Number(m[2]), Number(m[1]));
    return isValidPartialDate(d) ? d : null;
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) {
    const d = makePartialDate(Number(m[1]), Number(m[2]));
    return isValidPartialDate(d) ? d : null;
  }
  m = /^([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTH_LOOKUP.get(normalizeWord(m[1]));
    if (!month) return null;
    const d = makePartialDate(Number(m[2]), month);
    return isValidPartialDate(d) ? d : null;
  }
  return null;
}

export interface FoundRange {
  start: PartialDate;
  end: PartialDate;
  current: boolean;
  index: number;
  length: number;
}

const MONTH_ALT = [...MONTH_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const PRESENT_ALT = PRESENT_WORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\’']/g, (c) => (c === "'" || c === '’' ? "['’]" : `\\${c}`))).join('|');
const TOKEN = `(?:(?:${MONTH_ALT})\\.?\\s+\\d{4}|\\d{1,2}[/.]\\d{4}|\\d{4}-\\d{1,2}(?!\\d)|\\d{4})`;
const RANGE_RE = new RegExp(
  `(?:(?:de|du|from|depuis|since)\\s+)?(${TOKEN})\\s*(?:[-–—]|(?<!\\p{L})(?:à|au|to|until|jusqu['’]?à)(?!\\p{L}))\\s*(${TOKEN}|${PRESENT_ALT})`,
  'iu',
);
const SINCE_RE = new RegExp(`(?:depuis|since)\\s+(${TOKEN})`, 'iu');

/** Finds the first date range in a line of free text. */
export function findDateRange(line: string): FoundRange | null {
  const m = RANGE_RE.exec(line);
  if (m) {
    const start = parseDateToken(m[1]);
    const end = parseDateToken(m[2]);
    if (start && start !== 'present' && end) {
      return {
        start,
        end: end === 'present' ? '' : end,
        current: end === 'present',
        index: m.index,
        length: m[0].length,
      };
    }
  }
  const s = SINCE_RE.exec(line);
  if (s) {
    const start = parseDateToken(s[1]);
    if (start && start !== 'present') return { start, end: '', current: true, index: s.index, length: s[0].length };
  }
  return null;
}

/** Finds a standalone year or month-year (for education/certifications). */
export function findSingleDate(line: string): { date: PartialDate; index: number; length: number } | null {
  const re = new RegExp(TOKEN, 'iu');
  const m = re.exec(line);
  if (!m) return null;
  const d = parseDateToken(m[0]);
  if (!d || d === 'present') return null;
  return { date: d, index: m.index, length: m[0].length };
}

export function rangesOverlap(
  a: { start: PartialDate; end: PartialDate; current: boolean },
  b: { start: PartialDate; end: PartialDate; current: boolean },
): boolean {
  const aStart = dateKey(a.start);
  const bStart = dateKey(b.start);
  const aEnd = a.current || !a.end ? 999999 : dateKey(a.end) + (monthOf(a.end) ? 0 : 12);
  const bEnd = b.current || !b.end ? 999999 : dateKey(b.end) + (monthOf(b.end) ? 0 : 12);
  return aStart <= bEnd && bStart <= aEnd;
}
