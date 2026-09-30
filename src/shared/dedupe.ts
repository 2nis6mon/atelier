// Detects the same record appearing in several imported documents (or already
// in the library) and lists every field whose values disagree. Nothing is
// merged arbitrarily: differing values become conflicts the user resolves,
// and each chosen value keeps a reference to the document it came from.

import type { ParsedCandidate } from './cvparse';
import { formatPartialDate, rangesOverlap } from './dates';
import { normalizeForMatch } from './lang';
import type { Lang, LibraryRecord, RecordKind, SourceRef } from './types';

export interface SourcedCandidate {
  candidate: ParsedCandidate;
  source: SourceRef;
}

export interface GroupMember {
  key: string; // tempId for candidates, record id for existing records
  origin: 'candidate' | 'existing';
  data: Record<string, unknown>;
  sources: SourceRef[];
  label: string;
}

export interface FieldOption {
  value: unknown;
  display: string;
  sources: SourceRef[];
  existing: boolean;
}

export interface FieldConflict {
  field: string;
  label: string;
  options: FieldOption[];
}

export interface MergeGroup {
  id: string;
  kind: RecordKind;
  lang: Lang;
  title: string;
  members: GroupMember[];
  /** Values all members agree on (or that only one member provides); list fields are unions. */
  base: Record<string, unknown>;
  conflicts: FieldConflict[];
  existingRecordId: string | null;
}

export interface ResolvedRecord {
  existingRecordId: string | null;
  kind: RecordKind;
  lang: Lang;
  data: Record<string, unknown>;
  sources: SourceRef[];
  fieldSources: Record<string, SourceRef | { user: true }>;
}

type FieldSpec = { scalars: string[]; lists: string[] };

const SPECS: Record<RecordKind, FieldSpec> = {
  personal: { scalars: ['fullName', 'headline', 'email', 'phone', 'location'], lists: ['links'] },
  profile: { scalars: ['title', 'text'], lists: [] },
  experience: { scalars: ['company', 'role', 'location', 'start', 'end', 'description'], lists: ['bullets', 'achievements', 'technologies'] },
  project: { scalars: ['name', 'role', 'start', 'end', 'description', 'url'], lists: ['bullets', 'technologies'] },
  education: { scalars: ['institution', 'degree', 'field', 'location', 'start', 'end', 'description'], lists: [] },
  certification: { scalars: ['name', 'issuer', 'date', 'url'], lists: [] },
  skill: { scalars: ['name', 'category', 'level'], lists: [] },
  language: { scalars: ['name', 'level'], lists: [] },
  custom: { scalars: ['section', 'title', 'subtitle', 'date', 'text'], lists: ['bullets'] },
};

export const FIELD_LABELS: Record<string, string> = {
  fullName: 'Name',
  headline: 'Headline',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  title: 'Title',
  text: 'Text',
  company: 'Company',
  role: 'Job title',
  start: 'Start date',
  end: 'End date',
  description: 'Description',
  name: 'Name',
  url: 'Link',
  institution: 'School',
  degree: 'Degree',
  field: 'Field of study',
  issuer: 'Issuer',
  date: 'Date',
  category: 'Category',
  level: 'Level',
  section: 'Section',
  subtitle: 'Subtitle',
};

const NOISE = new Set(['sas', 'sa', 'sarl', 'inc', 'ltd', 'llc', 'gmbh', 'group', 'groupe', 'the', 'le', 'la', 'les', 'de', 'du', 'des', 'et', 'and', 'of', 'chez', 'at']);

function tokens(text: unknown): Set<string> {
  return new Set(
    normalizeForMatch(String(text ?? ''))
      .split(' ')
      .filter((t) => t && !NOISE.has(t)),
  );
}

export function similarity(a: unknown, b: unknown): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function sameName(a: unknown, b: unknown): boolean {
  const na = normalizeForMatch(String(a ?? ''));
  const nb = normalizeForMatch(String(b ?? ''));
  return na !== '' && na === nb;
}

function periodOf(d: Record<string, unknown>) {
  return { start: String(d.start ?? ''), end: String(d.end ?? ''), current: Boolean(d.current) };
}

