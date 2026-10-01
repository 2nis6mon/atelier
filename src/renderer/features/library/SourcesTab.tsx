import { useCallback, useEffect, useState } from 'react';
import type { SourceFile, SourceFormat } from '../../../shared/types';
import { api, unwrap } from '../../api';
import { toast, toastError, useApp } from '../../state/app';
import { Confirm, Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { MenuButton } from '../../ui/Menu';

export function SourceIcon({ format }: { format: SourceFormat }) {
  const icon = format === 'pdf' ? 'pdf' : format === 'docx' ? 'word' : format === 'pages' ? 'pages' : 'file';
  return (
    <span className={`source-icon ${format}`} aria-hidden="true">
      <Icon name={icon} size={18} />
    </span>
  );
}

export function relativeDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

const STATUS: Record<SourceFile['status'], { label: string; cls: string }> = {
  extracted: { label: 'Extracted', cls: 'ok' },
  'needs-review': { label: 'Needs review', cls: 'warn' },
  'needs-ocr': { label: 'Scanned — text recognition needed', cls: 'warn' },
  'conversion-needed': { label: 'Conversion needed', cls: 'info' },
  failed: { label: 'Could not read', cls: 'err' },
};

export function SourcesTab() {
  const [sources, setSources] = useState<SourceFile[] | null>(null);
  const [view, setView] = useState<SourceFile | null>(null);
  const [remove, setRemove] = useState<SourceFile | null>(null);
  const importOpen = useApp((s) => s.importOpen);
  const dataVersion = useApp((s) => s.dataVersion);
  const setImportOpen = useApp((s) => s.setImportOpen);

  const load = useCallback(async () => setSources(await api().library.sources()), []);
  useEffect(() => {
    void load();
  }, [load, importOpen, dataVersion]);

  if (!sources) return <div className="empty"><div className="spinner" /></div>;
  return (
    <div className="col" style={{ gap: 10 }} data-testid="sources">
      <div className="row">
        <p className="muted grow">Original documents are kept unchanged on this Mac. Library records remember which document each value came from.</p>
        <button type="button" className="btn" onClick={() => setImportOpen(true)}>
          <Icon name="import" size={14} /> Import
        </button>
      </div>
      {sources.length === 0 ? <div className="empty surface">No original documents yet.</div> : null}
      {sources.map((s) => (
        <div key={s.id} className="source-row" data-testid="source-row">
          <SourceIcon format={s.format} />
          <div className="grow">
            <div className="row">
              <strong className="ellipsis">{s.filename}</strong>
              <span className={`chip ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
              {s.convertedFromId ? <span className="chip">Converted from Pages</span> : null}
            </div>
            <div className="small muted">
              Added {relativeDate(s.importedAt)} · {(s.size / 1024).toFixed(0)} KB · {s.recordCount} record{s.recordCount === 1 ? '' : 's'} · read with {methodLabel(s.method)}
            </div>
            {s.warnings.length ? <div className="small" style={{ color: 'var(--warning)', marginTop: 2 }}>{s.warnings[0]}</div> : null}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setView(s)} disabled={!s.extractedText}>
            View text
          </button>
          <MenuButton
            label={`Actions for ${s.filename}`}
            entries={[
              {
                label: 'Open original',
                icon: 'external',
                onSelect: async () => {
                  try {
                    await unwrap(api().library.openSource(s.id));
                  } catch (e) {
                    toastError(e);
                  }
                },
              },
              { kind: 'separator' },
              { label: 'Remove original…', icon: 'trash', danger: true, onSelect: () => setRemove(s) },
            ]}
          />
        </div>
      ))}
      {view ? (
        <Dialog title={view.filename} subtitle={`Extracted text (${methodLabel(view.method)})`} onClose={() => setView(null)}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{view.extractedText}</pre>
        </Dialog>
      ) : null}
      {remove ? (
        <Confirm
          title={`Remove “${remove.filename}”?`}
          message="The stored copy of the original document is deleted. Library records created from it are kept and still show where they came from."
          confirmLabel="Remove original"
          danger
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            try {
              await unwrap(api().library.deleteSource(remove.id));
              toast({ kind: 'ok', text: 'Original removed.' });
            } catch (e) {
              toastError(e);
            }
            setRemove(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

export function methodLabel(m: string): string {
  const map: Record<string, string> = {
    docx: 'Word reader',
    'pdf:text': 'PDF text layer',
    'pdf:ocr': 'on-device OCR',
    'pages:preview-pdf': 'Pages preview',
    'pages:iwa-experimental': 'experimental Pages reader',
    'pages:converted': 'Word export from Pages',
    'pages:converted-docx': 'Word export from Pages',
    'pages:none': 'Pages (not readable)',
    manual: 'manual correction',
    txt: 'plain text',
    md: 'plain text',
  };
  return map[m] ?? m;
}
