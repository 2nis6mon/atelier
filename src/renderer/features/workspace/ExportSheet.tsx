import { useEffect, useState } from 'react';
import type { ExportResult } from '../../../shared/api';
import { defaultExportName, validateExportName } from '../../../shared/exportNames';
import type { CvVersion } from '../../../shared/types';
import { api, errorMessage, unwrap, ApiError } from '../../api';
import { CvThumb } from '../../cv/CvThumb';
import { toast } from '../../state/app';
import { selectDoc, useWorkspace } from '../../state/workspace';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const doc = useWorkspace(selectDoc)!;
  const cv = useWorkspace((s) => s.cv)!;
  const application = useWorkspace((s) => s.application);
  const layout = useWorkspace((s) => s.layout);
  const [pdf, setPdf] = useState(true);
  const [docx, setDocx] = useState(true);
  const [name, setName] = useState(defaultExportName(doc, application?.company ?? ''));
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [sent, setSent] = useState<CvVersion | null>(null);

  useEffect(() => {
    void api().exporter.defaultDirectory().then((d) => setDir((cur) => cur || d));
  }, []);

  const nameError = validateExportName(name);
  const run = async (overwrite = false) => {
    setBusy(true);
    setError(null);
    setExists(false);
    try {
      const saved = await useWorkspace.getState().flush();
      if (!saved) throw new Error('The CV could not be saved, so it was not exported. Retry saving first.');
      const formats: Array<'pdf' | 'docx'> = [...(pdf ? (['pdf'] as const) : []), ...(docx ? (['docx'] as const) : [])];
      const r = await unwrap(api().exporter.run({ cvId: cv.id, formats, directory: dir, baseName: name.trim(), overwrite }));
      setResult(r);
      toast({ kind: 'ok', text: `Exported ${r.files.map((f) => f.kind.toUpperCase()).join(' and ')}.` });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'exists') setExists(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const markSent = async () => {
    if (!result || !application) return;
    setBusy(true);
    try {
      const v = await unwrap(api().exporter.markSent({ exportId: result.exportId, applicationId: application.id }));
      setSent(v);
      await useWorkspace.getState().refreshApplication();
      toast({ kind: 'ok', text: `${v.label} recorded. It will never change; further edits go to your draft.` });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Export your CV"
      subtitle="Only the content you accepted is exported. Hidden sections are left out."
      onClose={onClose}
      testId="export-sheet"
      footer={
        <>
          <span className="small muted row" style={{ gap: 6 }}>
            <Icon name="info" size={13} /> Exporting does not send anything.
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result ? (
            <button type="button" className="btn btn-primary" disabled={busy || (!pdf && !docx) || Boolean(nameError) || !dir} onClick={() => void run(false)} data-testid="export-files">
              {busy ? <span className="spinner" /> : <Icon name="export" size={14} />} Export files
            </button>
          ) : null}
        </>
      }
    >
      <div className="export-grid">
        <div className="export-preview">
          <CvThumb doc={doc} width={200} />
          <p className="small muted" style={{ textAlign: 'center', marginTop: 6 }}>
            A4 · {layout?.pageCount ?? 1} page{(layout?.pageCount ?? 1) > 1 ? 's' : ''} · {doc.lang === 'fr' ? 'French' : 'English'}
          </p>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <label className="format-row">
            <input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} data-testid="format-pdf" />
            <Icon name="pdf" size={20} />
            <span className="grow">
              <strong>PDF</strong> <span className="chip ok">Ready to send</span>
              <span className="small muted" style={{ display: 'block' }}>Same layout as the preview, selectable text and links.</span>
            </span>
          </label>
          <label className="format-row">
            <input type="checkbox" checked={docx} onChange={(e) => setDocx(e.target.checked)} data-testid="format-docx" />
            <Icon name="word" size={20} />
            <span className="grow">
              <strong>Word (.docx)</strong> <span className="chip">Editable</span>
              <span className="small muted" style={{ display: 'block' }}>Simple headings, paragraphs and real lists, easy for recruiters to edit.</span>
            </span>
          </label>
          <div className="field">
            <label htmlFor="export-name">File name</label>
            <input id="export-name" className={`input ${nameError ? 'warn' : ''}`} value={name} onChange={(e) => setName(e.target.value)} data-testid="export-name" />
            {nameError ? <span className="small" style={{ color: 'var(--danger)' }}>{nameError}</span> : null}
          </div>
          <div className="field">
            <span className="label">Save in</span>
            <div className="row">
              <span className="grow ellipsis small" title={dir} data-testid="export-dir">
                {dir || 'Choose a folder'}
              </span>
              <button type="button" className="btn btn-sm" onClick={async () => { const d = await api().exporter.chooseDirectory(); if (d) setDir(d); }} data-testid="choose-dir">
                Choose…
              </button>
            </div>
          </div>
          <div className="notice">
            <Icon name="info" size={15} />
            <span>The language is the CV's own ({doc.lang === 'fr' ? 'French' : 'English'}). To export in another language, create a translated version first — exporting never translates.</span>
          </div>
          {error ? (
            <div className="notice err" role="alert" data-testid="export-error">
              <Icon name="warning" size={15} />
              <span className="grow">{error}</span>
              {exists ? (
                <button type="button" className="btn btn-sm" onClick={() => void run(true)} data-testid="overwrite">
                  Replace
                </button>
              ) : null}
            </div>
          ) : null}
          {result ? (
            <div className="surface" style={{ padding: 12 }} data-testid="export-result">
              <strong>Files saved</strong>
              {result.files.map((f) => (
                <div key={f.path} className="row small" style={{ marginTop: 6 }}>
                  <Icon name={f.kind === 'pdf' ? 'pdf' : 'word'} size={15} />
                  <span className="grow ellipsis" title={f.path}>
                    {f.path.split(/[\\/]/).pop()} · {(f.size / 1024).toFixed(0)} KB{f.pageCount ? ` · ${f.pageCount} page${f.pageCount > 1 ? 's' : ''}` : ''}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => void api().exporter.reveal(f.path)}>
                    Show in Finder
                  </button>
                </div>
              ))}
              <div className="divider" />
              {application ? (
                sent ? (
                  <div className="notice ok" data-testid="sent-confirmation">
                    <Icon name="lock" size={15} /> {sent.label} saved for {application.company}: these exact files and this version are locked.
                  </div>
                ) : (
                  <div className="row">
                    <span className="grow small">Once you have sent these files to {application.company} yourself, record it here. Atelier never sends anything.</span>
                    <button type="button" className="btn" onClick={() => void markSent()} disabled={busy} data-testid="mark-sent">
                      <Icon name="send" size={14} /> Mark as sent
                    </button>
                  </div>
                )
              ) : (
                <p className="small muted">Link this CV to an application (Applications › New application) to record what you send.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
