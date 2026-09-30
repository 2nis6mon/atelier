import type { CvDocument } from './types';

/** ASCII-safe file name part: accents removed, spaces to underscores. */
export function fileSafe(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** e.g. Camille_Laurent_Maison_FR */
export function defaultExportName(doc: CvDocument, company = ''): string {
  const parts = [fileSafe(doc.header.fullName) || 'CV', fileSafe(company), doc.lang.toUpperCase()].filter(Boolean);
  return parts.join('_').slice(0, 100);
}

export function validateExportName(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Enter a file name.';
  if (/[/\\:*?"<>|]/.test(t)) return 'File names cannot contain / \\ : * ? " < > |';
  if (t.length > 120) return 'This file name is too long.';
  return null;
}
