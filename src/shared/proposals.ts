// Applying and checking AI proposals. A proposal never touches the document
// until the user accepts it; before applying we verify that the text or
// structure it was based on is still what the document contains.

import {
  PathError,
  addBlock,
  addBullet,
  addItem,
  blockTypeForRecord,
  createBlock,
  findBlock,
  findItem,
  getText,
  newBullet,
  newTextItem,
  parsePath,
  recordToItem,
  removeBullet,
  removeItem,
  reorderItems,
  setText,
} from './document';
import { stripMarkup } from './markup';
import { TEMPLATES } from './templates';
import type { BlockType, CvDocument, Item, LibraryRecord, Proposal } from './types';

export type ProposalCheck =
  | { state: 'ok' }
  | { state: 'stale'; current: string }
  | { state: 'missing'; message: string }
  | { state: 'informational' };

export type ApplyResult =
  | { ok: true; doc: CvDocument; label: string }
  | {
      ok: false;
      reason: 'stale' | 'missing' | 'needs-confirmation' | 'not-applicable' | 'not-pending' | 'invalid';
      message: string;
    };

/** Target helpers for structural proposals. */
export const itemRef = (blockId: string, itemId: string) => `entry:${blockId}:${itemId}`;
export const blockRef = (blockId: string) => `block:${blockId}`;
export const typeRef = (type: BlockType) => `type:${type}`;

export function parseRef(
  ref: string,
): { type: 'item'; blockId: string; itemId: string } | { type: 'block'; blockId: string } | { type: 'blockType'; blockType: BlockType } | null {
  let m = /^entry:([\w-]+):([\w-]+)$/.exec(ref);
  if (m) return { type: 'item', blockId: m[1], itemId: m[2] };
  m = /^block:([\w-]+)$/.exec(ref);
  if (m) return { type: 'block', blockId: m[1] };
  m = /^type:(\w+)$/.exec(ref);
  if (m) return { type: 'blockType', blockType: m[1] as BlockType };
  return null;
}

/** Plain text of a whole item, used as the conflict baseline for removals. */
export function itemPlainText(item: Item): string {
  switch (item.kind) {
    case 'text':
      return stripMarkup(item.text);
    case 'entry':
      return [item.title, item.org, item.text, ...item.bullets.map((b) => b.text)].map(stripMarkup).filter(Boolean).join(' | ');
    case 'tags':
      return [item.label, item.tags.join(', ')].filter(Boolean).join(': ');
    case 'pair':
      return [item.name, item.level].filter(Boolean).join(' — ');
  }
}

/** Current baseline text for a proposal target (null if the target no longer exists). */
export function currentBaseline(doc: CvDocument, p: Pick<Proposal, 'kind' | 'target'>): string | null {
  if (p.kind === 'rewrite') return getText(doc, p.target);
  if (p.kind === 'remove') {
    const path = parsePath(p.target);
    if (path?.type === 'bullet') return getText(doc, p.target);
    const ref = parseRef(p.target);
    if (ref?.type === 'item') {
      const item = findItem(doc, ref.blockId, ref.itemId);
      return item ? itemPlainText(item) : null;
    }
    return null;
  }
  return null;
}

/** Checks whether a proposal can still be applied to the document as is. */
export function checkProposal(doc: CvDocument, p: Proposal, records: LibraryRecord[] = []): ProposalCheck {
  switch (p.kind) {
    case 'comment':
    case 'question':
      return { state: 'informational' };
    case 'rewrite':
    case 'remove': {
      const current = currentBaseline(doc, p);
      if (current === null) return { state: 'missing', message: 'The text this suggestion refers to was removed.' };
      if (current !== p.baseText) return { state: 'stale', current };
      return { state: 'ok' };
    }
    case 'insert': {
      const ref = parseRef(p.target);
      if (ref?.type === 'item') {
        const item = findItem(doc, ref.blockId, ref.itemId);
        if (!item || item.kind !== 'entry') return { state: 'missing', message: 'The entry this suggestion adds to was removed.' };
        if (p.afterId && !item.bullets.some((b) => b.id === p.afterId)) {
          return { state: 'stale', current: itemPlainText(item) };
        }
        return { state: 'ok' };
      }
      if (ref?.type === 'block') {
        const block = findBlock(doc, ref.blockId);
        if (!block) return { state: 'missing', message: 'The section this suggestion adds to was removed.' };
        if (p.afterId && !block.items.some((i) => i.id === p.afterId)) return { state: 'stale', current: '' };
        return { state: 'ok' };
      }
      return { state: 'missing', message: 'Unknown target.' };
    }
    case 'reorder': {
      const ref = parseRef(p.target);
      const block = ref?.type === 'block' ? findBlock(doc, ref.blockId) : undefined;
      if (!block) return { state: 'missing', message: 'The section to reorder was removed.' };
      const current = block.items.map((i) => i.id);
      if (current.join('|') !== p.baseOrder.join('|')) return { state: 'stale', current: current.join('|') };
      return { state: 'ok' };
    }
    case 'library': {
      const record = records.find((r) => r.id === p.recordId);
      if (!record) return { state: 'missing', message: 'The library record was removed.' };
      const ref = parseRef(p.target);
      if (ref?.type === 'block' && !findBlock(doc, ref.blockId)) {
        return { state: 'missing', message: 'The section this suggestion adds to was removed.' };
      }
      return { state: 'ok' };
    }
  }
}

