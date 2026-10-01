import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Text of every page of a PDF, via pdf.js (the same reader the app uses for imports). */
export async function pdfText(path: string): Promise<{ pages: string[]; links: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: false });
  const doc = await task.promise;
  const pages: string[] = [];
  const links: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' '));
    for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && a.url) links.push(a.url);
  }
  await task.destroy();
  return { pages, links };
}