/** Whether two records of the same kind describe the same thing. */
export function sameRecord(kind: RecordKind, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  switch (kind) {
    case 'experience': {
      const companyA = normalizeForMatch(String(a.company ?? ''));
      const companyB = normalizeForMatch(String(b.company ?? ''));
      const sameCompany =
        companyA !== '' &&
        companyB !== '' &&
        (companyA === companyB || similarity(companyA, companyB) >= 0.6 || companyA.includes(companyB) || companyB.includes(companyA));
      if (!sameCompany) return false;
      const roleSim = similarity(a.role, b.role) >= 0.5;
      const pa = periodOf(a);
      const pb = periodOf(b);
      const datesKnown = pa.start !== '' && pb.start !== '';
      return roleSim || (datesKnown && rangesOverlap(pa, pb)) || (!datesKnown && !a.role) || (!datesKnown && !b.role);
    }
    case 'education': {
      const sameSchool = similarity(a.institution, b.institution) >= 0.6;
      return sameSchool && (similarity(a.degree, b.degree) >= 0.5 || (a.end !== '' && a.end === b.end));
    }
    case 'project':
    case 'skill':
    case 'language':
    case 'certification':
      return sameName(a.name, b.name);
    case 'personal':
      return true;
    case 'profile':
      return sameName(a.text, b.text);
    case 'custom':
      return sameName(a.section, b.section) && sameName(a.title, b.title) && sameName(a.text, b.text);
  }
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

function valueKey(field: string, v: unknown): string {
  if (field === 'start' || field === 'end' || field === 'date') return String(v);
  if (typeof v === 'string') return normalizeForMatch(v);
  return JSON.stringify(v);
}

function displayValue(field: string, v: unknown, lang: Lang): string {
  if (field === 'end' && v === '__present__') return lang === 'fr' ? "Aujourd'hui" : 'Present';
  if ((field === 'start' || field === 'end' || field === 'date') && typeof v === 'string') return formatPartialDate(v, lang) || v;
  return String(v);
}

function listKey(v: unknown): string {
  if (v && typeof v === 'object' && 'url' in (v as Record<string, unknown>)) return normalizeForMatch(String((v as { url: string }).url));
  return normalizeForMatch(String(v));
}

function memberLabel(kind: RecordKind, d: Record<string, unknown>): string {
  switch (kind) {
    case 'experience':
      return [d.company, d.role].filter(Boolean).join(' · ');
    case 'education':
      return [d.institution, d.degree].filter(Boolean).join(' · ');
    case 'personal':
      return String(d.fullName || d.email || 'Personal details');
    case 'profile':
      return String(d.title || String(d.text ?? '').slice(0, 40));
    case 'custom':
      return String(d.title || d.section || 'Section');
    default:
      return String(d.name ?? '');
  }
}

/** Experience end is compared together with the "current" flag. */
function fieldValue(kind: RecordKind, field: string, d: Record<string, unknown>): unknown {
  if ((kind === 'experience' || kind === 'project') && field === 'end' && d.current) return '__present__';
  return d[field];
}

export function buildGroup(id: string, kind: RecordKind, lang: Lang, members: GroupMember[]): MergeGroup {
  const spec = SPECS[kind];
  const base: Record<string, unknown> = {};
  const conflicts: FieldConflict[] = [];
  for (const field of spec.scalars) {
    const options: FieldOption[] = [];
    for (const m of members) {
      const v = fieldValue(kind, field, m.data);
      if (isEmpty(v)) continue;
      const key = valueKey(field, v);
      const existing = options.find((o) => valueKey(field, o.value) === key);
      if (existing) {
        for (const s of m.sources) if (!existing.sources.some((x) => x.sourceId === s.sourceId)) existing.sources.push(s);
        existing.existing ||= m.origin === 'existing';
      } else {
        options.push({ value: v, display: displayValue(field, v, lang), sources: [...m.sources], existing: m.origin === 'existing' });
      }
    }
    if (options.length === 1) base[field] = options[0].value;
    else if (options.length > 1) conflicts.push({ field, label: FIELD_LABELS[field] ?? field, options });
    else base[field] = '';
  }
  for (const field of spec.lists) {
    const union: unknown[] = [];
    const seen = new Set<string>();
    for (const m of members) {
      for (const v of (m.data[field] as unknown[] | undefined) ?? []) {
        const k = listKey(v);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        union.push(v);
      }
    }
    base[field] = union;
  }
  const existing = members.find((m) => m.origin === 'existing');
  return {
    id,
    kind,
    lang,
    title: memberLabel(kind, { ...members[0].data, ...base }),
    members,
    base,
    conflicts,
    existingRecordId: existing ? existing.key : null,
  };
}

/** Groups candidates from several documents with each other and with matching library records. */
export function groupCandidates(items: SourcedCandidate[], existing: LibraryRecord[] = []): MergeGroup[] {
  type Proto = { kind: RecordKind; lang: Lang; members: GroupMember[] };
  const protos: Proto[] = [];
  const existingProtos = new Map<string, Proto>();

  for (const { candidate, source } of items) {
    const data = candidate.data as unknown as Record<string, unknown>;
    const member: GroupMember = {
      key: candidate.tempId,
      origin: 'candidate',
      data,
      sources: [source],
      label: memberLabel(candidate.kind, data),
    };
    // 1. an existing library record?
    const match = existing.find(
      (r) => r.kind === candidate.kind && r.lang === candidate.lang && sameRecord(r.kind, r.data as unknown as Record<string, unknown>, data),
    );
    if (match) {
      let proto = existingProtos.get(match.id);
      if (!proto) {
        const d = match.data as unknown as Record<string, unknown>;
        proto = {
          kind: match.kind,
          lang: match.lang,
          members: [{ key: match.id, origin: 'existing', data: d, sources: match.sources.length ? match.sources : [{ sourceId: 'library', label: 'Library' }], label: memberLabel(match.kind, d) }],
        };
        existingProtos.set(match.id, proto);
        protos.push(proto);
      }
      proto.members.push(member);
      continue;
    }
    // 2. another candidate?
    const group = protos.find(
      (p) =>
        p.kind === candidate.kind &&
        p.lang === candidate.lang &&
        !p.members.some((m) => m.origin === 'existing') &&
        p.members.some((m) => sameRecord(candidate.kind, m.data, data)),
    );
    if (group) group.members.push(member);
    else protos.push({ kind: candidate.kind, lang: candidate.lang, members: [member] });
  }
  return protos.map((p, i) => buildGroup(`g${i}`, p.kind, p.lang, p.members));
}

export interface GroupResolution {
  mode: 'merge' | 'separate';
  /** field -> index of the chosen option (merge mode). */
  choices: Record<string, number>;
  /** Manual edits made in the review screen (override base/choices). */
  edits?: Record<string, unknown>;
}

export class UnresolvedConflictError extends Error {
  constructor(fields: string[]) {
    super(`Choose a value for: ${fields.join(', ')}`);
    this.name = 'UnresolvedConflictError';
  }
}

function toRecordData(kind: RecordKind, data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if ((kind === 'experience' || kind === 'project') && 'end' in out) {
    if (out.end === '__present__') {
      out.end = '';
      out.current = true;
    } else if (kind === 'experience') {
      out.current = out.end === '' ? Boolean(out.current) : false;
    }
  }
  return out;
}

/** Turns a reviewed group into the records to save. Throws if a conflict is left unresolved. */
export function resolveGroup(group: MergeGroup, resolution: GroupResolution): ResolvedRecord[] {
  if (resolution.mode === 'separate' || group.members.length === 1) {
    return group.members
      .filter((m) => m.origin === 'candidate' || group.members.length === 1)
      .map((m) => ({
        existingRecordId: m.origin === 'existing' ? m.key : null,
        kind: group.kind,
        lang: group.lang,
        data: toRecordData(group.kind, { ...m.data, ...(group.members.length === 1 ? resolution.edits ?? {} : {}) }),
        sources: m.sources,
        fieldSources: {},
      }));
  }
  const missing = group.conflicts.filter((c) => resolution.choices[c.field] === undefined && !(resolution.edits && c.field in resolution.edits));
  if (missing.length) throw new UnresolvedConflictError(missing.map((c) => c.label));
  const data: Record<string, unknown> = { ...group.base };
  const fieldSources: Record<string, SourceRef | { user: true }> = {};
  for (const c of group.conflicts) {
    const idx = resolution.choices[c.field];
    if (idx === undefined) continue;
    const opt = c.options[idx];
    if (!opt) throw new UnresolvedConflictError([c.label]);
    data[c.field] = opt.value;
    fieldSources[c.field] = opt.sources[0];
  }
  for (const [field, value] of Object.entries(resolution.edits ?? {})) {
    data[field] = value;
    fieldSources[field] = { user: true };
  }
  const sources: SourceRef[] = [];
  for (const m of group.members) for (const s of m.sources) if (!sources.some((x) => x.sourceId === s.sourceId)) sources.push(s);
  return [
    {
      existingRecordId: group.existingRecordId,
      kind: group.kind,
      lang: group.lang,
      data: toRecordData(group.kind, data),
      sources,
      fieldSources,
    },
  ];
}
