import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { effectiveReduceMotion, useApp } from '../state/app';
import { Icon } from './Icon';
import { LENS_DURATION_MS, LENS_EASING, lensKeyframes, nextIndex, type Rect } from './lens';

export interface LensOption<T extends string> {
  id: T;
  label: string;
  icon?: string;
  badge?: ReactNode;
  title?: string;
}

interface Props<T extends string> {
  options: Array<LensOption<T>>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant?: 'pill' | 'dock';
  className?: string;
  /** 'tab' for view switchers, 'radio' for option pickers. */
  role?: 'tab' | 'radio';
  idPrefix?: string;
}

/**
 * Segmented control whose active option is shown by a single liquid lens.
 * Clicks are never blocked by the animation; a new selection interrupts the
 * current glide from wherever the lens is.
 */
export function LensTabs<T extends string>({ options, value, onChange, label, variant = 'pill', className = '', role = 'tab', idPrefix }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const last = useRef<Rect | null>(null);
  const reduced = useApp(effectiveReduceMotion);

  const measure = (): Rect | null => {
    const el = root.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
    if (!el) return null;
    return { x: el.offsetLeft, w: el.offsetWidth };
  };

  useLayoutEffect(() => {
    const el = lens.current;
    const to = measure();
    if (!el || !to) return;
    let from = last.current;
    if (anim.current && anim.current.playState === 'running') {
      // interrupt: start from the lens' current animated position
      const cs = getComputedStyle(el);
      from = { x: parseFloat(cs.left) || to.x, w: parseFloat(cs.width) || to.w };
      anim.current.cancel();
    }
    el.style.left = `${to.x}px`;
    el.style.width = `${to.w}px`;
    // Reduced motion: the lens moves to its new place without any animation.
    if (from && !reduced && typeof el.animate === 'function') {
      anim.current = el.animate(lensKeyframes(from, to, false) as unknown as Keyframe[], { duration: LENS_DURATION_MS, easing: LENS_EASING });
    } else if (anim.current) {
      anim.current.cancel();
      anim.current = null;
    }
    last.current = to;
  });

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const to = measure();
      if (to && lens.current && (!anim.current || anim.current.playState !== 'running')) {
        lens.current.style.left = `${to.x}px`;
        lens.current.style.width = `${to.w}px`;
        last.current = to;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = options.findIndex((o) => o.id === value);
    const next = nextIndex(idx, options.length, e.key);
    if (next !== idx && next >= 0) {
      e.preventDefault();
      onChange(options[next].id);
      const btn = root.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(options[next].id)}"]`);
      btn?.focus();
    }
  };

  return (
    <div
      ref={root}
      className={`lens-tabs glass ${variant === 'dock' ? 'dock' : ''} ${className}`}
      role={role === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <div ref={lens} className="lens" aria-hidden="true" />
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            className="lens-tab"
            data-value={o.id}
            id={idPrefix ? `${idPrefix}-${o.id}` : undefined}
            role={role}
            aria-selected={role === 'tab' ? selected : undefined}
            aria-checked={role === 'radio' ? selected : undefined}
            tabIndex={selected ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.id)}
          >
            {o.icon ? <Icon name={o.icon} size={variant === 'dock' ? 20 : 15} /> : null}
            <span>{o.label}</span>
            {o.badge}
          </button>
        );
      })}
    </div>
  );
}
