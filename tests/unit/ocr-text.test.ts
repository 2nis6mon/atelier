import { describe, expect, it } from 'vitest';
import { normalizeOcrText } from '../../src/shared/ocrText';

describe('OCR text normalisation', () => {
  it('restores bullets and contact separators misread by OCR', () => {
    const raw = ['Paris, France + camille.laurent@example.com', '+ Interfaces React et TypeScript.', '* Tests et documentation.', 'e Mise en production', '« Revue de code  '].join('\r\n');
    expect(normalizeOcrText(raw).split('\n')).toEqual([
      'Paris, France · camille.laurent@example.com',
      '• Interfaces React et TypeScript.',
      '• Tests et documentation.',
      '• Mise en production',
      '• Revue de code',
    ]);
  });

  it('keeps phone numbers, C++ and ordinary words intact', () => {
    const raw = '+33 6 12 34 56 78\nC++ et Rust\ne-mail : a@b.c\nentreprise Nova';
    expect(normalizeOcrText(raw)).toBe(raw);
  });
});
