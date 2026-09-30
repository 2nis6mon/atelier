// Inline editable text field for CV content. The DOM is uncontrolled while
// focused (so the caret never jumps); the value is converted to Atelier's
// minimal markup (**bold**, *italic*) on every input. Pasted content is
// inserted as plain text only.

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { markupToHtml, serializeRuns, type Run } from '../../shared/markup';

export interface EditableProps {
  value: string;
  path: string;
  onChange: (value: string, path: string) => void;
  editable: boolean;
  multiline?: boolean;
  rich?: boolean;
  placeholder?: string;
  className?: string;
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3';
  onEnter?: (path: string) => void;
  onBackspaceEmpty?: (path: string) => void;
  ariaLabel?: string;
}

/** Converts a contenteditable subtree to markup runs. */
export function domToMarkup(root: Node): string {
  const runs: Run[] = [];
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').replace(/\u00a0/g, ' ');
      if (t) runs.push({ text: t, bold, italic });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'BR') {
      runs.push({ text: '\n', bold, italic });
      return;
    }
    const tag = el.tagName;
    const weight = el.style?.fontWeight;
    const b = bold || tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600;
    const i = italic || tag === 'I' || tag === 'EM' || el.style?.fontStyle === 'italic';
    if ((tag === 'DIV' || tag === 'P') && runs.length && !runs[runs.length - 1].text.endsWith('\n')) runs.push({ text: '\n', bold: false, italic: false });
    el.childNodes.forEach((c) => walk(c, b, i));
  };
  root.childNodes.forEach((c) => walk(c, false, false));
  return serializeRuns(runs).replace(/\n+$/, '');
}

export function Editable({ value, path, onChange, editable, multiline, rich = true, placeholder, className = '', as = 'span', onEnter, onBackspaceEmpty, ariaLabel }: EditableProps) {
  const ref = useRef<HTMLElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only rewrite the DOM when the value changed from outside (undo, AI accept…)
    if (value !== lastEmitted.current || document.activeElement !== el) {
      const html = rich ? markupToHtml(value) : value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      if (el.innerHTML !== html) el.innerHTML = html;
      lastEmitted.current = value;
    }
  }, [value, rich]);

  useEffect(() => {
    lastEmitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const next = rich ? domToMarkup(el) : (el.textContent ?? '').replace(/\u00a0/g, ' ');
    const clean = multiline ? next : next.replace(/\n/g, ' ');
    if (clean !== lastEmitted.current) {
      lastEmitted.current = clean;
      onChange(clean, path);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (onEnter) onEnter(path);
      else (e.currentTarget as HTMLElement).blur();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !multiline) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && onBackspaceEmpty && (ref.current?.textContent ?? '') === '') {
      e.preventDefault();
      onBackspaceEmpty(path);
    }
    if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
  };

  const Tag = as as 'span';
  return (
    <Tag
      ref={ref as never}
      className={`cv-editable ${className}`}
      contentEditable={editable ? 'true' : 'false'}
      suppressContentEditableWarning
      spellCheck={editable}
      role={editable ? 'textbox' : undefined}
      aria-multiline={editable && multiline ? true : undefined}
      aria-label={ariaLabel}
      data-path={path}
      data-placeholder={placeholder}
      onInput={emit}
      onBlur={emit}
      onKeyDown={editable ? onKeyDown : undefined}
      onPaste={(e) => {
        if (!editable) return;
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, multiline ? text : text.replace(/\s*\n\s*/g, ' '));
      }}
      onDrop={(e) => e.preventDefault()}
    />
  );
}
