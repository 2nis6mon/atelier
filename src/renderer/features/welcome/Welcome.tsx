import { navigate } from '../../router';
import { useApp } from '../../state/app';
import { Icon } from '../../ui/Icon';

export function Welcome() {
  const update = useApp((s) => s.updateSettings);
  const openSettings = useApp((s) => s.openSettings);
  const setImportOpen = useApp((s) => s.setImportOpen);
  const finish = async (then: () => void) => {
    await update({ onboardingDone: true });
    navigate({ name: 'library', tab: 'cvs' }, { replace: true });
    then();
  };
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-card glass-strong">
        <div className="wordmark" style={{ fontSize: 16, color: 'var(--terracotta-deep)' }}>
          Atelier
        </div>
        <h1 className="display" style={{ fontSize: 40, marginTop: 8 }}>A place for every opportunity.</h1>
        <p className="page-sub">Your CVs, your experience and every application you send — together, on this Mac.</p>
        <div className="welcome-points">
          <div className="welcome-point">
            <Icon name="backup" size={20} />
            <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>Stays on this Mac</h3>
            <p className="small muted">No account, no sync, no telemetry. Back up to a single file whenever you want.</p>
          </div>
          <div className="welcome-point">
            <Icon name="sparkles" size={20} />
            <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>AI only when you ask</h3>
            <p className="small muted">Connect ChatGPT, Claude or a local model later. Nothing runs while you type.</p>
          </div>
          <div className="welcome-point">
            <Icon name="check" size={20} />
            <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>You approve every change</h3>
            <p className="small muted">Suggestions come as a diff to accept, edit or reject. Sent versions never change.</p>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void finish(() => setImportOpen(true))} data-testid="welcome-import">
            <Icon name="import" /> Import my CVs
          </button>
          <button type="button" className="btn btn-lg" onClick={() => void finish(() => openSettings('ai'))}>
            <Icon name="sparkles" /> Connect AI (optional)
          </button>
          <button type="button" className="btn btn-quiet btn-lg" onClick={() => void finish(() => undefined)} data-testid="welcome-skip">
            Explore first
          </button>
        </div>
      </div>
    </div>
  );
}
