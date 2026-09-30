import { describe, expect, it } from 'vitest';
import { escapeHtml, markupToHtml, parseInline, serializeRuns, stripMarkup, styleInRange, toggleStyle } from '../../src/shared/markup';

describe('inline markup', () => {
  it('parses bold and italic runs', () => {
    expect(parseInline('a **b** *c* d')).toEqual([
      { text: 'a ', bold: false, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'c', bold: false, italic: true },
      { text: ' d', bold: false, italic: false },
    ]);
  });

  it('keeps unpaired markers as literal text', () => {
    expect(stripMarkup('5 * 3 = 15')).toBe('5 * 3 = 15');
    expect(stripMarkup('**open')).toBe('**open');
  });

  it('round-trips through serialisation including escapes and nesting', () => {
    const samples = ['plain', 'a **bold** and *it*', 'x ***both*** y', 'literal \\* star', 'back\\\\slash', 'é **à** *ç*'];
    for (const s of samples) expect(serializeRuns(parseInline(s))).toBe(serializeRuns(parseInline(serializeRuns(parseInline(s)))));
    expect(stripMarkup(serializeRuns([{ text: 'a*b', bold: true, italic: false }]))).toBe('a*b');
  });

  it('renders escaped HTML', () => {
    expect(markupToHtml('<b>&"x"</b> **y**')).toBe('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt; <strong>y</strong>');
    expect(markupToHtml('***z***')).toBe('<strong><em>z</em></strong>');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('toggles a style on a plain-text range', () => {
    const bold = toggleStyle('Je développe', 3, 12, 'bold');
    expect(bold).toBe('Je **développe**');
    expect(toggleStyle(bold, 3, 12, 'bold')).toBe('Je développe');
    expect(toggleStyle('abc', 2, 2, 'italic')).toBe('abc');
    expect(toggleStyle('abc', 5, 9, 'italic')).toBe('abc');
    expect(styleInRange(bold, 3, 5)).toEqual({ bold: true, italic: false });
    expect(styleInRange('', 0, 0)).toEqual({ bold: false, italic: false });
  });
});
