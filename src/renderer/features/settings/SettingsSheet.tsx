import { useCallback, useEffect, useState } from 'react';
import type { BackupInspectionView } from '../../../shared/api';
import type { MotionPref, ProviderId, ProviderStatus, TransparencyPref } from '../../../shared/types';
import { api, errorMessage, unwrap } from '../../api';
import { toast, toastError, useApp } from '../../state/app';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { LensTabs } from '../../ui/LensTabs';

const CLAUDE_PRICES: Record<string, string> = {
  'claude-opus-5-5': '$4 / $20 per million tokens (in / out)',
  'claude-sonnet-5-5': '$2 / $10 per million tokens',
  'claude-haiku-4-5': '$1 / $5 per million tokens',
  'claude-fable-5-1': '$10 / $50 per million tokens',
};

export function SettingsSheet() {
  const open = useApp((s) => s.settingsOpen);
  const close = useApp((s) => s.closeSettings);
  const setTab = useApp((s) => s.openSettings);
  if (!open) return null;
  return (
    <Dialog title="Settings" onClose={close} testId="settings">
      <div style={{ marginBottom: 16 }}>
        <LensTabs
          label="Settings sections"
          value={open}
          onChange={(t) => setTab(t)}
          options={[
            { id: 'ai', label: 'AI connections', icon: 'sparkles' },
            { id: 'storage', label: 'Storage', icon: 'backup' },
            { id: 'accessibility', label: 'Accessibility', icon: 'accessibility' },
            { id: 'about', label: 'About', icon: 'info' },
          ]}
        />
      </div>
      {open === 'ai' ? <AiSettings /> : open === 'storage' ? <StorageSettings /> : open === 'accessibility' ? <AccessibilitySettings /> : <About />}
    </Dialog>
  );
}

