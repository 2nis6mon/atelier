// Builds the minimal context an AI request needs, with short identifiers the
// model must use to reference targets. The same structure produces the
// "context used" chips shown to the user before and after sending.

import { formatRange } from '../dates';
import { bulletPath, documentToPlainText, getText, itemPath, itemTitle, parsePath } from '../document';
import { normalizeForMatch } from '../lang';
import { stripMarkup } from '../markup';
import { itemRef } from '../proposals';
import { BLOCK_TYPE_LABELS } from '../templates';
import type { AiRequestInput, Block, CvDocument, Item, Lang, LibraryRecord } from '../types';
import { AiError } from './errors';

export const MAX_CONTEXT_CHARS = 32_000;

export interface ContextTarget {
  id: string; // T1…
  path: string; // document field path
  label: string;
  text: string;
  kind: 'field' | 'bullet';
}

export interface ContextEntry {
  id: string; // E1…
  ref: string; // entry:<block>:<item>
  blockId: string;
  itemId: string;
  label: string;
  isEntry: boolean;
  targetIds: string[];
}

export interface ContextSection {
  id: string; // S1…
  blockId: string;
  type: Block['type'];
  title: string;
  entryIds: string[];
}

export interface ContextLibraryItem {
  id: string; // L1…
  recordId: string;
  kind: LibraryRecord['kind'];
  label: string;
  text: string;
}

export interface OfferContext {
  company: string;
  role: string;
  text: string;
  notes: string;
}

export interface AiContext {
  lang: Lang;
  request: AiRequestInput;
  targets: ContextTarget[];
  entries: ContextEntry[];
  sections: ContextSection[];
  library: ContextLibraryItem[];
  offer: OfferContext | null;
  selectionText: string;
  /** User's own content (for the fact guard). Never includes the offer. */
  evidenceText: string;
  labels: string[];
  charCount: number;
}

export function recordLabel(r: LibraryRecord): string {
  const d = r.data as unknown as Record<string, unknown>;
  switch (r.kind) {
    case 'experience':
      return [d.company, d.role].filter(Boolean).join(' — ');
    case 'education':
      return [d.institution, d.degree].filter(Boolean).join(' — ');
    case 'personal':
      return String(d.fullName || 'Personal details');
    case 'profile':
      return String(d.title || 'Profile');
    case 'custom':
      return String(d.title || d.section || 'Custom');
    default:
      return String(d.name ?? r.kind);
  }
}

export function recordText(r: LibraryRecord): string {
  const d = r.data as unknown as Record<string, unknown>;
  const lines: string[] = [];
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).map(String) : []);
  switch (r.kind) {
    case 'experience':
      lines.push(`${str('role')} — ${str('company')}${str('location') ? `, ${str('location')}` : ''} (${formatRange(str('start'), str('end'), Boolean(d.current), r.lang)})`);
      if (str('description')) lines.push(str('description'));
      for (const b of [...list('bullets'), ...list('achievements')]) lines.push(`• ${b}`);
      if (list('technologies').length) lines.push(`Technologies: ${list('technologies').join(', ')}`);
      break;
    case 'project':
      lines.push(`${str('name')}${str('role') ? ` — ${str('role')}` : ''}`);
      if (str('description')) lines.push(str('description'));
      for (const b of list('bullets')) lines.push(`• ${b}`);
      break;
    case 'education':
      lines.push(`${str('degree')} ${str('field')} — ${str('institution')} (${formatRange(str('start'), str('end'), false, r.lang)})`);
      if (str('description')) lines.push(str('description'));
      break;
    case 'certification':
      lines.push(`${str('name')}${str('issuer') ? ` — ${str('issuer')}` : ''}${str('date') ? ` (${str('date')})` : ''}`);
      break;
    case 'skill':
      lines.push(`${str('name')}${str('category') ? ` (${str('category')})` : ''}${str('level') ? ` — ${str('level')}` : ''}`);
      break;
    case 'language':
      lines.push(`${str('name')}${str('level') ? ` — ${str('level')}` : ''}`);
      break;
    case 'profile':
      lines.push(str('text'));
      break;
    case 'personal':
      lines.push(`${str('fullName')} — ${str('headline')}`);
      break;
    case 'custom':
      lines.push(`${str('title')} ${str('subtitle')}`.trim());
      if (str('text')) lines.push(str('text'));
      for (const b of list('bullets')) lines.push(`• ${b}`);
      break;
  }
  return lines.map(stripMarkup).join('\n');
}

