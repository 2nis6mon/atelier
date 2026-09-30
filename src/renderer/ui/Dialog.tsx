import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface DialogProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  narrow?: boolean;
  testId?: string;
  closeLabel?: string;
}

/** Modal sheet with focus trap, Escape to close and focus restoration. */
export function Dialog({ title, subtitle, onClose, children, footer, headerExtra, narrow, testId, closeLabel = 'Close' }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    first?.focus();
    return () => {
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [...(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])') ?? [])].filter((x) => x.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet glass-strong ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} data-testid={testId} onKeyDown={onKeyDown}>
        <div className="sheet-head">
          <div className="grow">
            <h2 className="display" style={{ fontSize: 24 }}>
              {title}
            </h2>
            {subtitle ? <p className="muted" style={{ marginTop: 4 }}>{subtitle}</p> : null}
          </div>
          {headerExtra}
          <button type="button" className="btn btn-quiet icon-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel} data-close>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      narrow
      testId="confirm-dialog"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.5 }}>{message}</div>
    </Dialog>
  );
}