function insertLibraryItem(doc: CvDocument, p: Proposal, record: LibraryRecord): CvDocument {
  const item = recordToItem(record);
  if (!item) throw new Error('This kind of record cannot be added to a CV.');
  const ref = parseRef(p.target);
  if (ref?.type === 'block') return addItem(doc, ref.blockId, item, p.afterId);
  const type = ref?.type === 'blockType' ? ref.blockType : blockTypeForRecord(record);
  if (!type) throw new Error('No section for this record.');
  const existing = doc.blocks.find((b) => b.type === type);
  if (existing) return addItem(doc, existing.id, item, p.afterId);
  const block = createBlock(type, doc.lang, TEMPLATES[doc.template].defaultZone(type));
  return addItem(addBlock(doc, block), block.id, item);
}

/**
 * Applies an accepted proposal. `editedText` replaces the proposed text when
 * the user edited the suggestion before accepting.
 */
export function applyProposal(
  doc: CvDocument,
  p: Proposal,
  opts: { records?: LibraryRecord[]; editedText?: string } = {},
): ApplyResult {
  if (p.status !== 'pending' && p.status !== 'stale') {
    return { ok: false, reason: 'not-pending', message: 'This suggestion was already handled.' };
  }
  if (p.kind === 'comment' || p.kind === 'question') {
    return { ok: false, reason: 'not-applicable', message: 'Comments and questions do not change your CV.' };
  }
  if (p.unverified.length > 0 && !p.confirmed) {
    return {
      ok: false,
      reason: 'needs-confirmation',
      message: `Confirm that this is true about you first: ${p.unverified.join(', ')}.`,
    };
  }
  const check = checkProposal(doc, p, opts.records ?? []);
  if (check.state === 'stale') {
    return { ok: false, reason: 'stale', message: 'The text changed after this suggestion was made. Review the conflict or regenerate.' };
  }
  if (check.state === 'missing') return { ok: false, reason: 'missing', message: check.message };

  const text = opts.editedText ?? p.proposedText;
  try {
    switch (p.kind) {
      case 'rewrite':
        if (!text.trim()) return { ok: false, reason: 'invalid', message: 'The replacement text is empty.' };
        return { ok: true, doc: setText(doc, p.target, text), label: 'Accept suggestion' };
      case 'remove': {
        const path = parsePath(p.target);
        if (path?.type === 'bullet') {
          return { ok: true, doc: removeBullet(doc, path.blockId, path.itemId, path.bulletId), label: 'Remove bullet' };
        }
        const ref = parseRef(p.target);
        if (ref?.type === 'item') return { ok: true, doc: removeItem(doc, ref.blockId, ref.itemId), label: 'Remove entry' };
        return { ok: false, reason: 'invalid', message: 'Unsupported removal target.' };
      }
      case 'insert': {
        if (!text.trim()) return { ok: false, reason: 'invalid', message: 'The text to add is empty.' };
        const ref = parseRef(p.target);
        if (ref?.type === 'item') {
          return { ok: true, doc: addBullet(doc, ref.blockId, ref.itemId, newBullet(text), p.afterId), label: 'Add bullet' };
        }
        if (ref?.type === 'block') {
          return { ok: true, doc: addItem(doc, ref.blockId, newTextItem(text), p.afterId), label: 'Add paragraph' };
        }
        return { ok: false, reason: 'invalid', message: 'Unsupported insertion target.' };
      }
      case 'reorder': {
        const ref = parseRef(p.target);
        if (ref?.type !== 'block') return { ok: false, reason: 'invalid', message: 'Unsupported reorder target.' };
        return { ok: true, doc: reorderItems(doc, ref.blockId, p.proposedOrder), label: 'Reorder entries' };
      }
      case 'library': {
        const record = (opts.records ?? []).find((r) => r.id === p.recordId)!;
        return { ok: true, doc: insertLibraryItem(doc, p, record), label: 'Add from library' };
      }
    }
  } catch (e) {
    if (e instanceof PathError) return { ok: false, reason: 'missing', message: e.message };
    return { ok: false, reason: 'invalid', message: (e as Error).message };
  }
}

/** Recomputes pending/stale state of proposals against the current document. */
export function refreshStaleness(doc: CvDocument, proposals: Proposal[], records: LibraryRecord[] = []): Proposal[] {
  return proposals.map((p) => {
    if (p.status !== 'pending' && p.status !== 'stale') return p;
    const c = checkProposal(doc, p, records);
    const status = c.state === 'stale' || c.state === 'missing' ? 'stale' : 'pending';
    return status === p.status ? p : { ...p, status };
  });
}

export function isActionable(p: Proposal): boolean {
  return (p.status === 'pending' || p.status === 'stale') && p.kind !== 'comment' && p.kind !== 'question';
}
