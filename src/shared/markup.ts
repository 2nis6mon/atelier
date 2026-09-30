// Minimal inline formatting for CV text fields: **bold** and *italic*.
// Literal asterisks and backslashes are escaped with a backslash.

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

type Token = { t: 'text'; v: string } | { t: 'bold' } | { t: 'italic' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let buf = '';
  const flush = () => {
    if (buf) tokens.push({ t: 'text', v: buf });
    buf = '';
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && i + 1 < input.length && (input[i + 1] === '*' || input[i + 1] === '\\')) {
      buf += input[i + 1];
      i++;
    } else if (c === '*' && input[i + 1] === '*') {
      flush();
      tokens.push({ t: 'bold' });
      i++;
    } else if (c === '*') {
      flush();
      tokens.push({ t: 'italic' });
    } else {
      buf += c;
    }
  }
  flush();
  return tokens;
}

/** Parses markup into styled runs. Unpaired markers are kept as literal text. */
export function parseInline(input: string): Run[] {
  const tokens = tokenize(input);
  const boldIdx = tokens.flatMap((t, i) => (t.t === 'bold' ? [i] : []));
  const italicIdx = tokens.flatMap((t, i) => (t.t === 'italic' ? [i] : []));
  const literal = new Set<number>();
  if (boldIdx.length % 2 === 1) literal.add(boldIdx[boldIdx.length - 1]);
  if (italicIdx.length % 2 === 1) literal.add(italicIdx[italicIdx.length - 1]);

  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  const push = (text: string) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  };
  tokens.forEach((tok, i) => {
    if (tok.t === 'text') push(tok.v);
    else if (literal.has(i)) push(tok.t === 'bold' ? '**' : '*');
    else if (tok.t === 'bold') bold = !bold;
    else italic = !italic;
  });
  return runs;
}

export function escapeText(text: string): string {
  return text.replace(/[\\*]/g, (c) => `\\${c}`);
}

/** Serialises runs back to markup (adjacent runs with equal style are merged). */
export function serializeRuns(runs: Run[]): string {
  let out = '';
  let bold = false;
  let italic = false;
  for (const run of runs) {
    if (!run.text) continue;
    if (run.bold !== bold) {
      out += '**';
      bold = run.bold;
    }
    if (run.italic !== italic) {
      out += '*';
      italic = run.italic;
    }
    out += escapeText(run.text);
  }
  if (bold) out += '**';
  if (italic) out += '*';
  return out;
}

/** Plain text without formatting markers. */
export function stripMarkup(input: string): string {
  return parseInline(input)
    .map((r) => r.text)
    .join('');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function runsToHtml(runs: Run[]): string {
  return runs
    .map((r) => {
      let html = escapeHtml(r.text);
      if (r.italic) html = `<em>${html}</em>`;
      if (r.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join('');
}

export function markupToHtml(input: string): string {
  return runsToHtml(parseInline(input));
}

/**
 * Applies bold/italic to the plain-text character range [start, end) of a
 * marked-up string. If the whole range already has the style, it is removed.
 */
export function toggleStyle(input: string, start: number, end: number, style: 'bold' | 'italic'): string {
  if (end <= start) return input;
  const runs = parseInline(input);
  // explode into per-character styles
  const chars: Run[] = [];
  for (const r of runs) for (const ch of r.text) chars.push({ text: ch, bold: r.bold, italic: r.italic });
  const s = Math.max(0, start);
  const e = Math.min(chars.length, end);
  if (e <= s) return input;
  const allOn = chars.slice(s, e).every((c) => c[style]);
  for (let i = s; i < e; i++) chars[i] = { ...chars[i], [style]: !allOn };
  return serializeRuns(chars);
}

/** Returns bold/italic state of a plain-text range (true only if the whole range has it). */
export function styleInRange(input: string, start: number, end: number): { bold: boolean; italic: boolean } {
  const runs = parseInline(input);
  const chars: Run[] = [];
  for (const r of runs) for (const ch of r.text) chars.push({ text: ch, bold: r.bold, italic: r.italic });
  const slice = chars.slice(start, Math.max(start + 1, end));
  if (slice.length === 0) return { bold: false, italic: false };
  return { bold: slice.every((c) => c.bold), italic: slice.every((c) => c.italic) };
}
