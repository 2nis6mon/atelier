// Validates the model's tool output and turns it into proposals. Anything
// that does not reference known identifiers is dropped (and reported), and
// every proposed text goes through the fact guard.

import { z } from 'zod';
import { getText } from '../document';
import { stripMarkup } from '../markup';
import { blockRef, currentBaseline, itemRef, typeRef } from '../proposals';
import type { Citation, Proposal, ProposalKind } from '../types';
import type { AiContext } from './context';
import { AiError } from './errors';
import { checkFacts } from './guard';

const Suggestion = z.object({
  type: z.enum(['rewrite', 'add_bullet', 'remove', 'reorder', 'add_from_library', 'question', 'comment', 'duplicate', 'contradiction']),
  target: z.string().max(20).nullish(),
  entry: z.string().max(20).nullish(),
  after: z.string().max(20).nullish(),
  section: z.string().max(20).nullish(),
  order: z.array(z.string().max(20)).max(200).nullish(),
  record: z.string().max(20).nullish(),
  records: z.array(z.string().max(20)).max(50).nullish(),
  field: z.string().max(60).nullish(),
  text: z.string().max(6000).nullish(),
  explanation: z.string().max(1200).nullish(),
  evidence: z.array(z.string().max(20)).max(30).nullish(),
});

export const ResponseSchema = z.object({
  summary: z.string().max(4000).nullish(),
  suggestions: z.array(Suggestion).max(60),
});

export type RawResponse = z.infer<typeof ResponseSchema>;

export interface ConsolidationFinding {
  type: 'duplicate' | 'contradiction';
  recordIds: string[];
  field: string;
  explanation: string;
}

export interface MappedResponse {
  summary: string;
  proposals: Proposal[];
  findings: ConsolidationFinding[];
  dropped: string[];
}

/** Parses a tool input (object or JSON string). Throws AiError('bad-response') when invalid. */
export function parseToolInput(input: unknown): RawResponse {
  let value = input;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new AiError('bad-response', 'Tool arguments are not valid JSON.');
    }
  }
  const result = ResponseSchema.safeParse(value);
  if (!result.success) throw new AiError('bad-response', result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ').slice(0, 500));
  return result.data;
}

export interface MapOptions {
  cvId: string;
  requestId: string;
  now: string;
  newId: () => string;
  /** Current document at the time the request was sent (for base texts). */
  doc: Parameters<typeof getText>[0];
}

