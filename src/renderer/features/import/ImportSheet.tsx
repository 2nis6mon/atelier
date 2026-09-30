import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldConflict, MergeGroup } from '../../../shared/dedupe';
import type { GroupDecisionInput, ImportBatchView, ImportFileView } from '../../../shared/importTypes';
import { api, errorMessage, unwrap } from '../../api';
import { navigate } from '../../router';
import { toast, toastError, useApp } from '../../state/app';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { KIND_LABELS, FIELDS } from '../library/recordFields';
import { SourceIcon, methodLabel } from '../library/SourcesTab';

type Step = 'files' | 'review' | 'save';

export function ImportSheet() {
  const open = useApp((s) => s.importOpen);
  const setOpen = useApp((s) => s.setImportOpen);
  if (!open) return null;
  return <ImportFlow onClose={() => setOpen(false)} />;
}

function statusText(f: ImportFileView): { text: string; cls: string; icon: string } {
  const n = f.candidates.length;
  switch (f.status) {
    case 'extracted':
      return { text: `Extracted successfully · ${n} item${n === 1 ? '' : 's'} found`, cls: 'ok', icon: 'check' };
    case 'needs-review':
      return { text: `Needs review · ${n} item${n === 1 ? '' : 's'} found`, cls: 'warn', icon: 'warning' };
    case 'needs-ocr':
      return { text: 'Scanned document · text recognition needed', cls: 'warn', icon: 'warning' };
    case 'conversion-needed':
      return { text: 'Conversion needed · export to Word from Pages', cls: 'info', icon: 'info' };
    case 'duplicate':
      return { text: f.warnings[0] ?? 'Already imported', cls: 'info', icon: 'info' };
    case 'unsupported':
      return { text: f.warnings[0] ?? 'Unsupported file', cls: 'err', icon: 'warning' };
    default:
      return { text: f.warnings[0] ?? 'Could not read this file', cls: 'err', icon: 'warning' };
  }
}

