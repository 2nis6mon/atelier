import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export type MenuEntry =
  | { kind?: 'item'; label: string; icon?: string; onSelect: () => void; disabled?: boolean; danger?: boolean; testId?: string }
  | { kind: 'separator' }
  | { kind: 'label'; label: string };

interface MenuProps {
  anchor: HTMLElement | { x: number; y: number };
  entries: MenuEntry[];
  onClose: () => void;
  label: string;
}

/** Glass popover menu, kept inside the window, fully keyboard operable. */
export function Menu({ anchor, entries, onClose, label }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, bottom: anchor.y, top: anchor.y };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = anchor instanceof HTMLElement ? r.right - w : r.left;
    let y = r.bottom + 6;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    setPos({ x, y });
    el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        if (anchor instanceof HTMLElement) anchor.focus();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, anchor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div ref={ref} className="menu glass-strong" role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown}>
      {entries.map((e, i) => {
        if (e.kind === 'separator') return <div key={i} className="menu-sep" role="separator" />;
        if (e.kind === 'label') return <div key={i} className="menu-label">{e.label}</div>;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item ${e.danger ? 'danger' : ''}`}
            aria-disabled={e.disabled || undefined}
            data-testid={e.testId}
            onClick={() => {
              if (e.disabled) return;
              onClose();
              e.onSelect();
            }}
          >
            {e.icon ? <Icon name={e.icon} size={15} /> : <span style={{ width: 15 }} />}
            <span>{e.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Button that opens a menu. */
export function MenuButton({ entries, label, children, className = 'btn btn-quiet btn-sm icon-btn', testId }: { entries: MenuEntry[]; label: string; children?: ReactNode; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {children ?? <Icon name="more" size={18} strokeWidth={2.6} />}
      </button>
      {open && btn.current ? <Menu anchor={btn.current} entries={entries} onClose={() => setOpen(false)} label={label} /> : null}
    </>
  );
}
