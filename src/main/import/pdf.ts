// Text extraction from PDFs with pdf.js (no rendering, no scripts). Lines are
// rebuilt from positioned text items; large horizontal gaps become tabs and a
// two-column layout (sidebar CVs) is read column by column.

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfExtraction {
  text: string;
  pageCount: number;
  /** Average number of text characters per page. */
  charsPerPage: number;
  /** True when the PDF has (almost) no text layer: OCR is needed. */
  needsOcr: boolean;
}

export class PdfError extends Error {
  readonly code: 'encrypted' | 'invalid';
  constructor(code: 'encrypted' | 'invalid', message: string) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
  }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

function findGutter(items: PdfTextItem[], pageWidth: number): number | null {
  if (items.length < 12) return null;
  const lo = pageWidth * 0.2;
  const hi = pageWidth * 0.8;
  const step = 2;
  const covered = new Uint8Array(Math.ceil(pageWidth / step) + 1);
  for (const it of items) {
    if (!it.str.trim()) continue;
    for (let x = Math.max(0, Math.floor(it.x / step)); x <= Math.min(covered.length - 1, Math.ceil((it.x + it.width) / step)); x++) covered[x] = 1;
  }
  let best: { start: number; len: number } | null = null;
  let run = 0;
  for (let i = Math.floor(lo / step); i <= Math.ceil(hi / step); i++) {
    if (!covered[i]) run++;
    else {
      if (run > 0 && (!best || run > best.len)) best = { start: i - run, len: run };
      run = 0;
    }
  }
  if (!best || best.len * step < 14) return null;
  const gutter = (best.start + best.len / 2) * step;
  const left = items.filter((i) => i.x + i.width <= gutter).reduce((n, i) => n + i.str.length, 0);
  const right = items.filter((i) => i.x >= gutter).reduce((n, i) => n + i.str.length, 0);
  const total = left + right;
  if (total === 0 || left / total < 0.15 || right / total < 0.15) return null;
  // Lines that clearly span both sides (e.g. a centred header) are fine; require most lines to split cleanly.
  return gutter;
}

/** Rebuilds reading-order lines from positioned items (pure, unit-tested). */
export function itemsToLines(items: PdfTextItem[], pageWidth: number): string[] {
  const clean = items.filter((i) => i.str !== '');
  const gutter = findGutter(clean, pageWidth);
  const columns = gutter === null ? [clean] : [clean.filter((i) => i.x < gutter), clean.filter((i) => i.x >= gutter)];
  const lines: string[] = [];
  for (const col of columns) {
    const sorted = [...col].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfTextItem[][] = [];
    for (const it of sorted) {
      const row = rows[rows.length - 1];
      const tol = Math.max(2, (it.height || 10) * 0.4);
      if (row && Math.abs(row[0].y - it.y) <= tol) row.push(it);
      else rows.push([it]);
    }
    let lastY: number | null = null;
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let line = '';
      let end: number | null = null;
      const rowSize = Math.max(...row.map((r) => r.height || 0)) || 10;
      for (const it of row) {
        const size = it.height || rowSize;
        if (!it.str.trim()) {
          // pdf.js emits whitespace items spanning gaps between columns
          if (it.width > rowSize * 1.8 && line && !line.endsWith('\t')) line += '\t';
          else if (line && !line.endsWith(' ') && !line.endsWith('\t')) line += ' ';
          end = it.x + it.width;
          continue;
        }
        if (end !== null) {
          const gap = it.x - end;
          if (gap > size * 1.8) { if (!line.endsWith("\t")) line += "\t"; }
          else if (gap > size * 0.15 && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
        }
        line += it.str;
        end = it.x + it.width;
      }
      const y = row[0].y;
      const size = row[0].height || 10;
      if (lastY !== null && lastY - y > size * 2.2) lines.push('');
      lines.push(line.replace(/ {2,}/g, ' ').trimEnd());
      lastY = y;
    }
    if (columns.length > 1) lines.push('');
  }
  return lines;
}

export async function extractPdf(data: Uint8Array): Promise<PdfExtraction> {
  const pdfjs = await loadPdfJs();
  let doc;
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const err = e as { name?: string; message?: string };
    if (err?.name === 'PasswordException') throw new PdfError('encrypted', 'This PDF is password-protected. Remove the password and import it again.');
    throw new PdfError('invalid', 'This file could not be read as a PDF.');
  }
  try {
    const pages: string[] = [];
    let chars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const t = raw.transform as number[];
        items.push({ str: raw.str, x: t[4], y: t[5], width: raw.width, height: raw.height || Math.abs(t[3]) || 10 });
        chars += raw.str.trim().length;
      }
      pages.push(itemsToLines(items, viewport.width).join('\n'));
      page.cleanup();
    }
    const charsPerPage = doc.numPages ? chars / doc.numPages : 0;
    return {
      text: pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
      pageCount: doc.numPages,
      charsPerPage,
      needsOcr: charsPerPage < 40,
    };
  } finally {
    await task.destroy();
  }
}
