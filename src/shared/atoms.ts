// Splits a CV into the smallest units that must stay together on a page
// ("atoms"): the header, section titles, entry headings, paragraphs,
// bullets, skill groups and language rows. The renderer measures them and
// `paginate()` assigns them to A4 pages.

import { effectiveZone } from './document';
import type { CvDocument, Zone } from './types';

export type AtomKind = 'header' | 'blockTitle' | 'text' | 'entryHead' | 'entryText' | 'bullet' | 'tags' | 'pair';

export interface AtomSpec {
  id: string;
  kind: AtomKind;
  zone: Zone;
  blockId: string;
  itemId: string | null;
  bulletId: string | null;
  keepWithNext: boolean;
  breakBefore: boolean;
  /** First atom of its section (used for section spacing). */
  firstInBlock: boolean;
  /** Last atom of an entry item (used for spacing between entries). */
  lastInItem: boolean;
}

export const HEADER_ATOM = 'header';

export function buildAtoms(doc: CvDocument, opts: { headerInFlow: boolean }): AtomSpec[] {
  const atoms: AtomSpec[] = [];
  if (opts.headerInFlow) {
    atoms.push({ id: HEADER_ATOM, kind: 'header', zone: 'main', blockId: HEADER_ATOM, itemId: null, bulletId: null, keepWithNext: false, breakBefore: false, firstInBlock: true, lastInItem: true });
  }
  for (const block of doc.blocks) {
    if (block.hidden) continue;
    const items = block.items.filter((i) => !i.hidden);
    if (items.length === 0) continue;
    const zone = effectiveZone(doc, block);
    const base = { zone, blockId: block.id, bulletId: null as string | null };
    atoms.push({ ...base, id: `t:${block.id}`, kind: 'blockTitle', itemId: null, keepWithNext: true, breakBefore: doc.pageBreaks.includes(block.id), firstInBlock: true, lastInItem: false });
    for (const item of items) {
      switch (item.kind) {
        case 'text':
          atoms.push({ ...base, id: `x:${item.id}`, kind: 'text', itemId: item.id, keepWithNext: false, breakBefore: false, firstInBlock: false, lastInItem: true });
          break;
        case 'tags':
          atoms.push({ ...base, id: `g:${item.id}`, kind: 'tags', itemId: item.id, keepWithNext: false, breakBefore: false, firstInBlock: false, lastInItem: true });
          break;
        case 'pair':
          atoms.push({ ...base, id: `p:${item.id}`, kind: 'pair', itemId: item.id, keepWithNext: false, breakBefore: false, firstInBlock: false, lastInItem: true });
          break;
        case 'entry': {
          const bullets = item.bullets;
          const hasText = item.text.trim() !== '';
          atoms.push({ ...base, id: `e:${item.id}`, kind: 'entryHead', itemId: item.id, keepWithNext: hasText || bullets.length > 0, breakBefore: false, firstInBlock: false, lastInItem: !hasText && bullets.length === 0 });
          if (hasText) {
            atoms.push({ ...base, id: `d:${item.id}`, kind: 'entryText', itemId: item.id, keepWithNext: false, breakBefore: false, firstInBlock: false, lastInItem: bullets.length === 0 });
          }
          bullets.forEach((b, i) =>
            atoms.push({ ...base, id: `b:${b.id}`, kind: 'bullet', itemId: item.id, bulletId: b.id, keepWithNext: false, breakBefore: false, firstInBlock: false, lastInItem: i === bullets.length - 1 }),
          );
          break;
        }
      }
    }
  }
  return atoms;
}

/** Vertical offsets (margins) that push atoms onto their assigned pages. */
export function computeSpacers(
  atoms: Array<{ id: string; zone: Zone; height: number }>,
  pageOf: (id: string) => number,
  geometry: { stride: number; top: (zone: Zone, page: number) => number },
): Record<string, number> {
  const spacers: Record<string, number> = {};
  for (const zone of ['main', 'side'] as Zone[]) {
    let y: number | null = null;
    let page = 1;
    for (const a of atoms.filter((x) => x.zone === zone)) {
      const p = Math.max(1, pageOf(a.id));
      if (y === null) {
        page = p;
        const start = (p - 1) * geometry.stride + geometry.top(zone, p);
        spacers[a.id] = start;
        y = start;
      } else if (p > page) {
        page = p;
        const start = (p - 1) * geometry.stride + geometry.top(zone, p);
        spacers[a.id] = Math.max(0, start - y);
        y = start;
      } else {
        spacers[a.id] = 0;
      }
      y += a.height;
    }
  }
  return spacers;
}
