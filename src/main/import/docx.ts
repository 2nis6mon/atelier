import mammoth from 'mammoth';
import { decodeEntities } from '../../shared/offer';

/**
 * Extracts text from a .docx with mammoth (a pure JS reader: it never runs
 * macros or embedded content). Paragraphs become lines, list items get a
 * bullet, tabs are kept as column separators.
 */
export async function extractDocx(data: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
  const html = result.value;
  const text = decodeEntities(
    html
      .replace(/<li>/gi, '• ')
      .replace(/<\/(p|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<(br|\/ul|\/ol|\/table)\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[  ]+/g, ' ')
    .split('\n')
    .map((l) => l.replace(/^ +| +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const warnings = result.messages
    .filter((m) => m.type === 'error')
    .map((m) => m.message)
    .slice(0, 5);
  return { text, warnings };
}
