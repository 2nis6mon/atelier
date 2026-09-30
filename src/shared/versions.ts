import { BLOCK_TYPE_LABELS, TEMPLATES } from './templates';
import { describePath, documentHash, itemTitle, listTextFields } from './document';
import { stripMarkup } from './markup';
import type { CvDocument, CvStyle, CvVersion, VersionKind } from './types';

export class ImmutableVersionError extends Error {
  constructor() {
    super('Sent versions never change. Create a new draft from it instead.');
    this.name = 'ImmutableVersionError';
  }
}

export function assertMutable(version: Pick<CvVersion, 'locked'>): void {
  if (version.locked) throw new ImmutableVersionError();
}

export function nextVersionNumber(numbers: number[]): number {
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

export function versionLabel(kind: VersionKind, n: number): string {
  return kind === 'sent' ? `Sent v${n}` : `Saved v${n}`;
}

/** Verifies that a stored snapshot still matches its recorded hash. */
export function verifySnapshot(version: Pick<CvVersion, 'document' | 'docHash'>): boolean {
  return documentHash(version.document) === version.docHash;
}

export interface DocChange {
  kind: 'changed' | 'added' | 'removed' | 'hidden' | 'shown' | 'moved' | 'layout' | 'style';
  label: string;
  before?: string;
  after?: string;
}

const STYLE_NAMES: Record<keyof CvStyle, string> = {
  bodyFont: 'Body font',
  headingFont: 'Heading font',
  fontSize: 'Font size',
  lineHeight: 'Line spacing',
  headingColor: 'Heading colour',
  accentColor: 'Accent colour',
  textColor: 'Text colour',
  marginMm: 'Margins',
  sectionSpacing: 'Section spacing',
  sidebarWidth: 'Sidebar width',
};

/** Human-readable list of differences between two versions of a CV. */
export function compareDocuments(before: CvDocument, after: CvDocument): DocChange[] {
  const changes: DocChange[] = [];
  if (before.template !== after.template) {
    changes.push({
      kind: 'layout',
      label: 'Template',
      before: TEMPLATES[before.template].label,
      after: TEMPLATES[after.template].label,
    });
  }
  for (const key of Object.keys(STYLE_NAMES) as Array<keyof CvStyle>) {
    if (before.style[key] !== after.style[key]) {
      changes.push({ kind: 'style', label: STYLE_NAMES[key], before: String(before.style[key]), after: String(after.style[key]) });
    }
  }
  const beforeBlocks = new Map(before.blocks.map((b) => [b.id, b]));
  const afterBlocks = new Map(after.blocks.map((b) => [b.id, b]));
  for (const b of after.blocks) {
    const old = beforeBlocks.get(b.id);
    const name = b.title || BLOCK_TYPE_LABELS[b.type];
    if (!old) {
      changes.push({ kind: 'added', label: `Section “${name}”` });
      continue;
    }
    if (old.hidden !== b.hidden) changes.push({ kind: b.hidden ? 'hidden' : 'shown', label: `Section “${name}”` });
    if (old.zone !== b.zone) changes.push({ kind: 'moved', label: `Section “${name}”`, before: old.zone, after: b.zone });
    const oldItems = new Map(old.items.map((i) => [i.id, i]));
    const newIds = new Set(b.items.map((i) => i.id));
    for (const item of b.items) {
      const o = oldItems.get(item.id);
      if (!o) changes.push({ kind: 'added', label: `${name} › ${itemTitle(item) || 'entry'}` });
      else if (Boolean(o.hidden) !== Boolean(item.hidden)) {
        changes.push({ kind: item.hidden ? 'hidden' : 'shown', label: `${name} › ${itemTitle(item) || 'entry'}` });
      }
    }
    for (const o of old.items) if (!newIds.has(o.id)) changes.push({ kind: 'removed', label: `${name} › ${itemTitle(o) || 'entry'}` });
    const commonOld = old.items.filter((i) => newIds.has(i.id)).map((i) => i.id);
    const commonNew = b.items.filter((i) => oldItems.has(i.id)).map((i) => i.id);
    if (commonOld.join('|') !== commonNew.join('|')) changes.push({ kind: 'moved', label: `${name} › order of entries` });
  }
  for (const b of before.blocks) {
    if (!afterBlocks.has(b.id)) changes.push({ kind: 'removed', label: `Section “${b.title || BLOCK_TYPE_LABELS[b.type]}”` });
  }
  const orderBefore = before.blocks.filter((b) => afterBlocks.has(b.id)).map((b) => b.id);
  const orderAfter = after.blocks.filter((b) => beforeBlocks.has(b.id)).map((b) => b.id);
  if (orderBefore.join('|') !== orderAfter.join('|')) changes.push({ kind: 'moved', label: 'Order of sections' });

  const beforeFields = new Map(listTextFields(before, true).map((f) => [f.path, f.text]));
  for (const f of listTextFields(after, true)) {
    const old = beforeFields.get(f.path);
    if (old !== undefined && old !== f.text) {
      changes.push({ kind: 'changed', label: describePath(after, f.path), before: stripMarkup(old), after: stripMarkup(f.text) });
    }
  }
  return changes;
}