/** Library records most related to a text (keyword overlap), for pre-selection in the UI. */
export function suggestLibraryRecords(records: LibraryRecord[], doc: CvDocument, query: string, limit = 5): LibraryRecord[] {
  const qTokens = new Set(normalizeForMatch(query).split(' ').filter((t) => t.length > 2));
  const inCv = new Set(doc.blocks.flatMap((b) => b.items.map((i) => i.recordId).filter(Boolean)));
  const scored = records
    .filter((r) => r.kind !== 'personal' && !inCv.has(r.id))
    .map((r) => {
      const tokens = normalizeForMatch(recordText(r)).split(' ');
      let score = 0;
      for (const t of tokens) if (qTokens.has(t)) score++;
      if (r.lang === doc.lang) score += 0.5;
      return { r, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.r);
}

function itemTargets(block: Block, item: Item): Array<{ path: string; kind: 'field' | 'bullet' }> {
  switch (item.kind) {
    case 'text':
      return [{ path: itemPath(block.id, item.id, 'text'), kind: 'field' }];
    case 'entry':
      return [
        ...(item.title ? [{ path: itemPath(block.id, item.id, 'title'), kind: 'field' as const }] : []),
        ...(item.text ? [{ path: itemPath(block.id, item.id, 'text'), kind: 'field' as const }] : []),
        ...item.bullets.map((b) => ({ path: bulletPath(block.id, item.id, b.id), kind: 'bullet' as const })),
      ];
    case 'tags':
      return [{ path: itemPath(block.id, item.id, 'tags'), kind: 'field' }];
    case 'pair':
      return [{ path: itemPath(block.id, item.id, 'level'), kind: 'field' }];
  }
}

export interface BuildContextInput {
  doc: CvDocument;
  request: AiRequestInput;
  records: LibraryRecord[];
  offer: OfferContext | null;
}

export function buildAiContext({ doc, request, records, offer }: BuildContextInput): AiContext {
  const targets: ContextTarget[] = [];
  const entries: ContextEntry[] = [];
  const sections: ContextSection[] = [];
  const labels: string[] = [];
  let selectionText = '';

  const addTarget = (path: string, kind: 'field' | 'bullet', label: string): string => {
    const id = `T${targets.length + 1}`;
    targets.push({ id, path, label, text: getText(doc, path) ?? '', kind });
    return id;
  };

  const addBlock = (block: Block) => {
    const section: ContextSection = { id: `S${sections.length + 1}`, blockId: block.id, type: block.type, title: block.title, entryIds: [] };
    sections.push(section);
    for (const item of block.items) {
      if (item.hidden) continue;
      const entry: ContextEntry = {
        id: `E${entries.length + 1}`,
        ref: itemRef(block.id, item.id),
        blockId: block.id,
        itemId: item.id,
        label:
          item.kind === 'entry'
            ? `${[item.title, item.org].filter(Boolean).map(stripMarkup).join(' — ')} (${formatRange(item.start, item.end, item.current, doc.lang)})`
            : itemTitle(item),
        isEntry: item.kind === 'entry',
        targetIds: [],
      };
      entries.push(entry);
      section.entryIds.push(entry.id);
      for (const t of itemTargets(block, item)) entry.targetIds.push(addTarget(t.path, t.kind, entry.label));
    }
  };

  const scope = request.scope;
  if (scope.type === 'selection') {
    const p = scope.target ? parsePath(scope.target) : null;
    if (!p || getText(doc, scope.target!) === null) throw new AiError('unsupported', 'The selected text is no longer in the CV.');
    const text = getText(doc, scope.target!)!;
    selectionText = scope.selectionText && stripMarkup(text).includes(scope.selectionText) ? scope.selectionText : '';
    if (p.type === 'item' || p.type === 'bullet') {
      const block = doc.blocks.find((b) => b.id === p.blockId)!;
      const item = block.items.find((i) => i.id === p.itemId)!;
      const entry: ContextEntry = {
        id: 'E1',
        ref: itemRef(block.id, item.id),
        blockId: block.id,
        itemId: item.id,
        label: item.kind === 'entry' ? `${stripMarkup(item.title)} — ${stripMarkup(item.org)}` : itemTitle(item),
        isEntry: item.kind === 'entry',
        targetIds: [],
      };
      entries.push(entry);
      sections.push({ id: 'S1', blockId: block.id, type: block.type, title: block.title, entryIds: ['E1'] });
      entry.targetIds.push(addTarget(scope.target!, p.type === 'bullet' ? 'bullet' : 'field', entry.label));
    } else {
      addTarget(scope.target!, 'field', p.type === 'blockTitle' ? 'Section title' : 'Header');
    }
    labels.push(selectionText ? 'Selected text' : 'Selected paragraph');
  } else if (scope.type === 'section') {
    const block = doc.blocks.find((b) => b.id === scope.target);
    if (!block) throw new AiError('unsupported', 'The selected section is no longer in the CV.');
    addBlock(block);
    labels.push(`Section: ${block.title || BLOCK_TYPE_LABELS[block.type]}`);
  } else {
    if (doc.header.headline) addTarget('header.headline', 'field', 'Headline');
    for (const block of doc.blocks) if (!block.hidden) addBlock(block);
    labels.push('Whole CV');
  }

  const selected = new Set(request.libraryRecordIds);
  const library: ContextLibraryItem[] = records
    .filter((r) => selected.has(r.id))
    .map((r, i) => ({ id: `L${i + 1}`, recordId: r.id, kind: r.kind, label: recordLabel(r), text: recordText(r) }));
  if (library.length) labels.push(`${library.length} library record${library.length > 1 ? 's' : ''}`);

  const useOffer = request.includeOffer && offer && offer.text.trim() ? offer : null;
  if (useOffer) labels.push(`Job offer${useOffer.company ? ` — ${useOffer.company}` : ''}`);
  if (useOffer?.notes.trim()) labels.push('My notes');
  if (request.instructions.trim()) labels.push('Your instructions');

  const evidenceText = [documentToPlainText(doc, true), ...library.map((l) => l.text)].join('\n');
  const charCount =
    targets.reduce((n, t) => n + t.text.length + 20, 0) +
    library.reduce((n, l) => n + l.text.length + 40, 0) +
    (useOffer ? useOffer.text.length + useOffer.notes.length : 0) +
    request.instructions.length;
  if (charCount > MAX_CONTEXT_CHARS) throw new AiError('too-large', `${charCount} characters`);

  // Section headings of the whole CV are useful structure hints for add-from-library.
  if (scope.type !== 'cv') {
    for (const block of doc.blocks) {
      if (block.hidden || sections.some((s) => s.blockId === block.id)) continue;
      if (request.action === 'recover' || request.action === 'adapt' || request.action === 'chat') {
        sections.push({ id: `S${sections.length + 1}`, blockId: block.id, type: block.type, title: block.title, entryIds: [] });
      }
    }
  }
  return {
    lang: doc.lang,
    request,
    targets,
    entries,
    sections,
    library,
    offer: useOffer,
    selectionText,
    evidenceText,
    labels,
    charCount,
  };
}
