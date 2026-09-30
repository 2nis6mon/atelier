import { useApp } from '../state/app';
import { Icon } from './Icon';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass-strong ${t.kind}`} role={t.kind === 'err' ? 'alert' : undefined}>
          <Icon name={t.kind === 'err' ? 'warning' : t.kind === 'ok' ? 'check' : 'info'} size={16} />
          <span className="grow">{t.text}</span>
          {t.action ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet btn-sm icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
