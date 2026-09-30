import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addBullet, addItem, bulletPath, findItem, getText, itemPath, newBullet, newTextItem, parsePath, removeBullet, setText } from '../../../shared/document';
import { stripMarkup, toggleStyle } from '../../../shared/markup';
import type { CvDocument } from '../../../shared/types';
import { CvPages, PAGE_W, type LayoutInfo } from '../../cv/CvPages';
import { useAssistant } from '../../state/assistant';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';

function focusPath(path: string, atEnd = false) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
      if (!el) return;
      el.focus();
      if (atEnd) {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }),
  );
}

/** Plain-text offsets of the current selection inside an editable field. */
export function selectionOffsets(el: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

export interface ToolbarState {
  path: string;
  text: string;
  rect: { top: number; left: number; bottom: number; width: number };
}

export function applyInlineStyle(style: 'bold' | 'italic') {
  const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.cv-editable[contenteditable="true"]');
  if (!el) return false;
  const path = el.dataset.path!;
  const offsets = selectionOffsets(el);
  if (!offsets || offsets.end <= offsets.start) return false;
  const ws = useWorkspace.getState();
  const doc = ws.history?.present;
  const current = doc ? getText(doc, path) : null;
  if (current === null || current === undefined) return false;
  ws.edit((d) => setText(d, path, toggleStyle(current, offsets.start, offsets.end, style)), style === 'bold' ? 'Bold' : 'Italic');
  return true;
}

export function Canvas({ doc, editable, onRewrite, onTranslate, overlay }: { doc: CvDocument; editable: boolean; onRewrite: (path: string, text: string) => void; onTranslate: (path: string, text: string) => void; overlay?: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const setField = useWorkspace((s) => s.setField);
  const edit = useWorkspace((s) => s.edit);
  const setLayout = useWorkspace((s) => s.setLayout);
  const highlight = useWorkspace((s) => s.highlightBlock);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.45, Math.min(1.05, (el.clientWidth - 56) / PAGE_W))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Floating selection toolbar
  useEffect(() => {
    if (!editable) {
      setToolbar(null);
      return;
    }
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setToolbar(null);
        return;
      }
      const anchor = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement;
      const el = anchor?.closest<HTMLElement>('.cv-editable[contenteditable="true"]');
      if (!el || !wrap.current?.contains(el)) {
        setToolbar(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const text = sel.toString().trim();
      if (!text) return setToolbar(null);
      setToolbar({ path: el.dataset.path!, text, rect: { top: r.top, left: r.left, bottom: r.bottom, width: r.width } });
      useAssistant.getState().set({ selection: { path: el.dataset.path!, text, fieldText: stripMarkup(el.textContent ?? '') } });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [editable]);

  const onEnter = useCallback(
    (path: string) => {
      const p = parsePath(path);
      if (!p) return;
      if (p.type === 'bullet') {
        const b = newBullet('');
        edit((d) => addBullet(d, p.blockId, p.itemId, b, p.bulletId), 'Add bullet');
        focusPath(bulletPath(p.blockId, p.itemId, b.id));
      } else if (p.type === 'item' && (p.field === 'text' || p.field === 'title' || p.field === 'org' || p.field === 'location')) {
        const item = findItem(useWorkspace.getState().history!.present, p.blockId, p.itemId);
        if (item?.kind === 'entry') {
          if (item.bullets.length) {
            focusPath(bulletPath(p.blockId, p.itemId, item.bullets[0].id));
          } else {
            const b = newBullet('');
            edit((d) => addBullet(d, p.blockId, p.itemId, b), 'Add bullet');
            focusPath(bulletPath(p.blockId, p.itemId, b.id));
          }
        } else if (item?.kind === 'text') {
          const t = newTextItem('');
          edit((d) => addItem(d, p.blockId, t, p.itemId), 'Add paragraph');
          focusPath(itemPath(p.blockId, t.id, 'text'));
        } else {
          (document.activeElement as HTMLElement | null)?.blur();
        }
      } else {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    },
    [edit],
  );

  const onBackspaceEmpty = useCallback(
    (path: string) => {
      const p = parsePath(path);
      if (p?.type !== 'bullet') return;
      const item = findItem(useWorkspace.getState().history!.present, p.blockId, p.itemId);
      if (item?.kind !== 'entry') return;
      const idx = item.bullets.findIndex((b) => b.id === p.bulletId);
      edit((d) => removeBullet(d, p.blockId, p.itemId, p.bulletId), 'Delete bullet');
      const prev = item.bullets[idx - 1];
      if (prev) focusPath(bulletPath(p.blockId, p.itemId, prev.id), true);
    },
    [edit],
  );

  const onLayout = useCallback((l: LayoutInfo) => setLayout(l), [setLayout]);

  const toolbarPos = toolbar
    ? (() => {
        const w = 330;
        const left = Math.max(12, Math.min(window.innerWidth - w - 12, toolbar.rect.left + toolbar.rect.width / 2 - w / 2));
        const above = toolbar.rect.top - 50;
        return { left, top: above > 70 ? above : toolbar.rect.bottom + 10 };
      })()
    : null;

  return (
    <div ref={wrap} className="ws-canvas" data-testid="canvas">
      {overlay}
      <div className="ws-pages" style={{ width: PAGE_W * scale, height: 'auto' }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_W }}>
          <CvPages doc={doc} editable={editable} onFieldChange={setField} onEnter={onEnter} onBackspaceEmpty={onBackspaceEmpty} onLayout={onLayout} highlightBlockId={highlight} />
        </div>
      </div>
      {toolbar && toolbarPos ? (
        <div className="sel-toolbar glass-strong" role="toolbar" aria-label="Selected text" style={toolbarPos} onMouseDown={(e) => e.preventDefault()} data-testid="selection-toolbar">
          <button type="button" className="btn btn-quiet btn-sm icon-btn" title="Bold (⌘B)" aria-label="Bold" onClick={() => applyInlineStyle('bold')}>
            <Icon name="bold" size={15} />
          </button>
          <button type="button" className="btn btn-quiet btn-sm icon-btn" title="Italic (⌘I)" aria-label="Italic" onClick={() => applyInlineStyle('italic')}>
            <Icon name="italic" size={15} />
          </button>
          <span className="tb-sep" aria-hidden="true" />
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onRewrite(toolbar.path, toolbar.text)} data-testid="tb-rewrite">
            <Icon name="sparkle" size={14} /> Rewrite
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onTranslate(toolbar.path, toolbar.text)}>
            <Icon name="translate" size={14} /> Translate
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              useAssistant.getState().set({ scope: 'selection', action: 'chat' });
              useAssistant.getState().focusInstructions();
            }}
          >
            <Icon name="sparkles" size={14} /> Ask AI
          </button>
        </div>
      ) : null}
    </div>
  );
}