function ImportFlow({ onClose }: { onClose: () => void }) {
  const [batch, setBatch] = useState<ImportBatchView | null>(null);
  const [step, setStep] = useState<Step>('files');
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<number>(0);
  const [decisions, setDecisions] = useState<Record<string, GroupDecisionInput>>({});
  const [over, setOver] = useState(false);
  const [done, setDone] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const info = useApp((s) => s.info);

  useEffect(() => {
    void api()
      .importer.pending()
      .then((b) => {
        if (b) {
          setBatch(b);
          toast({ kind: 'info', text: 'Resumed your unfinished import.' });
        }
      });
  }, []);

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      setBusy('Reading your documents…');
      try {
        const b = await unwrap(api().importer.importPaths(paths, batch?.id));
        setBatch(b);
        setSelectedFile(Math.max(0, b.files.length - paths.length));
      } catch (e) {
        toastError(e, 'Import failed: ');
      } finally {
        setBusy(null);
      }
    },
    [batch],
  );

  const pick = async () => importPaths(await api().importer.pickFiles());

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => api().importer.pathForFile(f)).filter(Boolean);
    void importPaths(paths);
  };

  const replaceBatch = (b: ImportBatchView) => setBatch(b);

  const decision = (g: MergeGroup): GroupDecisionInput => decisions[g.id] ?? { mode: 'merge', choices: {} };
  const setDecision = (id: string, d: Partial<GroupDecisionInput>) =>
    setDecisions((all) => ({ ...all, [id]: { ...(all[id] ?? { mode: 'merge', choices: {} }), ...d } }));

  const groups = batch?.groups ?? [];
  const unresolved = groups.filter((g) => {
    const d = decision(g);
    if (d.skip || d.mode === 'separate' || g.members.length < 2) return false;
    return g.conflicts.some((c) => d.choices[c.field] === undefined && !(d.edits && c.field in d.edits));
  });
  const readable = (batch?.files ?? []).filter((f) => f.sourceId && f.candidates.length > 0);

  const commit = async () => {
    if (!batch) return;
    setBusy('Saving to your library…');
    try {
      const r = await unwrap(api().importer.commit(batch.id, decisions));
      setDone(r);
      setStep('save');
    } catch (e) {
      toastError(e, 'Not saved: ');
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (batch && !done) await api().importer.discard(batch.id);
    onClose();
  };

  const stepState = (s: Step) => (s === step ? 'current' : (['files', 'review', 'save'].indexOf(s) < ['files', 'review', 'save'].indexOf(step) ? 'done' : 'todo'));

  return (
    <Dialog
      title="Import CVs"
      subtitle="Review extracted information and choose what to keep. Originals are kept unchanged."
      onClose={onClose}
      testId="import-sheet"
      headerExtra={
        <ol className="steps" aria-label="Import steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {(['files', 'review', 'save'] as Step[]).map((s, i) => (
            <li key={s} className="step" data-state={stepState(s)} aria-current={s === step ? 'step' : undefined}>
              {i > 0 ? <span className="step-line" aria-hidden="true" /> : null}
              <span className="dot">{i + 1}</span>
              {s === 'files' ? 'Files' : s === 'review' ? 'Review' : 'Save'}
            </li>
          ))}
        </ol>
      }
      footer={
        done ? (
          <>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => { onClose(); navigate({ name: 'library', tab: 'experience' }); }}>
              Open my library
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose} data-testid="import-done">
              Done
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-quiet" onClick={() => void discard()}>
              {batch ? 'Cancel import' : 'Close'}
            </button>
            <span className="spacer" />
            {busy ? (
              <span className="row small muted" role="status">
                <span className="spinner" /> {busy}
              </span>
            ) : null}
            {step === 'review' ? (
              <button type="button" className="btn" onClick={() => setStep('files')}>
                Back
              </button>
            ) : null}
            {step === 'files' ? (
              <button type="button" className="btn btn-primary" disabled={!readable.length || Boolean(busy)} onClick={() => setStep('review')} data-testid="to-review">
                Review {groups.length ? `${groups.length} items` : ''} <Icon name="forward" size={14} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={unresolved.length > 0 || Boolean(busy)} onClick={() => void commit()} data-testid="save-import">
                {unresolved.length ? `Resolve ${unresolved.length} difference${unresolved.length > 1 ? 's' : ''}` : 'Save to library'}
              </button>
            )}
          </>
        )
      }
    >
      {done ? (
        <div className="empty" data-testid="import-summary">
          <Icon name="check" size={32} />
          <h2 className="display" style={{ fontSize: 24 }}>Library updated</h2>
          <p>
            {done.created} new record{done.created === 1 ? '' : 's'}, {done.updated} updated with new sources{done.skipped ? `, ${done.skipped} skipped` : ''}.
          </p>
        </div>
      ) : step === 'files' ? (
        <div className="import-grid">
          <div className="col" style={{ gap: 8 }}>
            <div className="section-title">
              Imported files <span className="count">{batch?.files.length ?? 0}</span>
            </div>
            {(batch?.files ?? []).map((f, i) => {
              const s = statusText(f);
              return (
                <button key={`${f.filename}-${i}`} type="button" className="file-item" aria-selected={i === selectedFile} onClick={() => setSelectedFile(i)} data-testid="import-file">
                  <SourceIcon format={f.format} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong className="ellipsis" style={{ display: 'block' }}>{f.filename}</strong>
                    <span className="small" style={{ color: `var(--${s.cls === 'ok' ? 'success' : s.cls === 'warn' ? 'warning' : s.cls === 'err' ? 'danger' : 'info'})` }}>{s.text}</span>
                  </span>
                  <Icon name={s.icon} size={15} />
                </button>
              );
            })}
            <div
              className={`drop-zone ${over ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <Icon name="import" size={24} />
              <span className="small">Drop .docx, .pdf or .pages files here</span>
              <button type="button" className="btn btn-primary" onClick={() => void pick()} disabled={Boolean(busy)} data-testid="choose-files">
                Choose files…
              </button>
            </div>
          </div>
          <div>
            {batch && batch.files[selectedFile] ? (
              <FileDetail key={`${batch.id}-${selectedFile}`} batch={batch} file={batch.files[selectedFile]} onBatch={replaceBatch} setBusy={setBusy} pagesApp={Boolean(info?.pagesAppAvailable)} />
            ) : (
              <div className="empty surface" style={{ height: '100%' }}>
                <Icon name="doc" size={30} />
                <p>Choose your CVs to start. Atelier reads Word (.docx), PDF (including scanned ones) and Pages files, keeps the originals, and shows everything before saving.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ReviewStep groups={groups} decision={decision} setDecision={setDecision} />
      )}
    </Dialog>
  );
}

function FileDetail({ batch, file, onBatch, setBusy, pagesApp }: { batch: ImportBatchView; file: ImportFileView; onBatch: (b: ImportBatchView) => void; setBusy: (s: string | null) => void; pagesApp: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(file.text);
  const [ocr, setOcr] = useState<{ fraction: number; label: string } | null>(null);
  const [ctrl, setCtrl] = useState<AbortController | null>(null);

  const saveText = async (value: string, method: string) => {
    try {
      onBatch(await unwrap(api().importer.setText(batch.id, file.sourceId!, value, method)));
      setEditing(false);
    } catch (e) {
      toastError(e);
    }
  };

  const runOcr = async () => {
    const c = new AbortController();
    setCtrl(c);
    setOcr({ fraction: 0, label: 'Starting text recognition…' });
    try {
      const bytes = await unwrap(api().importer.sourceBytes(file.sourceId!));
      const { ocrPdf } = await import('../../ocr');
      const result = await ocrPdf(bytes, (fraction, label) => setOcr({ fraction, label }), c.signal);
      if (!result.trim()) throw new Error('No text could be recognised on these pages.');
      await saveText(result, 'pdf:ocr');
      toast({ kind: 'ok', text: 'Text recognised. Check names, dates and accents before saving.' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ kind: 'err', text: `Text recognition failed: ${errorMessage(e)}. You can paste the text instead.` });
    } finally {
      setOcr(null);
      setCtrl(null);
    }
  };

  const convertWithPages = async () => {
    setBusy('Pages is exporting a Word copy…');
    try {
      onBatch(await unwrap(api().importer.convertPages(batch.id, file.sourceId!)));
      toast({ kind: 'ok', text: 'Converted with Pages.' });
    } catch (e) {
      toast({ kind: 'err', text: `${errorMessage(e)} Use the manual export below instead.` });
    } finally {
      setBusy(null);
    }
  };

  const attach = async () => {
    try {
      onBatch(await unwrap(api().importer.attachConversion(batch.id, file.sourceId!)));
    } catch (e) {
      if ((e as { code?: string }).code !== 'cancelled') toastError(e);
    }
  };

  return (
    <div className="col" style={{ gap: 12 }} data-testid="file-detail">
      <div className="row">
        <h3 className="section-title grow">{file.filename}</h3>
        {file.sourceId ? <span className="chip">{methodLabel(file.method)}</span> : null}
        {file.sourceId ? (
          <button type="button" className="btn btn-sm" onClick={() => void unwrap(api().library.openSource(file.sourceId!)).catch(toastError)}>
            Open original
          </button>
        ) : null}
      </div>
      {file.warnings.map((w, i) => (
        <div key={i} className={`notice ${file.status === 'failed' || file.status === 'unsupported' ? 'err' : 'warn'}`}>
          <Icon name="warning" size={15} /> <span>{w}</span>
        </div>
      ))}

      {file.status === 'needs-ocr' ? (
        <div className="surface" style={{ padding: 14 }}>
          <strong>This PDF is a scan (it has no text layer).</strong>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            Atelier can read it on this Mac with built-in French and English text recognition. Nothing is uploaded. Up to 8 pages are read.
          </p>
          {ocr ? (
            <div className="col" role="status" aria-live="polite">
              <span className="small">{ocr.label}</span>
              <div className="progress" aria-hidden="true">
                <div style={{ width: `${Math.round(ocr.fraction * 100)}%` }} />
              </div>
              <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => ctrl?.abort()}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void runOcr()} data-testid="run-ocr">
                <Icon name="search" size={14} /> Recognise text on this Mac
              </button>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Paste the text instead
              </button>
            </div>
          )}
        </div>
      ) : null}

      {file.format === 'pages' && (file.status === 'conversion-needed' || file.method === 'pages:iwa-experimental') ? (
        <div className="surface" style={{ padding: 14 }} data-testid="pages-help">
          <strong>{file.status === 'conversion-needed' ? 'Export this Pages document to Word to continue' : 'Check this Pages text carefully'}</strong>
          <ol className="small" style={{ margin: '8px 0 10px', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Open the document in Pages (“Open original” above).</li>
            <li>
              Choose <strong>File › Export To › Word…</strong>, then <strong>Next</strong> and <strong>Export</strong>.
            </li>
            <li>Come back here and choose the exported .docx. It stays linked to the original Pages file.</li>
          </ol>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void attach()} data-testid="attach-docx">
              Choose the Word file…
            </button>
            {pagesApp ? (
              <button type="button" className="btn" onClick={() => void convertWithPages()} title="Asks Pages on this Mac to export a Word copy. macOS asks your permission the first time.">
                Convert with Pages
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {file.sourceId && file.status !== 'needs-ocr' && file.status !== 'conversion-needed' ? (
        <div className="surface" style={{ padding: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong className="grow">Extracted text</strong>
            {!editing ? (
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} data-testid="edit-text">
                Correct text
              </button>
            ) : null}
          </div>
          {!editing ? (
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 260, overflow: 'auto', fontFamily: 'var(--font-ui)', fontSize: 12.5, lineHeight: 1.5 }}>{file.text || '(empty)'}</pre>
          ) : null}
          {!editing && file.candidates.length ? (
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
              {Object.entries(
                file.candidates.reduce<Record<string, number>>((acc, c) => {
                  acc[c.kind] = (acc[c.kind] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([k, n]) => (
                <span key={k} className="chip">
                  {n} {KIND_LABELS[k as keyof typeof KIND_LABELS].many.toLowerCase()}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="surface" style={{ padding: 14 }}>
          <label className="label" htmlFor="import-text">
            Text of this document (you can paste or correct it)
          </label>
          <textarea id="import-text" className="textarea" style={{ minHeight: 220, marginTop: 6 }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveText(text, 'manual')} disabled={!text.trim()} data-testid="save-text">
              Use this text
            </button>
          </div>
        </div>
      ) : null}

      {file.sourceId && file.candidates.length === 0 && file.status !== 'needs-ocr' && file.status !== 'conversion-needed' ? (
        <div className="notice warn">
          <Icon name="info" size={15} /> Nothing structured was recognised. Correct the text or add records manually in the library.
        </div>
      ) : null}
      {file.sourceId ? (
        <button type="button" className="btn btn-quiet btn-sm btn-danger" style={{ alignSelf: 'flex-start' }} onClick={() => void unwrap(api().importer.removeFile(batch.id, file.sourceId!)).then(onBatch).catch(toastError)}>
          Remove this file from the import
        </button>
      ) : null}
    </div>
  );
}

function ReviewStep({ groups, decision, setDecision }: { groups: MergeGroup[]; decision: (g: MergeGroup) => GroupDecisionInput; setDecision: (id: string, d: Partial<GroupDecisionInput>) => void }) {
  const ordered = useMemo(
    () =>
      [...groups].sort((a, b) => {
        const score = (g: MergeGroup) => (g.conflicts.length ? 0 : g.members.length > 1 ? 1 : 2);
        return score(a) - score(b);
      }),
    [groups],
  );
  const needing = ordered.filter((g) => g.conflicts.length > 0).length;
  return (
    <div className="col" style={{ gap: 12 }} data-testid="review-step">
      <div className="notice peach">
        <Icon name="info" size={15} />
        <span>
          {needing ? `${needing} item${needing > 1 ? 's appear' : ' appears'} in several documents with different values. Choose the right value, or keep them separate. ` : ''}
          Values are never merged for you. Uncheck anything you do not want in your library.
        </span>
      </div>
      {ordered.map((g) => (
        <GroupCard key={g.id} group={g} decision={decision(g)} onChange={(d) => setDecision(g.id, d)} />
      ))}
    </div>
  );
}

function ConflictBox({ c, chosen, onChoose, groupId }: { c: FieldConflict; chosen: number | undefined; onChoose: (i: number) => void; groupId: string }) {
  return (
    <fieldset className="conflict" data-testid="conflict">
      <legend className="row" style={{ fontWeight: 650, color: 'var(--navy)' }}>
        <Icon name="warning" size={15} /> {c.label} differs
      </legend>
      <p className="small muted" style={{ margin: '0 0 6px' }}>
        This appears in multiple files with different values.
      </p>
      {c.options.map((o, i) => (
        <label key={i} className="conflict-option">
          <input type="radio" name={`${groupId}-${c.field}`} checked={chosen === i} onChange={() => onChoose(i)} />
          <strong>{o.display}</strong>
          <span className="small muted">
            ({o.existing ? 'in your library' : `from ${o.sources.map((s) => s.label).join(', ')}`})
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function GroupCard({ group, decision, onChange }: { group: MergeGroup; decision: GroupDecisionInput; onChange: (d: Partial<GroupDecisionInput>) => void }) {
  const [open, setOpen] = useState(group.conflicts.length > 0);
  const multi = group.members.length > 1;
  const scalarFields = FIELDS[group.kind].filter((f) => f.type === 'text' || f.type === 'date' || f.type === 'textarea');
  const raw = (k: string): unknown => {
    if (decision.edits && k in decision.edits) return decision.edits[k];
    const conflict = group.conflicts.find((c) => c.field === k);
    if (conflict) {
      const idx = decision.choices[k];
      return idx === undefined ? '' : conflict.options[idx].value;
    }
    if (k === 'end' && group.members.length === 1 && group.members[0].data.current) return PRESENT;
    return group.base[k] ?? (group.members[0].data[k] as unknown);
  };
  const value = (k: string) => {
    const v = raw(k);
    return v === PRESENT ? 'Present' : String(v ?? '');
  };
  const unresolved = (k: string) => multi && decision.mode !== 'separate' && group.conflicts.some((c) => c.field === k) && decision.choices[k] === undefined && !(decision.edits && k in decision.edits);
  return (
    <div className="group-card" data-testid="group-card" style={{ opacity: decision.skip ? 0.55 : 1 }}>
      <div className="row">
        <label className="checkbox" title="Include in library">
          <input type="checkbox" checked={!decision.skip} onChange={(e) => onChange({ skip: !e.target.checked })} aria-label={`Include ${group.title}`} />
        </label>
        <span className="chip">{KIND_LABELS[group.kind].one}</span>
        <strong className="grow ellipsis">{group.title || '(untitled)'}</strong>
        <span className="row small muted" style={{ gap: 4 }}>
          {group.members.flatMap((m) => m.sources).map((s, i) => (
            <span key={i} className="chip outline">{s.label}</span>
          ))}
        </span>
        {group.existingRecordId ? <span className="chip info">Already in library</span> : null}
        <button type="button" className="btn btn-quiet btn-sm icon-btn" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'up' : 'down'} size={14} />
        </button>
      </div>
      {open ? (
        <div className="col" style={{ gap: 10, marginTop: 10 }}>
          {multi ? (
            <div className="row">
              <span className="small muted grow">Found in {group.members.length} places.</span>
              <button type="button" className={`btn btn-sm ${decision.mode === 'separate' ? 'btn-primary' : ''}`} onClick={() => onChange({ mode: decision.mode === 'separate' ? 'merge' : 'separate' })} data-testid="keep-separate">
                {decision.mode === 'separate' ? 'Kept separate — undo' : 'Keep separate'}
              </button>
            </div>
          ) : null}
          {decision.mode !== 'separate' || !multi ? (
            <>
              {multi
                ? group.conflicts.map((c) => (
                    <ConflictBox key={c.field} c={c} groupId={group.id} chosen={decision.choices[c.field]} onChoose={(i) => onChange({ choices: { ...decision.choices, [c.field]: i } })} />
                  ))
                : null}
              <div className="form-grid">
                {scalarFields.map((f) => (
                  <FieldEdit
                    key={f.key}
                    label={f.label}
                    textarea={f.type === 'textarea'}
                    value={value(f.key)}
                    placeholder={unresolved(f.key) ? 'Choose a value above' : f.key === 'end' ? 'Year, month/year or “Present”' : ''}
                    onChange={(v) => onChange({ edits: { ...(decision.edits ?? {}), [f.key]: f.key === 'end' && PRESENT_WORDS.test(v.trim()) ? PRESENT : v } })}
                  />
                ))}
              </div>
              {Array.isArray(group.base.bullets) && (group.base.bullets as string[]).length ? (
                <div>
                  <span className="label">Bullets (from all documents, duplicates removed)</span>
                  <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
                    {(group.base.bullets as string[]).map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="small muted">Each document's version will be saved as its own record.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

const PRESENT = '__present__';
const PRESENT_WORDS = /^(present|current|now|today|aujourd['’]hui|actuel(lement)?|en cours)$/i;

function FieldEdit({ label, value, onChange, textarea, placeholder }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <>
      <label className="small muted">{label}</label>
      {textarea ? (
        <textarea className="textarea" style={{ minHeight: 60 }} value={v} aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v)} />
      ) : (
        <input className="input" value={v} aria-label={label} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v)} />
      )}
    </>
  );
}
