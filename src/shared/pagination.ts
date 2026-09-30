// Page layout for A4 CVs. The renderer measures "atoms" (section titles, entry
// headers, bullets, paragraphs…) and this pure function assigns them to pages.
// The same assignment drives the on-screen preview and the exported PDF, so
// what you see is what gets exported. Text is never scaled to fit.

import type { Zone } from './types';

export interface Atom {
  id: string;
  blockId: string;
  zone: Zone;
  /** Measured height in px, including the atom's own spacing. */
  height: number;
  /** Must be on the same page as the following atom of the same zone (e.g. a title). */
  keepWithNext: boolean;
  /** Start a new page before this atom (explicit page break). */
  breakBefore?: boolean;
}

export interface PageAssignment {
  main: string[];
  side: string[];
}

export interface Continuation {
  blockId: string;
  pages: number[]; // 1-based page numbers the block spans
}

export interface PaginationResult {
  pages: PageAssignment[];
  continuations: Continuation[];
  /** Atoms taller than a full page: they are placed alone and flagged. */
  tooTall: string[];
  pageCount: number;
}

export type CapacityFn = (zone: Zone, pageIndex: number) => number;

function chainHeight(atoms: Atom[], start: number, cap: number): number {
  let h = atoms[start].height;
  let i = start;
  while (atoms[i].keepWithNext && i + 1 < atoms.length && !atoms[i + 1].breakBefore) {
    i++;
    h += atoms[i].height;
    if (h > cap) break;
  }
  return h;
}

function paginateZone(atoms: Atom[], zone: Zone, capacity: CapacityFn, tooTall: string[]): string[][] {
  const pages: string[][] = [[]];
  let page = 0;
  let used = 0;
  atoms.forEach((atom, i) => {
    if (atom.breakBefore && used > 0) {
      page++;
      used = 0;
      pages[page] = [];
    }
    let cap = capacity(zone, page);
    // A keep-with-next chain taller than a page cannot be honoured: fall back to the atom alone.
    const chain = chainHeight(atoms, i, cap);
    const need = chain > cap ? atom.height : chain;
    if (used > 0 && used + need > cap) {
      page++;
      used = 0;
      pages[page] = [];
      cap = capacity(zone, page);
    }
    if (atom.height > cap) tooTall.push(atom.id);
    pages[page].push(atom.id);
    used += atom.height;
  });
  return pages;
}

export function paginate(atoms: Atom[], capacity: CapacityFn): PaginationResult {
  const tooTall: string[] = [];
  const main = paginateZone(
    atoms.filter((a) => a.zone === 'main'),
    'main',
    capacity,
    tooTall,
  );
  const sideAtoms = atoms.filter((a) => a.zone === 'side');
  const side = sideAtoms.length ? paginateZone(sideAtoms, 'side', capacity, tooTall) : [[]];
  const count = Math.max(main.length, side.length);
  const pages: PageAssignment[] = Array.from({ length: count }, (_, i) => ({ main: main[i] ?? [], side: side[i] ?? [] }));

  const blockPages = new Map<string, Set<number>>();
  const byId = new Map(atoms.map((a) => [a.id, a]));
  pages.forEach((p, idx) => {
    for (const id of [...p.main, ...p.side]) {
      const blockId = byId.get(id)!.blockId;
      if (!blockPages.has(blockId)) blockPages.set(blockId, new Set());
      blockPages.get(blockId)!.add(idx + 1);
    }
  });
  const continuations: Continuation[] = [];
  for (const [blockId, set] of blockPages) {
    if (set.size > 1) continuations.push({ blockId, pages: [...set].sort((a, b) => a - b) });
  }
  return { pages, continuations, tooTall, pageCount: count };
}

/** Where the given atom was placed (1-based page), or 0 if unknown. */
export function pageOfAtom(result: PaginationResult, atomId: string): number {
  const idx = result.pages.findIndex((p) => p.main.includes(atomId) || p.side.includes(atomId));
  return idx + 1;
}