function AiSettings() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [secure, setSecure] = useState(true);
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const load = useCallback(async () => {
    setProviders(await api().providers.list());
    setSecure(await api().providers.secureStorageAvailable());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const byId = (id: ProviderId) => providers.find((p) => p.id === id);
  return (
    <div className="col" style={{ gap: 12 }} data-testid="ai-settings">
      <div className="notice peach">
        <Icon name="info" size={15} />
        <span>
          AI runs only when you ask, on the connection you choose below. <strong>No automatic paid fallback:</strong> if it fails, nothing else is tried. Keys and sign-ins are stored in the macOS Keychain, never in backups.
        </span>
      </div>
      {!secure ? (
        <div className="notice err">
          <Icon name="warning" size={15} /> Secure storage is not available on this system, so credentials cannot be saved.
        </div>
      ) : null}
      <div className="field">
        <span className="label">Use for suggestions</span>
        <div className="radio-row" role="radiogroup" aria-label="Default provider">
          {providers.map((p) => (
            <label key={p.id} className="filter-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} aria-disabled={!p.connected}>
              <input type="radio" name="default-provider" checked={settings.defaultProvider === p.id} disabled={!p.connected} onChange={() => void update({ defaultProvider: p.id })} data-testid={`default-${p.id}`} />
              {p.label} {p.connected ? '' : '(not connected)'}
            </label>
          ))}
          <label className="filter-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="default-provider" checked={settings.defaultProvider === null} onChange={() => void update({ defaultProvider: null })} />
            None
          </label>
        </div>
      </div>
      {byId('chatgpt') ? <ChatGptCard p={byId('chatgpt')!} onChange={load} /> : null}
      {byId('anthropic') ? <KeyCard p={byId('anthropic')!} logo="C" onChange={load} keyHint="sk-ant-…" consoleUrl="https://console.anthropic.com/settings/keys" prices={CLAUDE_PRICES} /> : null}
      {byId('openai') ? <KeyCard p={byId('openai')!} logo="O" onChange={load} keyHint="sk-…" consoleUrl="https://platform.openai.com/api-keys" /> : null}
      {byId('compatible') ? <LocalCard p={byId('compatible')!} onChange={load} /> : null}
    </div>
  );
}

function StatusChip({ p }: { p: ProviderStatus }) {
  if (p.connected) return <span className="chip ok">{p.verified ? 'Connected · verified' : 'Connected'}</span>;
  return <span className="chip">Not connected</span>;
}

function ModelSelect({ p }: { p: ProviderStatus }) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  if (!p.models.length) return null;
  return (
    <select className="select" style={{ maxWidth: 260 }} aria-label={`${p.label} model`} value={settings.models[p.id] ?? p.model} onChange={(e) => void update({ models: { ...settings.models, [p.id]: e.target.value } })}>
      {p.models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

function ChatGptCard({ p, onChange }: { p: ProviderStatus; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      await unwrap(api().providers.signInChatGpt());
      toast({ kind: 'ok', text: 'Signed in with ChatGPT.' });
    } catch (e) {
      toast({ kind: 'err', text: `ChatGPT sign-in did not complete: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
      void onChange();
    }
  };
  return (
    <div className="provider" data-testid="provider-chatgpt">
      <span className="provider-logo">G</span>
      <div className="col" style={{ gap: 4 }}>
        <div className="row">
          <strong>ChatGPT</strong> <StatusChip p={p} /> <span className="chip peach">Uses your ChatGPT plan</span>
        </div>
        <span className="small muted">{p.billingNote} Plan access depends on eligibility (for example Plus or Pro); some accounts or requests may not be eligible.</span>
        {p.accountLabel ? <span className="small">Account: {p.accountLabel}</span> : null}
        {p.lastError ? <span className="small" style={{ color: 'var(--danger)' }}>{p.lastError}</span> : null}
        <span className="small muted">{p.limits}</span>
        <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {p.connected ? <ModelSelect p={p} /> : null}
          <button type="button" className="link-btn small" onClick={() => void api().app.openExternal('https://chatgpt.com/settings/usage')}>
            Manage usage in ChatGPT
          </button>
        </div>
      </div>
      <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
        {p.accountLabel ? (
          <button type="button" className="btn btn-sm" onClick={async () => { const r = await api().providers.disconnectChatGpt(); if (r.ok) toast({ kind: 'ok', text: r.value.revoked ? 'Disconnected and sign-in revoked.' : 'Disconnected on this Mac.' }); await onChange(); }}>
            Disconnect
          </button>
        ) : busy ? (
          <>
            <span className="small muted row"><span className="spinner" /> Waiting for the browser…</span>
            <button type="button" className="btn btn-sm" onClick={() => void api().providers.cancelSignIn()}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void signIn()} data-testid="chatgpt-signin">
            Continue with ChatGPT
          </button>
        )}
      </div>
    </div>
  );
}

function KeyCard({ p, logo, onChange, keyHint, consoleUrl, prices }: { p: ProviderStatus; logo: string; onChange: () => Promise<void>; keyHint: string; consoleUrl: string; prices?: Record<string, string> }) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = useApp((s) => s.settings);
  const model = settings.models[p.id] ?? p.model;
  const save = async () => {
    setBusy(true);
    try {
      await unwrap(api().providers.setKey(p.id, key));
      setKey('');
      setEditing(false);
      const v = await api().providers.verify(p.id);
      toast(v.verified ? { kind: 'ok', text: `${p.label} key saved and verified.` } : { kind: 'err', text: `Key saved but not verified: ${v.lastError ?? 'unknown error'}` });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      void onChange();
    }
  };
  return (
    <div className="provider" data-testid={`provider-${p.id}`}>
      <span className="provider-logo">{logo}</span>
      <div className="col" style={{ gap: 4 }}>
        <div className="row">
          <strong>{p.label}</strong> <StatusChip p={p} /> <span className="chip warn">API · separate billing</span>
        </div>
        <span className="small muted">{p.billingNote}</span>
        {prices?.[model] ? <span className="small">Selected model price: {prices[model]}</span> : null}
        {p.lastError ? <span className="small" style={{ color: 'var(--danger)' }}>{p.lastError}</span> : null}
        {editing ? (
          <div className="row" style={{ marginTop: 4 }}>
            <input className="input" type="password" autoComplete="off" placeholder={keyHint} value={key} onChange={(e) => setKey(e.target.value)} aria-label={`${p.label} API key`} data-autofocus />
            <button type="button" className="btn btn-primary btn-sm" disabled={!key.trim() || busy} onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
            {p.connected ? <ModelSelect p={p} /> : null}
            <button type="button" className="link-btn small" onClick={() => void api().app.openExternal(consoleUrl)}>
              Get an API key
            </button>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
        {!editing ? (
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} data-testid={`configure-${p.id}`}>
            {p.connected ? 'Replace key' : 'Configure'}
          </button>
        ) : null}
        {p.connected ? (
          <>
            <button type="button" className="btn btn-sm" onClick={async () => { await api().providers.verify(p.id); void onChange(); }}>
              Verify
            </button>
            <button type="button" className="btn btn-quiet btn-sm btn-danger" onClick={async () => { await api().providers.removeKey(p.id); void onChange(); }}>
              Remove key
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LocalCard({ p, onChange }: { p: ProviderStatus; onChange: () => Promise<void> }) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const [url, setUrl] = useState(settings.compatibleBaseUrl);
  const [model, setModel] = useState(settings.models.compatible ?? '');
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    await update({ compatibleBaseUrl: url, models: { ...settings.models, compatible: model } });
    const s = await api().providers.verify('compatible');
    setChecking(false);
    if (s.verified && !model && s.models[0]) {
      setModel(s.models[0]);
      await update({ models: { ...useApp.getState().settings.models, compatible: s.models[0] } });
    }
    toast(s.verified ? { kind: 'ok', text: `Server reachable (${s.models.length} model${s.models.length === 1 ? '' : 's'}).` } : { kind: 'err', text: `Server not reachable: ${s.lastError}` });
    void onChange();
  };
  return (
    <div className="provider" data-testid="provider-compatible">
      <span className="provider-logo">L</span>
      <div className="col" style={{ gap: 6 }}>
        <div className="row">
          <strong>Local model</strong> <StatusChip p={p} /> <span className="chip">Optional</span>
        </div>
        <span className="small muted">{p.billingNote} Works with OpenAI-compatible servers such as Ollama or LM Studio.</span>
        <div className="form-grid" style={{ gridTemplateColumns: '80px 1fr' }}>
          <label htmlFor="local-url">Address</label>
          <input id="local-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="local-url" />
          <label htmlFor="local-model">Model</label>
          {p.models.length ? (
            <select id="local-model" className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Choose…</option>
              {p.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input id="local-model" className="input" value={model} placeholder="e.g. llama3.1" onChange={(e) => setModel(e.target.value)} data-testid="local-model" />
          )}
        </div>
      </div>
      <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={() => void check()} disabled={checking} data-testid="local-save">
          {checking ? <span className="spinner" /> : null} Save & check
        </button>
      </div>
    </div>
  );
}

function StorageSettings() {
  const info = useApp((s) => s.info);
  const [inspection, setInspection] = useState<BackupInspectionView | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [choices, setChoices] = useState<Record<string, 'keep-mine' | 'use-backup'>>({});
  const [busy, setBusy] = useState(false);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const r = await unwrap(api().backup.exportTo());
      if (r) toast({ kind: 'ok', text: `Backup saved and verified: ${r.path.split(/[\\/]/).pop()}` });
    } catch (e) {
      toastError(e, 'Backup failed: ');
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const r = await unwrap(api().backup.pick());
      setInspection(r);
      setChoices({});
    } catch (e) {
      toastError(e);
    }
  };

  const restore = async () => {
    if (!inspection) return;
    setBusy(true);
    try {
      const r = await unwrap(api().backup.restore({ path: inspection.path, mode, choices }));
      if (r.mode === 'merge') {
        toast({ kind: 'ok', text: `Restored: ${r.added ?? 0} added, ${r.replaced ?? 0} replaced, ${r.kept ?? 0} kept as they were.` });
        setInspection(null);
      } else {
        toast({ kind: 'ok', text: 'Backup restored. Your previous data was kept as a safety copy.' });
      }
    } catch (e) {
      toast({ kind: 'err', text: `Restore failed, nothing was changed: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }} data-testid="storage-settings">
      <div className="surface" style={{ padding: 14 }}>
        <div className="row">
          <Icon name="backup" size={18} />
          <strong className="grow">Stored on this Mac only</strong>
          <button type="button" className="btn btn-sm" onClick={() => void api().app.revealDataFolder()}>
            Show in Finder
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          Library, CVs, originals, applications, conversations, versions and sent files live in {info?.dataDir}. There is no sync and no telemetry.
        </p>
      </div>
      <div className="surface" style={{ padding: 14 }}>
        <strong>Back up everything</strong>
        <p className="small muted" style={{ margin: '4px 0 10px' }}>One file with all your data and documents, checked after writing. AI credentials are not included.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => void exportBackup()} disabled={busy} data-testid="export-backup">
            Export backup…
          </button>
          <button type="button" className="btn" onClick={() => void pick()} disabled={busy} data-testid="restore-backup">
            Restore backup…
          </button>
        </div>
      </div>
      {inspection ? (
        <div className="surface" style={{ padding: 14 }} data-testid="backup-inspection">
          <strong>{inspection.path.split(/[\\/]/).pop()}</strong>
          {!inspection.ok ? (
            <div className="notice err" style={{ marginTop: 8 }}>
              <Icon name="warning" size={15} />
              <span>
                This backup cannot be restored:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {inspection.errors.slice(0, 6).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </span>
            </div>
          ) : (
            <>
              <p className="small muted">
                Created {inspection.createdAt ? new Date(inspection.createdAt).toLocaleString('en-GB') : '—'} with Atelier {inspection.appVersion}. Contains {inspection.counts.cvs ?? 0} CVs, {inspection.counts.records ?? 0} library records, {inspection.counts.applications ?? 0} applications, {inspection.counts.sources ?? 0} originals and {inspection.counts.sent_files ?? 0} sent files.
              </p>
              <div className="radio-row" style={{ margin: '10px 0' }} role="radiogroup" aria-label="Restore mode">
                <label className="filter-chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Add what is missing
                </label>
                <label className="filter-chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} data-testid="mode-replace" /> Replace everything
                </label>
              </div>
              {mode === 'merge' ? (
                <>
                  <p className="small">
                    {Object.values(inspection.newRows).reduce((a, b) => a + b, 0)} items will be added, {inspection.identical} are already identical.
                  </p>
                  {inspection.collisions.length ? (
                    <div className="col" style={{ gap: 6, marginTop: 8 }}>
                      <span className="label">{inspection.collisions.length} item(s) differ from what you have. Nothing is overwritten unless you choose it:</span>
                      {inspection.collisions.slice(0, 50).map((c) => {
                        const key = `${c.table}:${c.key}`;
                        return (
                          <div key={key} className="row small">
                            <span className="grow">{c.label}</span>
                            {c.locked ? (
                              <span className="chip">Sent — never replaced</span>
                            ) : (
                              <select className="select" style={{ width: 170 }} value={choices[key] ?? 'keep-mine'} onChange={(e) => setChoices({ ...choices, [key]: e.target.value as 'keep-mine' | 'use-backup' })} aria-label={`Choice for ${c.label}`}>
                                <option value="keep-mine">Keep mine</option>
                                <option value="use-backup">Use the backup's</option>
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="notice warn">
                  <Icon name="warning" size={15} /> All current data is replaced by the backup. Your current data folder is kept as a safety copy next to it, so this can be undone manually.
                </div>
              )}
              <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => void restore()} disabled={busy} data-testid="confirm-restore">
                {busy ? <span className="spinner" /> : null} Restore
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AccessibilitySettings() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const sys = useApp((s) => ({ m: s.systemReduceMotion, t: s.systemReduceTransparency }));
  return (
    <div className="col" style={{ gap: 16 }} data-testid="accessibility-settings">
      <div className="field">
        <span className="label">Reduce motion</span>
        <LensTabs<MotionPref>
          role="radio"
          label="Reduce motion"
          value={settings.motion}
          onChange={(v) => void update({ motion: v })}
          options={[
            { id: 'system', label: `Follow macOS (${sys.m ? 'on' : 'off'})` },
            { id: 'reduce', label: 'On' },
            { id: 'full', label: 'Off' },
          ]}
        />
        <span className="hint">Removes the gliding and stretching of the selection lens and other movement.</span>
      </div>
      <div className="field">
        <span className="label">Reduce transparency</span>
        <LensTabs<TransparencyPref>
          role="radio"
          label="Reduce transparency"
          value={settings.transparency}
          onChange={(v) => void update({ transparency: v })}
          options={[
            { id: 'system', label: `Follow macOS (${sys.t ? 'on' : 'off'})` },
            { id: 'reduce', label: 'On' },
            { id: 'full', label: 'Off' },
          ]}
        />
        <span className="hint">Uses solid surfaces instead of glass, keeping borders and selection.</span>
      </div>
      <div className="notice">
        <Icon name="info" size={15} /> Everything works with the keyboard: Tab to move, arrows inside tab bars and menus, ⌘Z / ⇧⌘Z to undo and redo, ⌥ + arrows to move sections or applications.
      </div>
    </div>
  );
}

function About() {
  const info = useApp((s) => s.info);
  return (
    <div className="col" style={{ gap: 10 }}>
      <h3 className="display" style={{ fontSize: 22 }}>Atelier {info?.version}</h3>
      <p className="small muted">
        macOS {info?.osVersion} · {info?.arch} · Electron {info?.electron}
      </p>
      <p className="small">Personal CV and application workspace. All data stays on this Mac. No telemetry. AI is used only on explicit request, with the connection you choose.</p>
      <p className="small muted">Glass effects inside the window are approximated with web materials; the window background uses the native macOS material.</p>
    </div>
  );
}