export function mapResponse(ctx: AiContext, raw: RawResponse, opts: MapOptions): MappedResponse {
  const dropped: string[] = [];
  const proposals: Proposal[] = [];
  const findings: ConsolidationFinding[] = [];
  const targets = new Map(ctx.targets.map((t) => [t.id, t]));
  const entries = new Map(ctx.entries.map((e) => [e.id, e]));
  const sections = new Map(ctx.sections.map((s) => [s.id, s]));
  const library = new Map(ctx.library.map((l) => [l.id, l]));
  const offerText = ctx.offer?.text ?? '';
  const strict = ctx.request.action !== 'translate';

  const citationsFor = (ids: readonly string[] | null | undefined): Citation[] => {
    const out: Citation[] = [];
    for (const id of ids ?? []) {
      if (targets.has(id) || entries.has(id) || sections.has(id)) {
        if (!out.some((c) => c.type === 'cv')) out.push({ type: 'cv', label: 'Current CV' });
      } else if (library.has(id)) {
        const l = library.get(id)!;
        out.push({ type: 'library', id: l.recordId, label: l.label });
      } else if (id === 'OFFER' && ctx.offer) {
        out.push({ type: 'offer', label: `Job offer${ctx.offer.company ? ` — ${ctx.offer.company}` : ''}` });
      }
    }
    return out;
  };

  const make = (kind: ProposalKind, fields: Partial<Proposal>): Proposal => ({
    id: opts.newId(),
    cvId: opts.cvId,
    requestId: opts.requestId,
    kind,
    target: '',
    baseText: '',
    proposedText: '',
    baseOrder: [],
    proposedOrder: [],
    recordId: null,
    afterId: null,
    explanation: '',
    citations: [],
    unverified: [],
    confirmed: false,
    status: 'pending',
    createdAt: opts.now,
    updatedAt: opts.now,
    ...fields,
  });

  const guard = (text: string, base: string): string[] => {
    // The base text of the field counts as evidence (e.g. for translations).
    const g = checkFacts(text, `${ctx.evidenceText}\n${base}`, offerText, strict);
    return [...g.offerOnly.map((t) => `${t} (only in the job offer)`), ...g.unverified];
  };

  const allowEdits = ctx.request.action !== 'comment' && ctx.request.action !== 'consolidate';

  raw.suggestions.forEach((s, index) => {
    const n = `Suggestion ${index + 1}`;
    const explanation = (s.explanation ?? '').trim();
    const citations = citationsFor(s.evidence);
    switch (s.type) {
      case 'rewrite': {
        const t = s.target ? targets.get(s.target) : undefined;
        const text = (s.text ?? '').trim();
        if (!allowEdits) return void dropped.push(`${n}: edits are not allowed for this request.`);
        if (!t) return void dropped.push(`${n}: unknown target ${s.target ?? '(none)'}.`);
        if (!text) return void dropped.push(`${n}: empty text.`);
        const base = getText(opts.doc, t.path) ?? t.text;
        if (stripMarkup(text) === stripMarkup(base)) return void dropped.push(`${n}: no change proposed.`);
        proposals.push(
          make('rewrite', {
            target: t.path,
            baseText: base,
            proposedText: text,
            explanation,
            citations: citations.length ? citations : [{ type: 'cv', label: 'Current CV' }],
            unverified: guard(text, base),
          }),
        );
        return;
      }
      case 'add_bullet': {
        const e = s.entry ? entries.get(s.entry) : undefined;
        const text = (s.text ?? '').trim();
        if (!allowEdits) return void dropped.push(`${n}: edits are not allowed for this request.`);
        if (!e || !e.isEntry) return void dropped.push(`${n}: unknown entry ${s.entry ?? '(none)'}.`);
        if (!text) return void dropped.push(`${n}: empty text.`);
        const after = s.after ? targets.get(s.after) : undefined;
        const afterBullet = after && after.kind === 'bullet' ? after.path.split(':').pop()! : null;
        proposals.push(
          make('insert', {
            target: itemRef(e.blockId, e.itemId),
            afterId: afterBullet,
            proposedText: text,
            explanation,
            citations,
            unverified: guard(text, ''),
          }),
        );
        return;
      }
      case 'remove': {
        if (!allowEdits) return void dropped.push(`${n}: edits are not allowed for this request.`);
        const t = s.target ? targets.get(s.target) : undefined;
        const e = s.target ? entries.get(s.target) : undefined;
        if (t && t.kind === 'bullet') {
          proposals.push(make('remove', { target: t.path, baseText: getText(opts.doc, t.path) ?? t.text, explanation, citations }));
          return;
        }
        if (e) {
          const target = itemRef(e.blockId, e.itemId);
          proposals.push(make('remove', { target, baseText: currentBaseline(opts.doc, { kind: 'remove', target }) ?? '', explanation, citations }));
          return;
        }
        return void dropped.push(`${n}: unknown removal target ${s.target ?? '(none)'}.`);
      }
      case 'reorder': {
        if (!allowEdits) return void dropped.push(`${n}: edits are not allowed for this request.`);
        const sec = s.section ? sections.get(s.section) : undefined;
        if (!sec) return void dropped.push(`${n}: unknown section ${s.section ?? '(none)'}.`);
        const block = opts.doc.blocks.find((b) => b.id === sec.blockId);
        if (!block) return void dropped.push(`${n}: section no longer exists.`);
        const order = (s.order ?? []).map((id) => entries.get(id));
        const current = block.items.map((i) => i.id);
        const visible = sec.entryIds.map((id) => entries.get(id)!.itemId);
        if (order.some((x) => !x) || order.length !== visible.length || !visible.every((id) => order.some((o) => o!.itemId === id))) {
          return void dropped.push(`${n}: the new order must list every entry of the section exactly once.`);
        }
        // hidden items keep their relative position at the end
        const proposed = [...order.map((o) => o!.itemId), ...current.filter((id) => !visible.includes(id))];
        if (proposed.join('|') === current.join('|')) return void dropped.push(`${n}: order unchanged.`);
        proposals.push(make('reorder', { target: blockRef(sec.blockId), baseOrder: current, proposedOrder: proposed, explanation, citations }));
        return;
      }
      case 'add_from_library': {
        if (!allowEdits) return void dropped.push(`${n}: edits are not allowed for this request.`);
        const l = s.record ? library.get(s.record) : undefined;
        if (!l) return void dropped.push(`${n}: unknown library record ${s.record ?? '(none)'}.`);
        const sec = s.section ? sections.get(s.section) : undefined;
        const kindToBlock: Record<string, Parameters<typeof typeRef>[0]> = {
          experience: 'experience',
          project: 'projects',
          education: 'education',
          certification: 'certifications',
          skill: 'skills',
          language: 'languages',
          profile: 'profile',
          custom: 'custom',
        };
        const blockType = kindToBlock[l.kind];
        if (!blockType) return void dropped.push(`${n}: this kind of record cannot be added.`);
        const target = sec && sec.type === blockType ? blockRef(sec.blockId) : typeRef(blockType);
        proposals.push(
          make('library', {
            target,
            recordId: l.recordId,
            proposedText: l.text,
            explanation,
            citations: [{ type: 'library', id: l.recordId, label: l.label }, ...citations.filter((c) => c.id !== l.recordId)],
          }),
        );
        return;
      }
      case 'question':
      case 'comment': {
        const text = (s.text ?? '').trim();
        if (!text) return void dropped.push(`${n}: empty ${s.type}.`);
        const t = s.target ? targets.get(s.target) : undefined;
        proposals.push(make(s.type, { target: t?.path ?? '', proposedText: text, explanation, citations }));
        return;
      }
      case 'duplicate':
      case 'contradiction': {
        const ids = (s.records ?? []).map((id) => library.get(id)?.recordId).filter((x): x is string => Boolean(x));
        if (ids.length < 2) return void dropped.push(`${n}: needs at least two known library records.`);
        findings.push({ type: s.type, recordIds: ids, field: s.field ?? '', explanation: explanation || (s.text ?? '') });
        return;
      }
    }
  });

  return { summary: (raw.summary ?? '').trim(), proposals, findings, dropped };
}
