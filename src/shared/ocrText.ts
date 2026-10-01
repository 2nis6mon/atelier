// Cleans common OCR misreadings in CVs before parsing: bullet glyphs read as
// "+", "*", "«", "e", "°"… at the start of a line, and the middle dot "·"
// between contact details read as a spaced "+". Phone numbers (+33…) and
// "C++" are left alone because they are not surrounded by spaces.

const BULLET_MISREAD = /^(\s*)(?:[+*«»°•●▪■◦○◆►–-]|e(?=\s+[A-ZÀ-Ý]))\s+/;

export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(BULLET_MISREAD, '$1• ').replace(/(\S) \+ (?=\S)/g, '$1 · ').replace(/[ \t]+$/, ''))
    .join('\n');
}
